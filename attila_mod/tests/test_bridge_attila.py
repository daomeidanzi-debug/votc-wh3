"""Runs votc_attila.lua against mock_attila.lua in a real Lua 5.1 VM (lupa).

usage: python attila_mod/tests/test_bridge_attila.py
"""
import json, os, sys, tempfile
from lupa.lua51 import LuaRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.join(HERE, '..', 'lua_scripts', 'votc_attila.lua')

failures = 0
def check(cond, msg):
    global failures
    if cond:
        print('  ok  ', msg)
    else:
        failures += 1
        print('  FAIL', msg)

def fresh(workdir):
    os.chdir(workdir)
    for f in ('votc_state.json', 'votc_commands.lua', 'votc_ack.json'):
        if os.path.exists(f):
            os.remove(f)
    L = LuaRuntime(unpack_returned_tuples=True)
    L.execute(open(os.path.join(HERE, 'mock_attila.lua'), encoding='utf-8').read())
    L.execute(open(MOD, encoding='utf-8').read())
    L.execute(r'''
        wre = mock.add_faction("att_fact_western_roman_empire", { human = true, treasury = 9000 })
        huns = mock.add_faction("att_fact_huns", { treasury = 400 })
        mock.local_faction = wre
        rome = mock.add_region("att_reg_italia_roma", wre)
        sirmium = mock.add_region("att_reg_pannonia_sirmium", huns)
        honorius = mock.add_character(1, wre, { forename = "names_name_1", leader = true, region = rome })
        theo = mock.add_character(5, wre, { forename = "names_name_9" })
        attila = mock.add_character(2, huns, { forename = "names_name_2147343873", leader = true, region = sirmium,
            traits = { att_trait_general_personality_all_dishonest = true }, father = theo })
        mock.wars["att_fact_huns|att_fact_western_roman_empire"] = true
    ''')
    return L

with tempfile.TemporaryDirectory() as tmp:
    print('attila bridge')
    L = fresh(tmp)
    L.execute('mock.fire("FirstTickAfterWorldCreated", {})')
    check(os.path.exists('votc_ack.json'), 'start writes an empty ack')
    check(list(L.eval('mock.triggers').values()) == ['votc_attila_poll'], 'poll timer armed')

    # nothing selected
    with open('votc_commands.lua', 'w') as f:
        f.write('return { cmds = { { id = "00000000000000000001", op = "export", reqId = "r1" } } }')
    L.execute('mock.fire("TimeTrigger", { string = "votc_attila_poll" })')
    state = json.load(open('votc_state.json', encoding='utf-8'))
    check(state['reqId'] == 'r1' and state['error'] == 'nothing_selected', 'export without a selection reports nothing_selected')
    check(len(list(L.eval('mock.triggers').values())) == 2, 'timer re-armed after each poll')

    # select Attila on the map
    L.execute('mock.fire("CharacterSelected", { character = function() return attila end })')
    with open('votc_commands.lua', 'w') as f:
        f.write('return { cmds = { { id = "00000000000000000002", op = "export", reqId = "r2", traits = "att_trait_general_personality_all_dishonest,att_trait_x" } } }')
    L.execute('mock.fire("TimeTrigger", { string = "votc_attila_poll" })')
    state = json.load(open('votc_state.json', encoding='utf-8'))
    check(state['ok'] is True and state['targetSource'] == 'selection', 'export of the selected character')
    check(state['target']['name'] == '{{names_name_2147343873}}', 'names travel as loc tokens: ' + state['target']['name'])
    check(state['target']['traits'] == ['att_trait_general_personality_all_dishonest'], 'traits tested from the list the app sends')
    check(state['target']['family'].get('father') == '{{names_name_9}}', 'father exported, missing family tree tolerated')
    check(state['targetFaction']['atWarWithPlayer'] is True, 'war with the player')
    check(state['targetFaction']['name'] == '{{factions_screen_name_att_fact_huns}}', 'faction name token')
    check(state['campaignId'] == 'main_attila_att_fact_western_roman_empire', 'campaign id per campaign and faction')
    check(len(state['world']) == 2 and state['world'][0]['atWarWith'], 'world situation')

    # commands
    with open('votc_commands.lua', 'w') as f:
        f.write('''return { cmds = {
            { id = "00000000000000000003", op = "transfer_gold", from = "att_fact_western_roman_empire", to = "att_fact_huns", amount = 500 },
            { id = "00000000000000000004", op = "peace", a = "att_fact_huns", b = "att_fact_western_roman_empire" },
            { id = "00000000000000000005", op = "add_trait", cqi = 2, trait = "att_trait_all_personality_all_sober" },
            { id = "00000000000000000006", op = "kill", cqi = 1 },
            { id = "00000000000000000007", op = "transfer_gold", from = "att_fact_huns", to = "att_fact_western_roman_empire", amount = 999999 },
            { id = "00000000000000000008", op = "add_trait", cqi = 2, trait = "bad; os.exit()" },
        } }''')
    L.execute('mock.fire("TimeTrigger", { string = "votc_attila_poll" })')
    ack = json.load(open('votc_ack.json', encoding='utf-8'))
    res = {r['id'][-1]: r for r in ack['results']}
    check(ack['lastId'] == '00000000000000000008', 'ack names the last id')
    check(res['3']['ok'] and res['4']['ok'] and res['5']['ok'], 'gold, peace and trait applied')
    check(not res['6']['ok'] and 'human faction leader' in res['6']['message'], 'never kills the player')
    check(not res['7']['ok'] and 'only has' in res['7']['message'], 'payer cannot pay more than it has')
    check(not res['8']['ok'], 'trait keys are validated')
    calls = [(c['name'], list(c['args'].values())) for c in L.eval('mock.calls').values()]
    check(calls[0] == ('treasury_mod', ['att_fact_western_roman_empire', -500]) and calls[1] == ('treasury_mod', ['att_fact_huns', 500]), 'treasury_mod both ways')
    check(('force_make_peace', ['att_fact_huns', 'att_fact_western_roman_empire']) in calls, 'force_make_peace by faction keys')
    check(('force_add_trait', ['character_cqi:2', 'att_trait_all_personality_all_sober', True]) in calls, 'force_add_trait with a lookup string')

    # the same file again runs nothing
    n = len(calls)
    L.execute('mock.fire("TimeTrigger", { string = "votc_attila_poll" })')
    check(len(list(L.eval('mock.calls').values())) == n, 'commands never run twice')

    # other timers are ignored; multiplayer disables the bridge
    L2 = fresh(tmp)
    L2.execute('mock.multiplayer = true; mock.fire("FirstTickAfterWorldCreated", {})')
    check(len(list(L2.eval('mock.triggers').values())) == 0, 'multiplayer: no polling')

    os.chdir(HERE)

print("FAILED" if failures else "all passed", failures)
sys.exit(1 if failures else 0)
