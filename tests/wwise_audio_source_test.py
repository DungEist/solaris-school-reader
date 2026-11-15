"""Key selection and authored music-loop regressions; no real key is retained."""
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from wwise_sources import load_pak_keys, Pak
from wwise_bank import objects, music_plan

class AudioSourceTests(unittest.TestCase):
    def test_main_key_and_guid_keyring_are_distinct_and_validated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test-keys.json'
            path.write_text(json.dumps({'mainKey': '0x' + '11' * 32, 'dynamicKeys': [{'guid': '01234567-89abcdef-01020304-05060708', 'key': '0x' + '22' * 32}]}))
            keys = load_pak_keys(path)
            self.assertEqual(keys['0' * 32], bytes([17]) * 32)
            self.assertEqual(keys['0123456789ABCDEF0102030405060708'], bytes([34]) * 32)
            path.write_bytes(bytes([51]) * 32)
            self.assertEqual(load_pak_keys(path), bytes([51]) * 32)
            path.write_text(json.dumps({'mainKey': '0x11', 'dynamicKeys': []}))
            with self.assertRaisesRegex(ValueError, '32 bytes'):
                load_pak_keys(path)

    def test_nonzero_guid_never_tries_the_legacy_main_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.pak'
            data = bytearray(512)
            offset = 308
            struct.pack_into('<4I', data, offset - 17, 0x01234567, 0x89ABCDEF, 0x01020304, 0x05060708)
            data[offset - 1] = 1
            data[offset:offset + 4] = bytes.fromhex('e1126f5a')
            struct.pack_into('<I', data, offset + 4, 12)
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, 'GUID 0123456789ABCDEF0102030405060708'):
                Pak(path, bytes([17]) * 32)

    @unittest.skipUnless((ROOT / 'asset-work/audio/play_avg_music_3_8_spring_day-default.bnk').exists(), 'Local retained original bank required')
    def test_spring_loop_excludes_its_pre_entry_interval(self):
        path = ROOT / 'asset-work/audio/play_avg_music_3_8_spring_day-default.bnk'
        clip = music_plan(objects(path.read_bytes()))[0]
        self.assertEqual(clip['mediaId'], 404151635)
        self.assertEqual(clip['offset'], 2.4)
        self.assertEqual(clip['duration'], 103.2)
        self.assertTrue(clip['loop'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
