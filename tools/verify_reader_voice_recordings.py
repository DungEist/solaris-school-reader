"""Independently check complete Reader destination PCM and delivered MP4 audio.

Run after reader-voice-browser.mjs. Captured WAV/PCM and decoded-buffer oracles
remain local; this writes only a compact verification report. Oracles are read
for comparison and never fed to an encoder or used to construct recordings.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {(key, mode) for key in ('1001:1', '1002:1', '1002:2', '1004:3')
            for mode in ('auto', 'review')}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wave_pcm(path):
    data = path.read_bytes()
    assert data[:4] == b'RIFF' and data[8:12] == b'WAVE', path
    parts, offset = {}, 12
    while offset + 8 <= len(data):
        tag, size = data[offset:offset + 4], struct.unpack_from('<I', data, offset + 4)[0]
        assert offset + 8 + size <= len(data), path
        parts[tag] = data[offset + 8:offset + 8 + size]
        offset += 8 + size + size % 2
    assert struct.unpack_from('<HHI', parts[b'fmt ']) == (3, 2, 48000), path
    assert struct.unpack_from('<H', parts[b'fmt '], 14)[0] == 32, path
    return parts[b'data']


def correlation(actual, expected, channels, offset, start, end, stride=1):
    dot = left_energy = right_energy = squared_error = 0.0
    for frame in range(start, end, stride):
        for channel in range(2):
            left = actual[(offset + frame) * 2 + channel]
            right = expected[frame * channels + min(channel, channels - 1)]
            assert math.isfinite(left) and math.isfinite(right)
            dot += left * right
            left_energy += left * left
            right_energy += right * right
            squared_error += (left - right) ** 2
    assert left_energy > 0 and right_energy > 0, 'Actual spoken signal is required.'
    return dot / math.sqrt(left_energy * right_energy), math.sqrt(squared_error / right_energy)


def verify_case(directory, case, manifest):
    checkpoint, mode = case['checkpoint'], case['mode']
    key = f"{checkpoint['script']}:{checkpoint['nid']}"
    folder = directory / (checkpoint['name'] + '-' + mode)
    measurement_file = folder / 'measurements.json'
    measurement = json.loads(measurement_file.read_text())
    assert measurement['checkpoint'] == checkpoint and measurement['mode'] == mode
    assert measurement['source']['audioManifest']['sha256'] == digest(ROOT / 'public/data/maps/audio-playback.json')
    assert measurement['manifestLine'] == manifest['lines'][key]
    assert measurement['manifestLine']['textKey'] == checkpoint['textKey']
    state = measurement['audioAfter']['state']
    assert state['language'] == 'ja' and state['volumes'] == {'music': 0, 'effects': 0, 'voice': 1}
    cue = f"{'line' if mode == 'auto' else 'review'}:{key}"
    asset = manifest['lines'][key]['variants']['ja:any']
    asset_source = manifest['assets'][asset]
    mp3_file = ROOT / 'public' / asset_source['url']
    assert digest(mp3_file) == asset_source['sha256'], 'The mapped original media must still match its audited hash.'
    played = [item for item in measurement['audioAfter']['observations']
              if item['cue'] == cue and item['status'] == 'played' and item.get('asset') == asset]
    assert played, (key, mode, 'the shared audio owner must start the selected asset')
    before, after = measurement['before'], measurement['after']
    if mode == 'review':
        assert measurement['trigger']['available'] and before['visitId'] == after['visitId']
    else:
        assert measurement['trigger']['available']
        assert (before['scriptId'], before['nid']) != (checkpoint['script'], str(checkpoint['nid'])), 'Arm before entering the target line.'
        assert (after['scriptId'], after['nid']) == (checkpoint['script'], str(checkpoint['nid']))
        if key == '1002:1':
            assert 'Next cycle' in measurement['trigger']['publicControl'], 'Use the ordinary Next cycle control.'

    audio = case['actualAudio']
    wav_file, raw_file = folder / 'destination.wav', folder / 'observed-destination.f32le'
    assert digest(wav_file) == audio['sha256'] and digest(raw_file) == audio['rawObservedPCM']['sha256']
    pcm = wave_pcm(wav_file)
    assert pcm == raw_file.read_bytes(), 'Delivered WAV must contain only chronological observed output blocks.'
    captured = memoryview(pcm).cast('f')
    comparisons = audio['voiceComparisons']
    assert len(comparisons) == 1, 'Each recording must contain exactly one authored spoken line.'
    comparison = comparisons[0]
    oracle_file = folder / f"decoded-voice-oracle-{comparison['sourceIndex']}.f32le"
    assert digest(oracle_file) == comparison['oracle']['sha256']
    oracle = memoryview(oracle_file.read_bytes()).cast('f')
    channels, frames, offset = comparison['sourceChannels'], comparison['decodedFrames'], comparison['offsetFrames']
    assert channels in (1, 2) and len(oracle) == frames * channels
    assert abs(frames / 48000 - checkpoint['duration']) < 1e-6
    assert offset >= 0 and offset + frames <= len(captured) // 2
    maximum_error = 0.0
    for frame in range(frames):
        for channel in range(2):
            error = abs(captured[(offset + frame) * 2 + channel]
                        - oracle[frame * channels + min(channel, channels - 1)])
            assert math.isfinite(error)
            maximum_error = max(maximum_error, error)
    # The real Web Audio mixer can introduce a float32 rounding difference.
    # Keep every frame in the comparison and reject even small signal gaps.
    assert maximum_error <= 1e-8, (key, mode, maximum_error)

    video_file = folder / 'reader-with-actual-audio.mp4'
    assert digest(video_file) == case['encoding']['sha256']
    decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video_file), '-vn',
                              '-ac', '2', '-ar', '48000', '-f', 'f32le', '-codec:a', 'pcm_f32le', '-'],
                             check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
    encoded = memoryview(decoded).cast('f')
    timing = case['encoding']['pcmOffsetRelativeToFirstVideoFrameSeconds']
    estimated = offset + (math.floor(timing * 1000 + 0.5) * 48 if timing >= 0
                          else -math.floor(-timing * 48000 + 0.5))
    peak_frame = max(range(0, frames, 64), key=lambda i: abs(oracle[i * channels]))
    window_start = max(0, min(frames - 12000, peak_frame - 6000))
    candidates = []
    for shift in range(-8, 9):
        candidate = estimated + shift
        if candidate >= 0 and candidate + frames <= len(encoded) // 2:
            score, _ = correlation(encoded, oracle, channels, candidate, window_start, window_start + 12000, 8)
            candidates.append((score, candidate))
    assert candidates, (key, mode, 'MP4 must retain the entire spoken interval')
    video_offset = max(candidates)[1]
    score, relative_error = correlation(encoded, oracle, channels, video_offset, 0, frames)
    assert score > 0.98, (key, mode, 'Delivered MP4 audio differs from the recorded voice.', score)
    return {
        'routeKey': key, 'textKey': checkpoint['textKey'], 'mode': mode,
        'source': measurement['source'], 'asset': asset, 'language': state['language'], 'volumes': state['volumes'],
        'nativeVoice': {'source': asset_source['source'], 'wemSha256': asset_source['wemSha256'],
                        'channels': asset_source['channels'], 'samples': asset_source['samples']},
        'preparedMP3': {'file': str(mp3_file.relative_to(ROOT)), 'sha256': digest(mp3_file)},
        'before': before, 'after': after, 'trigger': measurement['trigger'],
        'measurements': {'file': str(measurement_file.relative_to(ROOT)), 'sha256': digest(measurement_file)},
        'wave': {'file': str(wav_file.relative_to(ROOT)), 'sha256': digest(wav_file),
                 'rawObservedBlocksEqualWAV': True, 'completeVoiceFrames': frames,
                 'sourceChannels': channels, 'maximumSampleError': maximum_error, 'absoluteRoundingTolerance': 1e-8},
        'video': {'file': str(video_file.relative_to(ROOT)), 'sha256': digest(video_file),
                  'bytes': video_file.stat().st_size, 'completeVoiceBounds': True,
                  'voiceOffsetFrames': video_offset, 'aacCorrelation': score,
                  'aacRelativeRMSError': relative_error},
        'passed': True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', default='test-results/reader-voice/browser-after')
    parser.add_argument('--extra-directory', action='append', default=[])
    parser.add_argument('--output', default='test-results/reader-voice/recording-verification.json')
    args = parser.parse_args()
    manifest_file = ROOT / 'public/data/maps/audio-playback.json'
    manifest = json.loads(manifest_file.read_text())
    results = []
    for index, name in enumerate([args.directory, *args.extra_directory]):
        directory = ROOT / name
        source = json.loads((directory / 'completed-recordings.json').read_text())
        cases = source['cases']
        if index == 0:
            found = {(f"{case['checkpoint']['script']}:{case['checkpoint']['nid']}", case['mode']) for case in cases}
            assert found == EXPECTED and len(cases) == len(EXPECTED), 'All four lines need automatic and Review recordings.'
        for case in cases:
            assert source['source']['audioManifest']['sha256'] == digest(manifest_file)
            result = verify_case(directory, case, manifest)
            result['scenario'] = directory.name
            results.append(result)
    report = {'authority': 'independent-captured-destination-WAV-and-decoded-delivered-MP4-comparison',
              'manifest': {'file': str(manifest_file.relative_to(ROOT)), 'sha256': digest(manifest_file)},
              'verifier': {'file': 'tools/verify_reader_voice_recordings.py', 'sha256': digest(Path(__file__))},
              'counts': {'requiredLineModes': len(EXPECTED), 'verifiedRecordings': len(results), 'failures': 0},
              'scope': 'Reads existing actual destination output and delivered MP4. Compares every spoken PCM sample to the loaded browser voice buffer, including mono-to-stereo upmix. Independently decodes MP4 AAC and compares its entire spoken interval. Source-buffer oracles are never used to construct output media.',
              'cases': results}
    output = ROOT / args.output
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['counts']))


if __name__ == '__main__':
    main()
