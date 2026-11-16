"""Real Opus packets verify Wwise surround decoding and authored PCM trimming."""
import math
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from decode_wwise import chunks, decode
from verify_wwise_opus_reference import verify


def ogg_packets(data):
    result, packet, offset = [], bytearray(), 0
    while offset < len(data):
        if data[offset:offset + 4] != b'OggS':
            raise AssertionError('Invalid generated Ogg page')
        count = data[offset + 26]
        laces = data[offset + 27:offset + 27 + count]
        body = offset + 27 + count
        for size in laces:
            packet.extend(data[body:body + size])
            body += size
            if size < 255:
                result.append(bytes(packet))
                packet.clear()
        offset = body
    return result


def generated_wem(directory, channels):
    mask = 0x607 if channels == 5 else 0x4
    samples = 7200
    # Channel-specific tones make an incorrect centre/surround map observable.
    pcm = b''.join(struct.pack('<' + 'h' * channels,
                  *(int(6000 * math.sin(2 * math.pi * (220 + ch * 170) * n / 48000)) for ch in range(channels)))
                   for n in range(samples))
    # Ogg uses a rear pair at 5ch; Wwise's side pair has the same PCM order.
    ogg_mask = 0x37 if channels == 5 else mask
    fmt = struct.pack('<HHIIHHHHI16s', 0xfffe, channels, 48000, 48000 * channels * 2,
                      channels * 2, 16, 22, 16, ogg_mask, bytes.fromhex('0100000000001000800000aa00389b71'))
    body = b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(pcm)) + pcm
    wave_path, opus_path = directory / 'tones.wav', directory / 'tones.opus'
    wave_path.write_bytes(b'RIFF' + struct.pack('<I', len(body) + 4) + b'WAVE' + body)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wave_path), '-codec:a', 'libopus',
                    '-b:a', '256k' if channels == 5 else '64k', str(opus_path)], check=True)
    packets = ogg_packets(opus_path.read_bytes())
    skip = struct.unpack_from('<H', packets[0], 10)[0]
    audio_packets = packets[2:]
    fmt = bytearray(36)
    struct.pack_into('<HHI', fmt, 0, 0x3041, channels, 48000)
    struct.pack_into('<I', fmt, 20, (mask << 12) | 0x100 | channels)
    struct.pack_into('<IIHBB', fmt, 24, samples, len(audio_packets), skip, 1, 1 if channels == 5 else 0)
    seek = struct.pack('<' + 'H' * len(audio_packets), *(len(packet) for packet in audio_packets))
    data = b''.join(audio_packets)
    parts = []
    for tag, part in [(b'fmt ', bytes(fmt)), (b'seek', seek), (b'data', data)]:
        parts.append(tag + struct.pack('<I', len(part)) + part + bytes(len(part) % 2))
    body = b''.join(parts)
    wem = directory / 'tones.wem'
    wem.write_bytes(b'RIFF' + struct.pack('<I', len(body) + 4) + b'WAVE' + body)
    return wem


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg is required for independent encoded-packet fixtures')
class WwiseVoiceTests(unittest.TestCase):
    def test_five_channel_voice_matches_independent_ffmpeg_channel_order_and_trim(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = generated_wem(directory, 5)
            facts = verify(source)
            self.assertEqual(facts['channels'], 5)
            self.assertEqual(facts['channelMask'], 0x607)
            self.assertEqual(facts['comparedSamples'], 7200 * 5)
            self.assertEqual(facts['maxAbsolutePcmDifference'], 0)
            decode(source.read_bytes(), directory / 'out.wav')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(directory / 'out.wav'),
                            '-ac', '2', '-codec:a', 'libmp3lame', str(directory / 'out.mp3')], check=True)
            channels = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                                               '-show_entries', 'stream=channels', '-of', 'csv=p=0', str(directory / 'out.mp3')], text=True)
            self.assertEqual(channels.strip(), '2')

    def test_mono_voice_keeps_authored_sample_count_and_preskip(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = generated_wem(Path(temporary), 1)
            facts = verify(source)
            self.assertEqual(facts['comparedSamples'], 7200)
            self.assertGreater(facts['preSkip'], 0)
            self.assertEqual(facts['maxAbsolutePcmDifference'], 0)

    def test_invalid_packet_table_is_descriptive(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = generated_wem(directory, 5)
            data = bytearray(source.read_bytes())
            offset = data.index(b'seek') + 8
            struct.pack_into('<H', data, offset, 1)
            with self.assertRaisesRegex(ValueError, 'packet sizes'):
                decode(bytes(data), directory / 'invalid.wav')

    def test_unhandled_surround_mapping_stays_explicitly_unresolved(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = generated_wem(directory, 5)
            data = bytearray(source.read_bytes())
            offset = data.index(b'fmt ') + 8
            data[offset + 35] = 255
            with self.assertRaisesRegex(ValueError, 'mapping family=255, channels=5'):
                decode(bytes(data), directory / 'invalid.wav')


if __name__ == '__main__':
    unittest.main(verbosity=2)
