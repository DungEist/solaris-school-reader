"""Small local fixtures exercise the asset pipeline without network/assets."""
import base64
import io
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import tempfile
from unittest.mock import patch
from subprocess import CompletedProcess

spec = importlib.util.spec_from_file_location('prepare_assets', Path(__file__).resolve().parents[1] / 'tools/prepare_assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)

image = base64.b64decode('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA')
assert assets.webp_dimensions(image) == (1, 1)
for invalid in (b'<html>not found</html>', b'version https://git-lfs.github.com/spec/v1', image[:-1], b'RIFF' + struct.pack('<I', 4) + b'WEBP'):
    try:
        assets.webp_dimensions(invalid)
        raise AssertionError('Malformed WebP accepted')
    except ValueError:
        pass

def reference(folder, name):
    return f'{assets.UE_PREFIX}{assets.SOLAR_ROOT}{folder}/{name}.{name}'

for invalid in (reference('Bg', '../Escape'), reference('Bg', 'Bad?name'), reference('Bg', '%2Fescape'), '/Game/Other/File.File'):
    try:
        assets.ue_webp_path(invalid)
        raise AssertionError('Invalid UE path accepted')
    except ValueError:
        pass

with patch.object(assets.shutil, 'which', return_value='/usr/bin/gh'), \
     patch.object(assets.subprocess, 'run', return_value=CompletedProcess([], 1, b'', b'Please run gh auth login')), \
     patch.object(assets.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"sha":"public-fixture"}')):
    assert assets.api('repos/fixture/commits/main') == {'sha': 'public-fixture'}, 'Public asset reads must work without a gh login'

with tempfile.TemporaryDirectory(prefix='solaris-assets-test-') as temporary:
    root = Path(temporary)
    source = root / 'SolarSchool'
    data = root / 'data'
    output = root / 'cache'
    source.mkdir(); data.mkdir()
    day = reference('Bg', 'Day')
    female = reference('CG', 'Female')
    male = reference('HighCG', 'Male')
    missing = reference('Bg', 'Missing')
    manifest = {'backgrounds': {'10': {'day': day, 'night': day}, '11': {'day': missing, 'night': None}}, 'cgs': {'20': {'path': female, 'pathMale': male}, '21': {'path': female}}}
    (data / 'assets.manifest.json').write_text(json.dumps(manifest))
    (data / 'assets.usage.json').write_text(json.dumps({'x1': {'bg': [10, 11, 800001], 'cg': [20, 21]}}))
    for folder, name, payload in (('Bg', 'Day', image), ('CG', 'Female', image), ('HighCG', 'Male', image), ('Bg', 'Unreferenced', image)):
        target = source / folder / f'{name}.webp'
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(payload)
    report = assets.prepare(data, output, source_dir=source)
    mapping = json.loads((output / 'asset-map.json').read_text())
    assert report['uniqueReferencedFiles'] == 4
    assert report['readyFiles'] == 3
    assert len(list(output.rglob('*.webp'))) == 3, 'Only referenced assets may be copied'
    assert mapping['backgrounds']['10']['day']['localPath'] == mapping['backgrounds']['10']['night']['localPath']
    assert mapping['cgs']['21']['maleUsesBase'] is True
    assert mapping['cgs']['20']['female']['localPath'] != mapping['cgs']['20']['male']['localPath']
    assert mapping['backgrounds']['800001']['day']['status'] == 'missing'
    assert mapping['backgrounds']['11']['day']['status'] == 'missing'
    path = output / mapping['backgrounds']['10']['day']['localPath']
    modified = path.stat().st_mtime_ns
    assets.prepare(data, output, source_dir=source)
    assert path.stat().st_mtime_ns == modified, 'Valid unchanged cache should be reused'
    repository = root / 'repository'
    shutil.copytree(source, repository / assets.SOLAR_ROOT)
    repo_report = assets.prepare(data, root / 'repo-cache', source_dir=repository)
    assert repo_report['readyFiles'] == 3, 'An exact repository-root source must resolve the same files'
    (source / 'HighCG/Male.webp').write_bytes(b'corrupt file')
    assets.prepare(data, output, source_dir=source)
    mapping = json.loads((output / 'asset-map.json').read_text())
    assert mapping['cgs']['20']['male']['status'] == 'missing'
    assert mapping['cgs']['20']['male']['localPath'] is None
    plan_dir = root / 'plan'
    report = assets.prepare(data, plan_dir, plan_only=True)
    assert report['readyFiles'] == 0
    assert not list(plan_dir.rglob('*.webp'))

quiz_ref = f'{assets.UE_PREFIX}{assets.QUIZ_ROOT}Question.Question'
assert assets.ue_quiz_webp_path(quiz_ref) == f'{assets.QUIZ_ROOT}Question.webp'
for invalid in (quiz_ref.replace('IconExam/', 'Other/'), quiz_ref.replace('IconExam/', 'IconExam/../'), reference('Bg', 'Day')):
    try:
        assets.ue_quiz_webp_path(invalid)
        raise AssertionError('Out-of-directory quiz path accepted')
    except ValueError:
        pass

with tempfile.TemporaryDirectory(prefix='solaris-quiz-assets-test-') as temporary:
    root = Path(temporary)
    data = root / 'data'
    source = root / 'repository'
    output = root / 'cache'
    data.mkdir()
    quiz_path = source / assets.QUIZ_ROOT / 'Question.webp'
    quiz_path.parent.mkdir(parents=True)
    quiz_path.write_bytes(image)
    (quiz_path.parent / 'Unreferenced.webp').write_bytes(image)
    missing = quiz_ref.replace('Question', 'Missing')
    manifest = {'backgrounds': {}, 'cgs': {}, 'quizzes': {'1': {'path': quiz_ref}, '2': {'path': quiz_ref}, '3': {'path': missing}, '4': {'path': reference('Bg', 'Day')}}}
    (data / 'assets.manifest.json').write_text(json.dumps(manifest))
    (data / 'assets.usage.json').write_text(json.dumps({'quiz-script': {'quiz': [1, 2, 3, 4, 5]}}))
    report = assets.prepare(data, output, source_dir=source)
    mapping = json.loads((output / 'asset-map.json').read_text())
    assert report['uniqueReferencedFiles'] == 2
    assert report['readyFiles'] == 1
    assert report['quizIds'] == 5
    assert len(list(output.rglob('*.webp'))) == 1
    assert mapping['quizzes']['1']['question']['localPath'] == mapping['quizzes']['2']['question']['localPath']
    assert mapping['quizzes']['3']['question']['status'] == 'missing'
    assert mapping['quizzes']['4']['question']['repositoryPath'] is None
    assert mapping['quizzes']['5']['question']['status'] == 'missing'
    cached = output / mapping['quizzes']['1']['question']['localPath']
    modified = cached.stat().st_mtime_ns
    assets.prepare(data, output, source_dir=source)
    assert cached.stat().st_mtime_ns == modified
    quiz_path.write_bytes(b'corrupt illustration')
    assets.prepare(data, output, source_dir=source)
    mapping = json.loads((output / 'asset-map.json').read_text())
    assert mapping['quizzes']['1']['question']['status'] == 'missing'
    assert mapping['quizzes']['1']['question']['localPath'] is None
    report = assets.prepare(data, root / 'plan', plan_only=True)
    assert report['readyFiles'] == 0

print('asset preparation checks passed')
