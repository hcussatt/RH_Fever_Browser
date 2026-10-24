"""Disc-free checks that menu import and game import stay scoped."""
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
from paths import manifest


class Archive(dict):
    def __missing__(self, key):
        return b''


class ImportScope(unittest.TestCase):
    def run_import(self, icons_only):
        spec = importlib.util.spec_from_file_location('disc_scope', Path(__file__).resolve().parents[1]/'tools/extract-disc.py')
        module = importlib.util.module_from_spec(spec)
        fake=SimpleNamespace(WiiFiles=object,u8_files=lambda data:Archive({'placeholder':b''}),yaz0=lambda data:data)
        with patch.dict(sys.modules,{'wii_files':fake}):
            spec.loader.exec_module(module)
        reads = []

        class Disc:
            files = {'EN/content2/rev_tengoku.brsar': (0, 0)}
            def __init__(self, path):pass
            def raw(self, offset, length):return b'SOME01'
            def dol(self):return b'test executable'
            def get(self, path):reads.append(path);return b''

        with tempfile.TemporaryDirectory() as directory:
            module.DISC = Path(directory)
            module.DOL = Path(directory)/'main.dol'
            module.DOL_SHA1 = hashlib.sha1(b'test executable').hexdigest()
            module.WiiFiles = Disc
            module.u8_files = lambda data: Archive({'placeholder': b''})
            module.layout_fonts = lambda data: []
            module.main('test.iso', sound_archive=False, games=['golf'], icons_only=icons_only)
        return reads

    def test_icons_do_not_extract_any_gameplay_archives(self):
        self.assertTrue(all(path in {'EN/content2/layout/layout_gameSelect.szs', 'EN/content2/cellanim/bonusSelect/agb/cellanim.szs'} for path in self.run_import(True)))

    def test_one_game_does_not_extract_other_games(self):
        reads = self.run_import(False)
        self.assertIn(manifest('golf')['wii']['cellanim'], reads)
        for game in ['tap', 'rap', 'robot', 'remix1']:
            profile=manifest(game)['wii']
            for path in [profile['cellanim']] if 'cellanim' in profile else [s['cellanim'] for s in profile['scenes']]:
                self.assertNotIn(path, reads)


if __name__ == '__main__':
    unittest.main()
