"""The runtime allowance must not allow arbitrary original/game material."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('clean', ROOT/'scripts/check-clean.py')
clean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean)


class PublicPolicy(unittest.TestCase):
    def test_runtime_source_allowance_is_exact(self):
        translated = b'static void ' + b'p_80000000(void) {}'
        self.assertFalse(clean.check('runtime-src/golf/original-functions.inc', translated, set()))
        for name in ['tools/code.inc', 'runtime-src/unknown/original-functions.inc', 'runtime-src/golf/other.inc']:
            self.assertTrue(clean.check(name, translated, set()), name)

    def test_assets_remain_blocked_inside_runtime_directory(self):
        for name, data in [('runtime-src/golf/music.wav', b'RIFF'),
                           ('runtime-src/golf/game.wasm', b'\x00asm'),
                           ('runtime-src/golf/original-functions.inc', b'RWAV')]:
            self.assertTrue(clean.check(name, data, set()), name)


if __name__ == '__main__':
    unittest.main()
