"""Contract tests use synthetic plugins, never original game data."""
import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from game_registry import manifests, web_games


class GameRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(ROOT/'schemas', self.root/'schemas')
        self.base = json.loads((ROOT/'games/golf/game.json').read_text())

    def add(self, identity, *, enabled=True, runtime=True, order=100):
        game = copy.deepcopy(self.base)
        game['id'] = identity
        game['web'] = {'enabled': enabled, 'order': order, 'expectedCues': 7}
        path = self.root/'games'/identity/'game.json'
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(game))
        adapter = self.root/'adapters'/identity/'game.h'
        adapter.parent.mkdir(parents=True)
        adapter.touch()
        if runtime:
            source = self.root/'runtime-src'/identity/'original-functions.inc'
            source.parent.mkdir(parents=True)
            source.touch()
        return path

    def test_new_game_is_discovered_without_a_hard_coded_list(self):
        self.add('newgame', order=1)
        self.add('other', order=2)
        self.add('localonly', enabled=False, runtime=False)
        self.assertEqual([g['id'] for g in web_games(self.root)], ['newgame', 'other'])

    def test_disabled_game_does_not_need_a_public_snapshot(self):
        self.add('playable')
        self.add('unfinished', enabled=False, runtime=False)
        self.assertEqual(len(manifests(self.root)), 2)
        self.assertEqual(len(web_games(self.root)), 1)

    def test_missing_runtime_fails_before_build_or_deployment(self):
        self.add('unfinished', runtime=False)
        with self.assertRaisesRegex(ValueError, 'original-functions.inc'):
            web_games(self.root)

    def test_identity_schema_version_typo_paths_and_cue_contract(self):
        path = self.add('candidate')
        base = json.loads(path.read_text())
        for mutate in [lambda g: g.update(id='different'),
                       lambda g: g.update(schemaVersion=2),
                       lambda g: g['web'].update(enable=True),
                       lambda g: g['web'].pop('expectedCues'),
                       lambda g: g['web'].update(expectedCues=0),
                       lambda g: g['wii'].update(cellanim='../private.szs'),
                       lambda g: g['wii'].update(units=['../../source.cpp'])]:
            game = copy.deepcopy(base)
            mutate(game)
            path.write_text(json.dumps(game))
            with self.assertRaises(ValueError):
                web_games(self.root)

    def test_layout_animation_indices_are_checked(self):
        path = self.add('layoutgame')
        game = json.loads(path.read_text())
        game['wii']['layout'] = copy.deepcopy(json.loads((ROOT/'games/rap/game.json').read_text())['wii']['layout'])
        game['wii']['layout']['startAtEnd'] = [1000]
        path.write_text(json.dumps(game))
        with self.assertRaisesRegex(ValueError, 'startAtEnd'):
            web_games(self.root)

    def test_remix_requires_its_scene_modules_to_be_enabled(self):
        path = self.add('mix')
        game = json.loads(path.read_text())
        game['wii'] = copy.deepcopy(json.loads((ROOT/'games/remix1/game.json').read_text())['wii'])
        path.write_text(json.dumps(game))
        with self.assertRaisesRegex(ValueError, 'must also be web-enabled'):
            web_games(self.root)


if __name__ == '__main__':
    unittest.main()
