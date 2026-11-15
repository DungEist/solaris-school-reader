"""Compare normalized Reader VFX with every authored flow performance.

Run after build_data.py with the normal local English source/data pair.
"""
import ast
from collections import Counter
import hashlib
import json
from pathlib import Path
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


class ReaderVfxSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.flows = {row['StateKey']: json.loads(row['Actions']) if row['Actions'] else []
                     for row in json.loads((ROOT / 'WutheringWaves_Data/BinData/flowState/flowstate.json').read_text())}
        cls.scripts = [json.loads(path.read_text()) for path in sorted((ROOT / 'public/data/scripts').glob('*.json'))]

    def test_every_vfx_field_and_phase_matches_its_authored_performance(self):
        counts = Counter()
        for script in self.scripts:
            items = {item['Id']: item for action in self.flows[script['stateKey']]
                     if action.get('Name') == 'ShowTalk' for item in action['Params'].get('TalkItems', [])}
            for node in script['nodes']:
                source = items[node['nid']]
                phases = [('start', None, source.get('StartPerformances', []), node['stage']),
                          ('end', None, source.get('EndPerformances', []), node['stage'])]
                for oi, option in enumerate(source.get('Options', [])):
                    phases.append(('option', oi, (option.get('TypeParams') or {}).get('OptionPerformances', []),
                                   node['options'][oi].get('performances', [])))
                for phase, oi, performances, normalized in phases:
                    originals = [p for p in performances if p.get('Type') in
                                 ['PlayScreenEffect', 'StopScreenEffect', 'PortraitEffect']]
                    effects = [p for p in normalized if p['op'] in ['screenFx', 'stopScreenFx', 'portraitFx']
                               and p.get('phase', 'start') == phase]
                    self.assertEqual(len(effects), len(originals), (script['id'], node['nid'], phase, oi))
                    for original, operation in zip(originals, effects):
                        context = (script['id'], node['nid'], phase, oi)
                        counts[original['Type']] += 1
                        self.assertEqual(operation['raw'], original, context)
                        self.assertEqual(operation['t'], original.get('StartTime', 0), context)
                        if original['Type'] == 'PortraitEffect':
                            self.assertEqual(operation['who'], str(original['WhoId']), context)
                            self.assertEqual(operation['fx'], original['EffectType'], context)
                            self.assertEqual(operation['amp'], original.get('Amplitude'), context)
                        else:
                            config = original.get('EffectConfig') or {}
                            self.assertEqual(operation['effectConfig'], config, context)
                            self.assertEqual(operation['fxType'], config.get('Type'), context)
                            expected_path = config.get({'OneShot': 'OneShotEffectPath',
                                                        'Persistent': 'PersistentEffectPath'}.get(config.get('Type')))
                            self.assertEqual(operation['path'], expected_path, context)
                            if config.get('Type') == 'Custom':
                                self.assertEqual(operation['customType'], config.get('CustomType'), context)
                                self.assertEqual(operation['fx'], config.get('CustomType'), context)
                            self.assertEqual(operation['op'], 'screenFx' if original['Type'] == 'PlayScreenEffect'
                                             else 'stopScreenFx', context)
        self.assertGreater(counts['PlayScreenEffect'], 100)
        self.assertGreater(counts['StopScreenEffect'], 40)
        self.assertGreater(counts['PortraitEffect'], 250)

    def test_requested_bursts_are_distinct_and_in_authored_order(self):
        script = next(s for s in self.scripts if s['id'] == '1006')
        effects = [p for n in script['nodes'] if n['nid'] == 15 for p in n['stage'] if p['op'] == 'screenFx']
        self.assertEqual([(p['fx'], p['t']) for p in effects],
                         [('UiItem_FxStart_Butterfly', 0), ('UiItem_FxStart_Huaban', .2)])
        self.assertTrue(all(p['path'] and p['fxType'] == 'OneShot' for p in effects))
        manifest = json.loads((ROOT / 'public/data/assets.manifest.json').read_text())
        for effect in effects:
            self.assertEqual(manifest['fx'][effect['fx']], effect['path'])

    def test_custom_future_parameters_survive_without_flattening_or_defaults(self):
        tree = ast.parse((ROOT / 'build_data.py').read_text())
        definitions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                       and node.name in ['stage_ops', 'tr', 'cue']]
        context = {'speaker': lambda who: str(who) if who else None,
                   'usage_unknown': Counter(), 'quiz_by_action': {}}
        exec(compile(ast.Module(body=definitions, type_ignores=[]), 'build_data.py', 'exec'), context)
        config = {'Type': 'Custom', 'CustomType': 'Shake', 'Duration': .41,
                  'Amplitude': 17, 'Parameters': {'Axis': 'X', 'Samples': [1, 0, -1]}}
        source = {'Type': 'PlayScreenEffect', 'StartTime': .2, 'EffectConfig': config, 'WhoId': 1316}
        stop = {'Type': 'StopScreenEffect', 'StartTime': .4, 'EffectConfig': config}
        play, end = context['stage_ops']([source, stop], 'option')
        self.assertEqual(play['effectConfig'], config)
        self.assertEqual(play['raw'], source)
        self.assertEqual(play['who'], '1316')
        self.assertEqual(end['effectConfig'], config)
        self.assertEqual(end['op'], 'stopScreenFx')
        self.assertEqual(end['phase'], 'option')

    def test_resolved_prefabs_use_exact_validated_texture_assets(self):
        manifest = json.loads((ROOT / 'public/assets/reader-vfx/manifest.json').read_text())
        authored = json.loads((ROOT / 'public/data/assets.manifest.json').read_text())
        expected = {path for path in authored['fx'].values() if path}
        self.assertEqual(set(manifest['effects']), expected)
        self.assertEqual(len(expected), 18)
        checked = set()
        for reference, effect in manifest['effects'].items():
            self.assertEqual(effect['sourceRef'], reference)
            self.assertTrue(effect['sourceVerified'])
            self.assertEqual(len(effect['prefab']['uassetSha256']), 64)
            self.assertEqual(len(effect['prefab']['uexpSha256']), 64)
            if effect['primaryImage']:
                self.assertIn(effect['primaryImage'], [image['url'] for image in effect['images']])
            for image in effect['images']:
                if image['url'] in checked:
                    continue
                checked.add(image['url'])
                self.assertTrue(image['url'].startswith('/assets/reader-vfx/'))
                path = ROOT / 'public' / image['url'].removeprefix('/')
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), image['sha256'])
                with Image.open(path) as decoded:
                    decoded.load()
                    self.assertEqual(decoded.size, (image['width'], image['height']))
                self.assertIn(image['role'], ['sprite', 'mask', 'noise', 'vat', 'lookup'])
        self.assertGreater(len(checked), 40)

    def test_requested_sprites_and_native_atlas_layouts_are_verified(self):
        manifest = json.loads((ROOT / 'public/assets/reader-vfx/manifest.json').read_text())
        effects = {effect['name']: effect for effect in manifest['effects'].values()}
        butterfly = effects['UiItem_FxStart_Butterfly']
        self.assertEqual(butterfly['primaryImage'], '/assets/reader-vfx/T_UI_Wenli_X140011.png')
        wing = next(image for image in butterfly['images'] if image['url'] == butterfly['primaryImage'])
        self.assertEqual((wing['width'], wing['height']), (256, 512))
        self.assertEqual(wing['role'], 'sprite')
        for name, layout in [('UiItem_FxStart_Huaban', (2, 2)), ('UiItem_FxLoop_SunGlow', (4, 4))]:
            effect = effects[name]
            primary = next(image for image in effect['images'] if image['url'] == effect['primaryImage'])
            self.assertEqual((primary['columns'], primary['rows']), layout)
            self.assertEqual(primary['atlasMode'], 'variants')
            self.assertEqual(primary['layoutEvidence']['property'], 'SubImageSize')
            self.assertEqual(primary['layoutEvidence']['parameter'], 'Base')


if __name__ == '__main__':
    unittest.main(verbosity=2)
