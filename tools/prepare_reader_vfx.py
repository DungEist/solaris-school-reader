"""Prepare exact VFX textures from retained local native-asset evidence.

This command performs no network requests and never opens the game installation.
Native prefabs/Niagara/material imports and decoded texture hashes are retained
in test-results/reader-vfx-source/asset-evidence.json. Browser visuals project
those textures; native shaders, particle simulation and 3D/VAT are not verified.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
READER_RENDERERS = {'UiItem_FxLoop_Danger': 'danger', 'UiItem_FxStart_Black': 'black',
                    'UiItem_FxStart_SpeedLine': 'speed-line', 'UiItem_FxStart_SpeedLineBlack': 'speed-line-black',
                    'UiItem_FxLoop_Fog': 'fog'}


def prepare(data, evidence_path, decoded, output):
    evidence = json.loads(evidence_path.read_text())
    references = {reference for reference in json.loads((data / 'assets.manifest.json').read_text())['fx'].values()
                  if reference}
    effects = evidence['effects']
    missing = sorted(references - effects.keys())
    if missing:
        raise ValueError(f'Authored VFX assets without retained evidence: {missing}')
    output.mkdir(parents=True, exist_ok=True)
    textures = {}
    for reference, source in evidence['textures'].items():
        filename = source['file']
        if Path(filename).name != filename or not filename.endswith('.png'):
            raise ValueError(f'Invalid decoded texture filename: {filename}')
        path = decoded / filename
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != source['sha256']:
            raise ValueError(f'Decoded VFX texture differs from recorded source: {filename}')
        with Image.open(path) as image:
            image.load()
            if image.size != (source['width'], source['height']) or image.mode != source['mode']:
                raise ValueError(f'Decoded VFX texture dimensions or mode differ: {filename}')
            alpha = image.getextrema()[-1] if image.mode == 'RGBA' else None
        destination = output / filename
        if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
            shutil.copyfile(path, destination)
        textures[reference] = {**source, 'sourceRef': reference, 'url': f'/assets/reader-vfx/{filename}',
                               'alpha': bool(alpha and alpha[0] < 255), 'alphaExtrema': alpha}
    resolved = {}
    for reference in sorted(references):
        source = effects[reference]
        images = [textures[ref] for ref in source['imageRefs']]
        primary_ref = source['primaryImageRef']
        if primary_ref and primary_ref not in source['imageRefs']:
            raise ValueError(f'Primary image is not a traced dependency: {reference}')
        resolved[reference] = {**{k: v for k, v in source.items() if k not in ['imageRefs', 'primaryImageRef']},
                               'images': images,
                               'primaryImage': textures[primary_ref]['url'] if primary_ref else None,
                               'primaryImageRef': primary_ref}
        if source['name'] in READER_RENDERERS:
            resolved[reference]['readerRenderer'] = READER_RENDERERS[source['name']]
            resolved[reference]['limitations'] = [*resolved[reference].get('limitations', []),
                'Visible Reader canvas material approximation; original shader and sequence curves remain unverified.']
    manifest = {'schema': 1, 'source': evidence['source'], 'effects': resolved,
                'limitations': ['Native shader/particle/3D/VAT behavior is not visually verified; browser previews use traced texture assets.',
                                'Standalone bitmaps for Black, Danger and SpeedLine shader effects are not verified.',
                                'Exact native screen/portrait Shake and EyeOpen sequence curves are not verified.'],
                'decodeLimitations': evidence['decodeLimitations']}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=ROOT / 'public/data')
    parser.add_argument('--evidence', type=Path, default=ROOT / 'test-results/reader-vfx-source/asset-evidence.json')
    parser.add_argument('--decoded', type=Path, default=ROOT / 'asset-work/reader-vfx/decoded')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/assets/reader-vfx')
    args = parser.parse_args()
    manifest = prepare(args.data, args.evidence, args.decoded, args.output)
    print(f'Prepared {len(manifest["effects"])} exact prefab references and their validated local texture assets.')


if __name__ == '__main__':
    main()
