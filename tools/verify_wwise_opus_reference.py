"""Check WEM PCM, channel order and authored trim against FFmpeg's Ogg Opus decoder.

Repackages original packets without re-encoding. No game key is required once
the SHA-verified WEM exists. The Ogg header follows the Wwise mapping documented
by vgmstream; the comparison independently exercises FFmpeg's demux/decoder.
"""
import argparse
from array import array
import ctypes
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile

from decode_wwise import chunks, decode, opus

opus.opus_packet_get_nb_samples.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
opus.opus_packet_get_nb_samples.restype = ctypes.c_int


def ogg_page(packet, serial, sequence, granule, flags):
    laces = bytes([255] * (len(packet) // 255) + [len(packet) % 255])
    header = b'OggS' + bytes([0, flags]) + struct.pack('<QIII', granule, serial, sequence, 0) + bytes([len(laces)]) + laces
    page = bytearray(header + packet)
    crc = 0
    for byte in page:
        crc ^= byte << 24
        for _ in range(8):
            crc = ((crc << 1) ^ (0x04c11db7 if crc & 0x80000000 else 0)) & 0xffffffff
    struct.pack_into('<I', page, 22, crc)
    return page


def repack(data):
    parts = chunks(data)
    fmt = parts[b'fmt ']
    channels = struct.unpack_from('<H', fmt, 2)[0]
    samples, count, skip, version, family = struct.unpack_from('<IIHBB', fmt, 24)
    config = struct.unpack_from('<I', fmt, 20)[0]
    # Deliberately independent Wwise/Vorbis mapping before FFmpeg's WAVE reorder.
    maps = {1: [0], 2: [0, 1], 3: [0, 2, 1], 4: [0, 1, 2, 3],
            5: [0, 4, 1, 2, 3], 6: [0, 4, 1, 2, 3, 5],
            7: [0, 6, 1, 2, 3, 4, 5], 8: [0, 6, 1, 2, 3, 4, 5, 7]}
    head = b'OpusHead' + bytes([version, channels]) + struct.pack('<HIhB', skip, 48000, 0, family)
    if family == 1:
        coupled = {0x3: 1, 0x7: 1, 0x603: 2, 0x607: 2, 0x60f: 2, 0x63f: 3}.get(config >> 12, 0)
        head += bytes([channels - coupled, coupled] + maps[channels])
    vendor = b'Reader original WEM packet verification'
    tags = b'OpusTags' + struct.pack('<I', len(vendor)) + vendor + struct.pack('<I', 0)
    pages = [ogg_page(head, 1, 0, 0, 2), ogg_page(tags, 1, 1, 0, 0)]
    offset, granule = 0, 0
    for index, size in enumerate(struct.unpack('<' + 'H' * count, parts[b'seek'])):
        packet = parts[b'data'][offset:offset + size]
        offset += size
        granule += opus.opus_packet_get_nb_samples(packet, size, 48000)
        pages.append(ogg_page(packet, 1, index + 2, samples + skip if index == count - 1 else granule, 4 if index == count - 1 else 0))
    return b''.join(pages)


def verify(path):
    data = Path(path).read_bytes()
    with tempfile.TemporaryDirectory(prefix='reader-opus-reference-') as directory:
        directory = Path(directory)
        facts = decode(data, directory / 'native.wav')
        (directory / 'reference.opus').write_bytes(repack(data))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-codec:a', 'libopus', '-request_sample_fmt', 's16', '-i', str(directory / 'reference.opus'),
                        '-codec:a', 'pcm_s16le', '-f', 's16le', str(directory / 'reference.pcm')], check=True)
        actual_pcm = chunks((directory / 'native.wav').read_bytes())[b'data']
        reference_pcm = (directory / 'reference.pcm').read_bytes()
        if len(actual_pcm) != len(reference_pcm):
            raise AssertionError(f'PCM byte counts differ: {len(actual_pcm)} vs {len(reference_pcm)}')
        actual, reference = array('h', actual_pcm), array('h', reference_pcm)
        maximum = max(abs(a - b) for a, b in zip(actual, reference))
        if maximum != 0:
            raise AssertionError(f'Channel/order/decoder mismatch: maximum PCM delta {maximum}')
        return dict(source=str(path), wemSha256=hashlib.sha256(data).hexdigest(), **facts,
                    comparedSamples=len(actual), maxAbsolutePcmDifference=maximum,
                    actualPcmSha256=hashlib.sha256(actual_pcm).hexdigest(),
                    ffmpegPcmSha256=hashlib.sha256(reference_pcm).hexdigest(),
                    ffmpeg=subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wems', nargs='+')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = {'checks': [verify(path) for path in args.wems]}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
