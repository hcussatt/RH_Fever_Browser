"""The runtime allowance must not allow arbitrary original/game material."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('clean', ROOT/'scripts/check-clean.py')
clean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean)


class PublicPolicy(unittest.TestCase):
    def test_public_key_allowance_is_exact(self):
        module=(ROOT/'web/import/common-key.mjs').read_bytes()
        self.assertFalse(clean.check('web/import/common-key.mjs',module,set()))
        self.assertFalse(clean.check('import/common-key.mjs',module,set()))
        self.assertTrue(clean.check('tools/key.mjs',module,set()))
        self.assertTrue(clean.check('web/import/common-key.mjs',module+b'export const unrelated = true;\n',set()))

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
