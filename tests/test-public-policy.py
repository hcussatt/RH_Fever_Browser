"""The runtime allowance must not allow arbitrary original/game material."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('clean', ROOT/'scripts/check-clean.py')
clean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean)


class PublicPolicy(unittest.TestCase):
    def test_common_key_is_blocked_everywhere(self):
        # The site no longer bundles the key (visitors enter their own); no path is exempt.
        # Built from the checker's digest so this test holds no key either.
        self.assertEqual(len(clean.COMMON_KEY_SHA256), 64)
        sample = b"export const KEY = '" + b'00'*16 + b"';\n"
        for name in ['web/import/common-key.mjs', 'import/common-key.mjs', 'tools/key.mjs']:
            self.assertFalse(clean.check(name, sample, set()), name)
        self.assertNotIn('PUBLIC_KEY_MODULES', vars(clean))

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
