#!/usr/bin/env python3
"""Cache only referenced SolarSchool backgrounds, CGs and quiz illustrations.

python3 tools/prepare_assets.py                     # pinned GitHub revision
python3 tools/prepare_assets.py --source-dir PATH   # local repository/SolarSchool
python3 tools/prepare_assets.py --plan-only         # explicit unverified mapping
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import urllib.parse
import urllib.request

REPOSITORY = 'alt3ri/WW_Asset_Webp'
SOLAR_ROOT = 'UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool/'
QUIZ_ROOT = 'UIResources/UiActivity/Image/Activity38/SolarSchool/IconExam/'
UE_PREFIX = '/Game/Aki/UI/'


def ue_webp_path(reference):
    return image_path_within(reference, SOLAR_ROOT)


def ue_quiz_webp_path(reference):
    return image_path_within(reference, QUIZ_ROOT)


def image_path_within(reference, root):
    if not isinstance(reference, str) or not reference.startswith(UE_PREFIX):
        raise ValueError('expected a /Game/Aki/UI/ asset reference')
    path = reference[len(UE_PREFIX):]
    folder, filename = path.rsplit('/', 1)
    filename = filename.split('.', 1)[0]
    result = f'{folder}/{filename}.webp'
    if not result.startswith(root) or not re.fullmatch(r'[A-Za-z0-9_/-]+\.webp', result) or '//' in result or not filename:
        raise ValueError('asset must be inside its supported SolarSchool image directory')
    return result


def webp_dimensions(payload):
    """Validate RIFF structure and the WebP image header without extra packages."""
    if len(payload) < 20 or payload[:4] != b'RIFF' or payload[8:12] != b'WEBP':
        raise ValueError('payload is not WebP (HTML/errors/LFS pointers are rejected)')
    if struct.unpack_from('<I', payload, 4)[0] + 8 != len(payload):
        raise ValueError('truncated or inconsistent WebP RIFF length')
    offset = 12
    dimensions = None
    has_image = False
    while offset < len(payload):
        if offset + 8 > len(payload):
            raise ValueError('truncated WebP chunk')
        tag = payload[offset:offset + 4]
        size = struct.unpack_from('<I', payload, offset + 4)[0]
        data = payload[offset + 8:offset + 8 + size]
        if len(data) != size:
            raise ValueError('truncated WebP chunk data')
        if tag == b'VP8X' and len(data) >= 10:
            dimensions = (int.from_bytes(data[4:7], 'little') + 1, int.from_bytes(data[7:10], 'little') + 1)
        elif tag == b'VP8L' and len(data) >= 5 and data[0] == 0x2f:
            bits = int.from_bytes(data[1:5], 'little')
            dimensions = dimensions or ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
            has_image = True
        elif tag == b'VP8 ' and len(data) >= 10 and data[3:6] == b'\x9d\x01\x2a':
            dimensions = dimensions or (int.from_bytes(data[6:8], 'little') & 0x3fff, int.from_bytes(data[8:10], 'little') & 0x3fff)
            has_image = True
        offset += 8 + size + (size % 2)
    if offset != len(payload) or not has_image or not dimensions or min(dimensions) <= 0:
        raise ValueError('WebP has no valid static image dimensions')
    return dimensions


def git_blob_sha(payload):
    return hashlib.sha1(f'blob {len(payload)}\0'.encode() + payload).hexdigest()


def api(endpoint):
    if shutil.which('gh'):
        result = subprocess.run(['gh', 'api', endpoint], capture_output=True, timeout=30)
        if not result.returncode:
            return json.loads(result.stdout)
        error = result.stderr.decode(errors='replace').strip()
        # Public repository reads need no login. Use the public HTTP API when
        # gh is installed but has no credentials; propagate connection errors.
        if not any(marker in error for marker in ('gh auth login', 'GH_TOKEN', 'authentication required')):
            raise RuntimeError(error or 'GitHub API request failed')
    request = urllib.request.Request(f'https://api.github.com/{endpoint}', headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'Solaris-School-Reader'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def github_inventory(paths, reference):
    revision = api(f'repos/{REPOSITORY}/commits/{urllib.parse.quote(reference, safe="")}')['sha']
    wanted_folders = {str(Path(path).parent) for path in paths}
    inventory = {}
    for folder in sorted(wanted_folders):
        rows = api(f'repos/{REPOSITORY}/contents/{urllib.parse.quote(folder, safe="/")}?ref={revision}')
        for row in rows:
            if row.get('type') == 'file' and row['path'] in paths:
                inventory[row['path']] = row['sha']
    return revision, inventory


def planned_map(manifest, usage):
    result = {'schema': 1, 'source': {'repository': REPOSITORY, 'revision': None}, 'backgrounds': {}, 'cgs': {}, 'quizzes': {}}
    paths = set()
    invalid = []

    def entry(reference, context, quiz=False):
        item = {'sourceRef': reference or None, 'repositoryPath': None, 'status': 'unverified', 'localPath': None}
        if not reference:
            item.update(status='missing', reason='No asset reference in assets.manifest.json')
            return item
        try:
            item['repositoryPath'] = ue_quiz_webp_path(reference) if quiz else ue_webp_path(reference)
            paths.add(item['repositoryPath'])
        except ValueError as error:
            item.update(status='missing', reason=str(error))
            invalid.append({'context': context, 'reference': reference, 'reason': str(error)})
        return item

    bg_ids = set(manifest.get('backgrounds', {}))
    cg_ids = set(manifest.get('cgs', {}))
    quiz_ids = set(manifest.get('quizzes', {}))
    for used in usage.values():
        bg_ids.update(map(str, used.get('bg', [])))
        cg_ids.update(map(str, used.get('cg', [])))
        quiz_ids.update(map(str, used.get('quiz', [])))
    for asset_id in sorted(bg_ids):
        source = manifest.get('backgrounds', {}).get(asset_id, {})
        result['backgrounds'][asset_id] = {
            'label': source.get('label'),
            'day': entry(source.get('day'), f'background {asset_id} day'),
            'night': entry(source.get('night'), f'background {asset_id} night'),
        }
    for asset_id in sorted(cg_ids):
        source = manifest.get('cgs', {}).get(asset_id, {})
        result['cgs'][asset_id] = {
            'label': source.get('label'),
            'female': entry(source.get('path'), f'CG {asset_id} female/base'),
            'male': entry(source.get('pathMale') or source.get('path'), f'CG {asset_id} male'),
            'maleUsesBase': not bool(source.get('pathMale')),
        }
    for asset_id in sorted(quiz_ids):
        source = manifest.get('quizzes', {}).get(asset_id, {})
        result['quizzes'][asset_id] = {
            'label': source.get('label'),
            'question': entry(source.get('path'), f'quiz {asset_id} illustration', quiz=True),
        }
    return result, paths, invalid


def prepare(data_dir, output_dir, source_dir=None, reference='main', plan_only=False, workers=4):
    manifest = json.loads((data_dir / 'assets.manifest.json').read_text(encoding='utf8'))
    usage = json.loads((data_dir / 'assets.usage.json').read_text(encoding='utf8'))
    mapping, paths, invalid = planned_map(manifest, usage)
    output_dir.mkdir(parents=True, exist_ok=True)
    inventory = {}
    source = mapping['source']
    transport_error = None
    if source_dir:
        if not source_dir.is_dir():
            raise ValueError(f'Local asset directory does not exist: {source_dir}')
        source['method'] = 'local-files'
        git = subprocess.run(['git', '--no-optional-locks', '-C', str(source_dir), 'rev-parse', 'HEAD'], capture_output=True, text=True)
        if git.returncode == 0:
            source['revision'] = git.stdout.strip()
        for path in paths:
            exact = source_dir / path
            # Both documented input layouts preserve exact, case-sensitive paths.
            root = QUIZ_ROOT if path.startswith(QUIZ_ROOT) else SOLAR_ROOT
            subtree = source_dir / path[len(root):]
            if exact.is_file(): inventory[path] = exact
            elif subtree.is_file(): inventory[path] = subtree
    elif not plan_only:
        source['method'] = 'pinned-github-files'
        try:
            source['revision'], inventory = github_inventory(paths, reference)
        except Exception as error:
            transport_error = str(error)
    else:
        source['method'] = 'plan-only'

    def cache_one(path):
        destination = output_dir / 'media' / path
        item = {'repositoryPath': path, 'status': 'missing', 'localPath': None}
        try:
            if path not in inventory:
                item['reason'] = transport_error or ('Not validated yet; run assets:fetch or provide --source-dir' if plan_only else 'Exact referenced path was not found in the selected source')
                if plan_only or transport_error:
                    item['status'] = 'unverified'
                return path, item
            if source_dir:
                payload = inventory[path].read_bytes()
                validation = 'exact-local-path-and-webp-header'
            else:
                expected_sha = inventory[path]
                payload = destination.read_bytes() if destination.is_file() else b''
                if git_blob_sha(payload) != expected_sha:
                    url = f'https://raw.githubusercontent.com/{REPOSITORY}/{source["revision"]}/{urllib.parse.quote(path, safe="/")}'
                    with urllib.request.urlopen(url, timeout=40) as response:
                        payload = response.read()
                if git_blob_sha(payload) != expected_sha:
                    raise ValueError('Downloaded bytes do not match the pinned GitHub blob (LFS pointers are unsupported)')
                validation = 'pinned-github-path-blob-and-webp-header'
            width, height = webp_dimensions(payload)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.is_file() or destination.read_bytes() != payload:
                temporary = destination.with_suffix('.webp.partial')
                temporary.write_bytes(payload)
                temporary.replace(destination)
            item.update(status='ready', localPath=f'media/{path}', sha256=hashlib.sha256(payload).hexdigest(), width=width, height=height, bytes=len(payload), validation=validation)
        except Exception as error:
            item['reason'] = str(error)
        return path, item

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        cached = dict(pool.map(cache_one, sorted(paths)))
    asset_variants = [('backgrounds', ['day', 'night']), ('cgs', ['female', 'male']), ('quizzes', ['question'])]
    for kind, variants in asset_variants:
        for asset in mapping[kind].values():
            for variant in variants:
                entry = asset[variant]
                if entry['repositoryPath'] in cached:
                    entry.update(cached[entry['repositoryPath']])
    report = {
        'source': source, 'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'backgroundIds': len(mapping['backgrounds']), 'cgIds': len(mapping['cgs']),
        'quizIds': len(mapping['quizzes']),
        'uniqueReferencedFiles': len(paths), 'readyFiles': sum(item['status'] == 'ready' for item in cached.values()),
        'missingReferences': [{'kind': kind, 'id': asset_id, 'variant': variant, 'reason': asset[variant].get('reason')} for kind, variants in asset_variants for asset_id, asset in mapping[kind].items() for variant in variants if not asset[variant]['repositoryPath']],
        'unavailableFiles': [item for item in cached.values() if item['status'] != 'ready'],
        'invalidReferences': invalid, 'transportError': transport_error,
    }
    mapping['report'] = {'uniqueReferencedFiles': report['uniqueReferencedFiles'], 'readyFiles': report['readyFiles']}
    (output_dir / 'asset-map.json').write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    (output_dir / 'asset-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path('public/data'))
    parser.add_argument('--out', type=Path, default=Path('public/assets/solarschool'))
    parser.add_argument('--source-dir', type=Path)
    parser.add_argument('--ref', default='main')
    parser.add_argument('--plan-only', action='store_true')
    args = parser.parse_args()
    try:
        report = prepare(args.data, args.out, args.source_dir, args.ref, args.plan_only)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f'{report["readyFiles"]}/{report["uniqueReferencedFiles"]} referenced WebP files validated and cached; {report["backgroundIds"]} backgrounds, {report["cgIds"]} CGs, {report["quizIds"]} quiz illustrations')
    print(f'Explicit map: {args.out / "asset-map.json"}')
    if report['transportError']:
        print(f'GitHub unavailable: {report["transportError"]}', file=sys.stderr)
    return 0 if args.plan_only or not report['unavailableFiles'] else 1


if __name__ == '__main__':
    sys.exit(main())
