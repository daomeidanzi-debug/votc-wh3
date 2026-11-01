"""Checks every compiled Paradox command against the game's own script files.

usage: python tests/check_commands.py <commands.json from dump_commands.cjs>

For each game, every key used as `key = ...` / `key ?= ...` in our effects and checks must
also be used that way in the game's vanilla scripts (or be defined by our own mod), and every
value name (traits, war goals, casus belli, subject types...) must appear in them. This
catches misspelled or invented effects and triggers without starting the game.
"""
import json, os, re, sys

STEAM = r'C:/Program Files (x86)/Steam/steamapps/common'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOTS = {
    'hoi4': [f'{STEAM}/Hearts of Iron IV/common', f'{STEAM}/Hearts of Iron IV/events', f'{STEAM}/Hearts of Iron IV/history'],
    'vic3': [f'{STEAM}/Victoria 3/game/common', f'{STEAM}/Victoria 3/game/events'],
    'eu5': [f'{STEAM}/Europa Universalis V/game/in_game/common', f'{STEAM}/Europa Universalis V/game/in_game/events', f'{STEAM}/Europa Universalis V/game/main_menu/common'],
    'stellaris': [f'{STEAM}/Stellaris/common', f'{STEAM}/Stellaris/events'],
}
MODS = {'hoi4': 'votc_hoi4', 'vic3': 'votc_vic3', 'eu5': 'votc_eu5', 'stellaris': 'votc_stellaris'}
# words that are syntax, not game content
SYNTAX = {'if', 'else_if', 'else', 'limit', 'NOT', 'OR', 'AND', 'NOR', 'NAND', 'yes', 'no', 'value', 'target', 'name', 'type'}
PREFIXES = ('c', 'global_var', 'event_target', 'trait', 'casus_belli', 'subject_type', 'scope', 'var')
LHS = re.compile(r'([A-Za-z_][A-Za-z0-9_.:]*)\s*\??=')
WORD = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')


def index(game, mod_roots):
    lhs, words = set(), set()
    # vanilla, our mod, and the player's enabled mods (what they add is checked against them)
    dirs = ROOTS[game] + [os.path.join(REPO, 'paradox_mods', MODS[game])] + mod_roots
    for root in dirs:
        for d, _, files in os.walk(root):
            for f in files:
                if not f.endswith('.txt'):
                    continue
                try:
                    text = open(os.path.join(d, f), encoding='utf-8-sig', errors='replace').read()
                except OSError:
                    continue
                text = re.sub(r'#[^\n]*', '', text)
                lhs.update(m.group(1).split(':')[-1] for m in LHS.finditer(text))
                words.update(WORD.findall(text))
    return lhs, words


def main():
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    failures = 0
    for game in ROOTS:
        if not os.path.isdir(ROOTS[game][0]):
            print(f'{game}: not installed, skipped')
            continue
        lhs, words = index(game, (data.get('roots', {}).get(game) or [])[1:])
        print(f'{game}: indexed {len(lhs)} keys / {len(words)} words')
        missing = {}
        for item in data.get(game, []):
            c = item.get('compiled')
            if not c:
                continue
            for part in (c.get('effect', ''), c.get('check') or ''):
                text = re.sub(r'"[^"]*"', '""', part)
                # scripted effect parameters (REASON = refresh) are ours, not game content
                text = re.sub(r'\b[A-Z][A-Z_]+\s*=\s*[a-z_]+', '', text)
                for m in LHS.finditer(text):
                    key = m.group(1)
                    base = key.split(':')[-1]
                    if key.split(':')[0] in PREFIXES and ':' in key:
                        continue  # a scope like c:GER = { ... }
                    if base in SYNTAX or base.startswith('global.'):
                        continue
                    if base not in lhs:
                        missing.setdefault(base, item['cmd']['op'])
                # values: prefixed database references and bare identifiers on the right side
                for m in re.finditer(r'\b(trait|casus_belli|subject_type):([a-z_0-9]+)', text):
                    if m.group(2) not in words:
                        missing.setdefault(f'{m.group(1)}:{m.group(2)}', item['cmd']['op'])
                for m in re.finditer(r'=\s*([a-z][a-z0-9_]*)\b(?!\s*[:=])', text):
                    v = m.group(1)
                    if v in SYNTAX or v.startswith('votc_') or v in ('trait', 'casus_belli', 'subject_type'):
                        continue
                    if v not in words:
                        missing.setdefault(v, item['cmd']['op'])
        for name, op in sorted(missing.items()):
            failures += 1
            print(f'  NOT FOUND in {game} scripts: {name}  (op {op})')
        if not missing:
            print(f'  every effect, trigger and value of {game} exists in the game files')
    print('FAILURES:', failures)
    sys.exit(1 if failures else 0)


main()
