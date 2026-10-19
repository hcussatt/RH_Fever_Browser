"""The manifest registry shared by Pages staging, its audit, and Actions."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def manifests(root=ROOT, *, validate=True):
    root = Path(root)
    validator = None
    if validate:
        from jsonschema import Draft202012Validator
        schema = json.loads((root/'schemas/game.schema.json').read_text())
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)
    result = []
    for path in sorted((root/'games').glob('*/game.json')):
        game = json.loads(path.read_text())
        if validator:
            errors = sorted(validator.iter_errors(game), key=lambda e: str(list(e.path)))
            if errors:
                details = '; '.join(f'{".".join(map(str,e.path)) or "manifest"}: {e.message}' for e in errors)
                raise ValueError(f'{path.relative_to(root)}: {details}')
        # Keep path identity checks effective even in the dependency-free source hook.
        identity = game.get('id', '')
        if not re.fullmatch(r'[a-z][a-z0-9_-]{0,47}', identity) or identity != path.parent.name:
            raise ValueError(f'{path}: id must match its game directory')
        if game.get('schemaVersion') != 1:
            raise ValueError(f'{path}: unsupported manifest schemaVersion')
        if validator:
            layout = game['wii'].get('layout', {})
            if any(i >= len(layout.get('animations', [])) for i in layout.get('startAtEnd', [])):
                raise ValueError(f'{path}: layout.startAtEnd index outside animations')
        result.append(game)
    if not result:
        raise ValueError('No game manifests found')
    return sorted(result, key=lambda g: (g.get('web', {}).get('order', 100), g['id']))


def web_games(root=ROOT, *, validate=True, require_runtime=True):
    games = [g for g in manifests(root, validate=validate) if g.get('web', {}).get('enabled') is True]
    if validate:
        if not games:
            raise ValueError('Enable at least one web game')
        for game in games:
            required = [f'adapters/{game["id"]}/game.h']
            if require_runtime:
                required.append(f'runtime-src/{game["id"]}/original-functions.inc')
                if 'scenes' in game['wii']:
                    required.append(f'runtime-src/{game["id"]}/scenes.h')
            for name in required:
                path = Path(root)/name
                if not path.is_file() or path.is_symlink():
                    raise ValueError(f'{game["id"]}: missing regular file {name}')
    return games


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--matrix', action='store_true', help='Print the Actions game matrix as JSON')
    parser.add_argument('--ids', action='store_true', help='Print enabled web game IDs, one per line')
    args = parser.parse_args()
    games = web_games()
    if args.matrix:
        print(json.dumps({'game': [g['id'] for g in games]}, separators=(',', ':')))
    elif args.ids:
        print('\n'.join(g['id'] for g in games))
    else:
        print(f'Validated {len(manifests())} manifests; {len(games)} web games enabled')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(str(error))
