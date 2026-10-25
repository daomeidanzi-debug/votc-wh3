"""Runs every Warhammer III port test.

    python wh3_mod/tests/run_tests.py

Needs: Python with `lupa` (pip install lupa) and Node. TypeScript is taken from
node_modules/typescript after `npm install`, or from $VOTC_TS.
"""
import os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))

def run(cmd, env=None):
    print('\n$', ' '.join(cmd), flush=True)
    return subprocess.call(cmd, cwd=HERE, env=env)

def main():
    work = tempfile.mkdtemp(prefix='votc_tests_')
    fixtures = os.path.join(work, 'fixtures')
    commands = os.path.join(work, 'e2e_commands.lua')
    env = dict(os.environ)
    env.setdefault('VOTC_TS', os.path.join(REPO, 'node_modules', 'typescript'))

    steps = [
        ([sys.executable, 'test_bridge.py'], 'Lua bridge unit tests'),
        ([sys.executable, 'test_bridge.py', '--fixtures', fixtures], 'bridge export fixtures'),
        (['node', os.path.join('node', 'pipeline.test.cjs'), fixtures, commands], 'main-process pipeline'),
        ([sys.executable, 'test_bridge.py', commands], 'serialized actions through the Lua bridge'),
    ]
    failed = []
    for cmd, name in steps:
        if run(cmd, env) != 0:
            failed.append(name)
    print('\n' + ('ALL TESTS PASSED' if not failed else 'FAILED: ' + ', '.join(failed)))
    sys.exit(1 if failed else 0)

main()
