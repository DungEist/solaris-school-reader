#!/usr/bin/env python3
"""Encode captured Reader PNG frames at their actual observation timestamps.

The raw MediaRecorder stream can omit startup frames. This uses every saved
frame and its timestamp, with a 1 ms input timebase and no motion interpolation.
Run after reader-catchlight-playback-check.mjs and analyze_reader_catchlights.py.
"""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PLAYBACK = ROOT / 'test-results/reader-catchlights/playback'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-count_frames', '-show_frames',
        '-show_entries', 'stream=codec_name,width,height,time_base,nb_read_frames:format=duration,size:frame=pts_time',
        '-of', 'json', str(path),
    ]))


def encode(directory, frames, annotated):
    source = directory / 'tracked-frames' if annotated else directory
    name = 'tracked-close-up' if annotated else 'close-up'
    listing = directory / f'{name}.ffconcat'
    lines = ['ffconcat version 1.0']
    timestamps = [frame['timeSeconds'] for frame in frames]
    for index, frame in enumerate(frames):
        path = source / frame['file']
        assert path.is_file(), path
        escaped = str(path).replace("'", "'\\''")
        lines.extend([f"file '{escaped}'", 'option framerate 1000'])
        if index + 1 < len(frames):
            duration = timestamps[index + 1] - timestamps[index]
            assert duration > 0
            lines.append(f'duration {duration:.9f}')
    listing.write_text('\n'.join(lines) + '\n')
    output = directory / f'{name}.mp4'
    command = [
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'concat', '-safe', '0', '-i', str(listing), '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14',
        '-pix_fmt', 'yuv420p', '-enc_time_base', '1:1000', '-fps_mode', 'vfr',
        '-video_track_timescale', '1000000', '-movflags', '+faststart', str(output),
    ]
    subprocess.run(command, check=True)
    result = probe(output)
    encoded = [float(frame['pts_time']) for frame in result['frames']]
    assert len(encoded) == len(timestamps), (name, len(encoded), len(timestamps))
    offset = timestamps[0]
    maximum_error = max(abs(actual - (expected - offset)) for actual, expected in zip(encoded, timestamps))
    assert maximum_error <= .0011, (name, maximum_error)
    assert result['streams'][0]['width'] == 720 and result['streams'][0]['height'] == 320
    return {
        'file': str(output.relative_to(ROOT)), 'sha256': digest(output),
        'frames': len(encoded), 'durationSeconds': float(result['format']['duration']),
        'maximumTimestampErrorSeconds': maximum_error,
        'sourceFrameSha256': [digest(source / frame['file']) for frame in frames],
        'annotated': annotated, 'encoding': command, 'probe': result['streams'],
    }


def main():
    results = []
    for directory in sorted(PLAYBACK.iterdir()):
        path = directory / 'measurements.json'
        if not path.is_file():
            continue
        measurement = json.loads(path.read_text())
        assert measurement.get('verification', {}).get('openEyeOnly') is True
        result = {'case': measurement['target']['name'], 'raw': encode(directory, measurement['frames'], False)}
        if (directory / 'tracked-frames').is_dir():
            result['tracked'] = encode(directory, measurement['frames'], True)
        results.append(result)
        print(json.dumps({'case': result['case'], 'encoded': len(result) - 1, 'frames': result['raw']['frames'], 'duration': result['raw']['durationSeconds']}))
    assert len(results) == 3
    report = {
        'passed': True,
        'scope': 'Actual captured Reader frames encoded at their original per-frame observation timestamps. No frame interpolation, animation-rate change, stabilization, or camera movement. Annotated derivatives add only measured reflection/iris guides.',
        'source': 'per-case measurements.json and frame PNGs; raw MediaRecorder streams retained separately',
        'encoderSha256': digest(Path(__file__)), 'recordings': results,
    }
    (PLAYBACK / 'encoded-recordings.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
