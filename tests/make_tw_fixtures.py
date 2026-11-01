"""Exports Total War states through the real Lua bridges (mocked game, lupa) for the prompt audit.

usage: python tests/make_tw_fixtures.py <out_dir>
Writes tk_foreign.json and attila_foreign.json (Warhammer III fixtures come from
wh3_mod/tests/test_bridge.py --fixtures).
"""
import os, shutil, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.abspath(sys.argv[1])
os.makedirs(out, exist_ok=True)

def helpers(path):
    """The helper functions of a bridge test file, without running its tests."""
    src = open(path, encoding='utf-8').read()
    src = src.split('\nwith tempfile.TemporaryDirectory() as tmp:')[0]
    src = src.split('\ndef main():')[0]
    ns = {'__file__': path, '__name__': 'helpers'}
    exec(compile(src, path, 'exec'), ns)
    return ns

work = tempfile.mkdtemp(prefix='votc_fx_')

# Three Kingdoms: Liu Bei, met by Cao Cao
tk = helpers(os.path.join(REPO, 'tk_mod', 'tests', 'test_bridge_3k.py'))
L = tk['fresh'](work)
L.globals().mock.listeners['CharacterSelected'](L.eval('{ character = function() return liubei end }'))
with open('votc_commands.lua', 'w', encoding='utf-8') as f:
    f.write('return { cmds = { { id = "00000000000000000001", op = "export", reqId = "r1" } } }\n')
L.globals().mock.callbacks['votc_3k_poll_commands'].fn()
shutil.copy(os.path.join(work, 'votc_state.json'), os.path.join(out, 'tk_foreign.json'))

# Attila: Attila of the Huns, met by the Western Roman Empire
att = helpers(os.path.join(REPO, 'attila_mod', 'tests', 'test_bridge_attila.py'))
L = att['fresh'](work)
L.execute('mock.fire("FirstTickAfterWorldCreated", {})')
L.execute('mock.fire("CharacterSelected", { character = function() return attila end })')
with open('votc_commands.lua', 'w') as f:
    f.write('return { cmds = { { id = "00000000000000000002", op = "export", reqId = "r2", traits = "att_trait_general_personality_all_dishonest" } } }')
L.execute('mock.fire("TimeTrigger", { string = "votc_attila_poll" })')
shutil.copy(os.path.join(work, 'votc_state.json'), os.path.join(out, 'attila_foreign.json'))
os.chdir(REPO)
print('wrote', out)
