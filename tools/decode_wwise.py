"""Decode original Wwise Opus WEM (0x3041), including standard surround.

The authored sample count and pre-skip trim the decoded PCM. Wwise mapping
family 1 uses multistream Opus and its implicit speaker configuration; output
WAV channels follow WAVE speaker order so a stereo downmix retains the centre.
"""
import ctypes
import struct
import wave
from pathlib import Path

opus = ctypes.CDLL('libopus.so.0')
opus.opus_decoder_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
opus.opus_decoder_create.restype = ctypes.c_void_p
opus.opus_decode.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
opus.opus_decode.restype = ctypes.c_int
opus.opus_decoder_destroy.argtypes = [ctypes.c_void_p]
opus.opus_multistream_decoder_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_ubyte), ctypes.POINTER(ctypes.c_int)]
opus.opus_multistream_decoder_create.restype = ctypes.c_void_p
opus.opus_multistream_decode.argtypes = opus.opus_decode.argtypes
opus.opus_multistream_decode.restype = ctypes.c_int
opus.opus_multistream_decoder_destroy.argtypes = [ctypes.c_void_p]

# Wwise ChannelConfigToMapping / DeinterleaveAndRemap, corroborated by
# vgmstream src/meta/wwise.c (OPUSWW). This differs from generic Opus at 7ch.
WWISE_MAPPING = (
    (0,), (0, 1), (0, 2, 1), (0, 1, 2, 3),
    (0, 4, 1, 2, 3), (0, 4, 1, 2, 3, 5),
    (0, 6, 1, 2, 3, 4, 5), (0, 6, 1, 2, 3, 4, 5, 7),
)
VORBIS_TO_WAVE = (
    (0,), (0, 1), (0, 2, 1), (0, 1, 2, 3),
    (0, 2, 1, 3, 4), (0, 2, 1, 5, 3, 4),
    (0, 2, 1, 6, 5, 3, 4), (0, 2, 1, 7, 5, 6, 3, 4),
)
COUPLED_BY_MASK = {0x3: 1, 0x7: 1, 0x603: 2, 0x607: 2, 0x60f: 2, 0x63f: 3}


def chunks(data):
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('Not a RIFF WAVE asset')
    offset = 12
    result = {}
    while offset + 8 <= len(data):
        tag = data[offset:offset + 4]
        size = struct.unpack_from('<I', data, offset + 4)[0]
        if offset + 8 + size > len(data):
            raise ValueError(f'Truncated WEM chunk {tag!r}')
        result[tag] = data[offset + 8:offset + 8 + size]
        offset += 8 + size + size % 2
    return result


def write_wave(path, pcm, channels, rate, mask):
    if channels <= 2:
        with wave.open(str(path), 'wb') as out:
            out.setnchannels(channels)
            out.setsampwidth(2)
            out.setframerate(rate)
            out.writeframes(pcm)
        return
    # WAVEFORMATEXTENSIBLE preserves the authored side/rear speaker mask.
    fmt = struct.pack('<HHIIHHHHI16s', 0xfffe, channels, rate, rate * channels * 2,
                      channels * 2, 16, 22, 16, mask,
                      bytes.fromhex('0100000000001000800000aa00389b71'))
    body = b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(pcm)) + pcm
    Path(path).write_bytes(b'RIFF' + struct.pack('<I', len(body) + 4) + b'WAVE' + body)


def decode(data, out):
    parts = chunks(data)
    fmt = parts[b'fmt ']
    codec, channels, rate = struct.unpack_from('<HHI', fmt)
    if codec != 0x3041:
        raise ValueError(f'Unsupported WEM codec {codec:#x}, {channels} channels, {rate} Hz')
    samples, count, skip, version, family = struct.unpack_from('<IIHBB', fmt, 24)
    if version != 1 or not 1 <= channels <= 8 or rate != 48000:
        raise ValueError(f'Unsupported Wwise Opus version={version}, channels={channels}, rate={rate}')
    error = ctypes.c_int()
    mask = 0x4 if channels == 1 else 0x3
    streams, coupled, mapping = 1, channels - 1, list(range(channels))
    if family == 0 and channels <= 2:
        decoder = opus.opus_decoder_create(rate, channels, ctypes.byref(error))
        decode_packet, destroy = opus.opus_decode, opus.opus_decoder_destroy
    elif family == 1:
        config = struct.unpack_from('<I', fmt, 20)[0]
        channel_type = (config >> 8) & 0xf
        mask = config >> 12
        if config & 0xff != channels or channel_type != 1 or mask.bit_count() != channels:
            raise ValueError(f'Unsupported Wwise Opus channel configuration {config:#x}')
        coupled = COUPLED_BY_MASK.get(mask, 0)
        streams = channels - coupled
        mapping = [WWISE_MAPPING[channels - 1][i] for i in VORBIS_TO_WAVE[channels - 1]]
        channel_map = (ctypes.c_ubyte * channels)(*mapping)
        decoder = opus.opus_multistream_decoder_create(rate, channels, streams, coupled, channel_map, ctypes.byref(error))
        decode_packet, destroy = opus.opus_multistream_decode, opus.opus_multistream_decoder_destroy
    else:
        raise ValueError(f'Unsupported Wwise Opus mapping family={family}, channels={channels}')
    if error.value != 0 or not decoder:
        raise ValueError(f'Opus decoder initialization failed: {error.value}')
    result, offset = [], 0
    try:
        if len(parts[b'seek']) != count * 2:
            raise ValueError('WEM seek table does not match the authored packet count')
        sizes = struct.unpack('<' + 'H' * count, parts[b'seek'])
        if sum(sizes) != len(parts[b'data']):
            raise ValueError('WEM packet sizes do not match the data chunk')
        for size in sizes:
            packet = parts[b'data'][offset:offset + size]
            offset += size
            buffer = (ctypes.c_int16 * (5760 * channels))()
            decoded = decode_packet(decoder, packet, size, buffer, 5760, 0)
            if decoded <= 0:
                raise ValueError(f'Opus packet decode failed: {decoded}')
            result.append(bytes(buffer)[:decoded * channels * 2])
    finally:
        destroy(decoder)
    pcm = b''.join(result)[skip * channels * 2:(skip + samples) * channels * 2]
    if len(pcm) != samples * channels * 2:
        raise ValueError('Decoded PCM does not contain the authored sample count after pre-skip')
    write_wave(out, pcm, channels, rate, mask)
    return dict(codec='Wwise Opus 0x3041', channels=channels, sampleRate=rate, samples=samples,
                preSkip=skip, duration=samples / rate, mappingFamily=family,
                channelMask=mask, channelMapping=mapping, streams=streams, coupledStreams=coupled)


if __name__ == '__main__':
    import sys
    print(decode(Path(sys.argv[1]).read_bytes(), sys.argv[2]))
