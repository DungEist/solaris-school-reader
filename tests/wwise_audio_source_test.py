"""Key selection and authored music-loop regressions; no real key is retained."""
import json
import hashlib
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
from Crypto.Cipher import AES
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from wwise_sources import load_pak_keys, Pak
from wwise_bank import objects, music_plan

class AudioSourceTests(unittest.TestCase):
    def compressed_fixture(self, directory, blocks=1, corrupt=False):
        key = bytes([0x31]) * 32
        plain = [bytes((i + block) % 251 for i in range(4099)) for block in range(blocks)]
        stored = []
        for index, block in enumerate(plain):
            padded = block + bytes(-len(block) % 16)
            stored.append(AES.new(key, AES.MODE_ECB).encrypt(padded[:2048]) + padded[2048:] if index == 0 else padded)
        header_size = 52 + blocks * 16 + 5
        header = bytearray(header_size)
        header[28:48] = hashlib.sha1(b''.join(stored)).digest()
        struct.pack_into('<I', header, 48, blocks)
        offset = header_size
        for index, (original, encoded) in enumerate(zip(plain, stored)):
            struct.pack_into('<QQ', header, 52 + index * 16, offset, offset + len(original))
            offset += len(encoded)
        payload = bytearray(b''.join(stored))
        if corrupt:
            payload[2500] ^= 1  # Beyond the decryption prefix, inside the checksum.
        path = Path(directory) / 'fixture.pak'
        path.write_bytes(header + payload)
        pak = object.__new__(Pak)
        pak.path, pak.key = path, key
        pak.entry = lambda _: {'offset': 0, 'size': blocks * 24, 'compressed': len(payload),
                               'compression': 1, 'encrypted': True, 'custom': 2,
                               'blocks': blocks, 'blockSize': 24}
        return pak, plain

    def test_partial_encryption_compressed_checksum_covers_the_whole_aligned_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            pak, expected = self.compressed_fixture(directory)
            def decompress(command, **kwargs):
                self.assertEqual(Path(command[2]).read_bytes(), expected[0])
                Path(command[3]).write_bytes(bytes([7]) * int(command[4]))
            with patch('subprocess.run', side_effect=decompress):
                self.assertEqual(pak.extract('voice.wem'), bytes([7]) * 24)

    def test_compressed_corruption_after_2kib_is_rejected_before_decompression(self):
        with tempfile.TemporaryDirectory() as directory:
            pak, _ = self.compressed_fixture(directory, corrupt=True)
            with patch('subprocess.run') as decompress:
                with self.assertRaisesRegex(ValueError, 'Stored SHA1 mismatch'):
                    pak.extract('voice.wem')
                decompress.assert_not_called()

    def test_all_compression_blocks_are_read_beyond_the_old_fixed_header_window(self):
        with tempfile.TemporaryDirectory() as directory:
            pak, expected = self.compressed_fixture(directory, blocks=7)
            index = 0
            def decompress(command, **kwargs):
                nonlocal index
                self.assertEqual(Path(command[2]).read_bytes(), expected[index])
                Path(command[3]).write_bytes(bytes([index]) * int(command[4]))
                index += 1
            with patch('subprocess.run', side_effect=decompress):
                self.assertEqual(pak.extract('voice.wem'), b''.join(bytes([i]) * 24 for i in range(7)))
            self.assertEqual(index, 7)

    def test_uncompressed_partial_encryption_keeps_its_authored_prefix_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            key = bytes([0x31]) * 32
            plain = bytes(i % 251 for i in range(4102))
            stored = AES.new(key, AES.MODE_ECB).encrypt(plain[:2048]) + plain[2048:] + bytes(-len(plain) % 16)
            header = bytearray(53)
            header[28:48] = hashlib.sha1(stored[:2048]).digest()
            path = Path(directory) / 'fixture.pak'
            path.write_bytes(header + stored)
            pak = object.__new__(Pak)
            pak.path, pak.key = path, key
            pak.entry = lambda _: {'offset': 0, 'size': len(plain), 'compression': 0, 'encrypted': True, 'custom': 2}
            self.assertEqual(pak.extract('voice.wem'), plain)

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
