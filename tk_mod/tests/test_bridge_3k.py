"""Runs votc_3k.lua against mock_3k.lua in a real Lua 5.1 VM (lupa).

usage: python tk_mod/tests/test_bridge_3k.py
"""
import json, os, sys, tempfile
from lupa.lua51 import LuaRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.join(HERE, '..', 'script', 'campaign', 'mod', 'votc_3k.lua')

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
    os.makedirs('data', exist_ok=True)
    with open(os.path.join('data', 'language.txt'), 'w') as f:
        f.write('CN')
    L = LuaRuntime(unpack_returned_tuples=True)
    L.execute(open(os.path.join(HERE, 'mock_3k.lua'), encoding='utf-8').read())
    L.execute(open(MOD, encoding='utf-8').read())
    L.execute(r'''
        mock.loc["names_cao"] = "曹"
        mock.loc["names_cao_cao"] = "操"
        mock.loc["names_liu"] = "刘"
        mock.loc["names_bei"] = "备"
        mock.loc["names_zhang"] = "张"
        mock.loc["names_fei"] = "飞"
        mock.loc["character_relationships_name_3k_main_relationship_positive_03"] = "义亲"
        mock.loc["factions_screen_name_3k_main_faction_cao_cao"] = "曹操"
        mock.loc["factions_screen_name_3k_main_faction_liu_bei"] = "刘备"
        mock.loc["regions_onscreen_3k_main_chenliu_capital"] = "陈留"
        mock.loc["frontend_faction_leader_unique_characters_localised_description_3k_main_template_historical_liu_bei_hero_earth"] = "[[b]]刘备[[/b]]  将领类型：{{tr:3k_general_type_earth}}  [[col:flavour]][[i]]仁德之君。[[/col]][[/i]]"
        mock.loc["regions_onscreen_3k_main_pingyuan_capital"] = "平原"
        cao = mock.add_faction("3k_main_faction_cao_cao", { human = true, treasury = 5000 })
        liu = mock.add_faction("3k_main_faction_liu_bei", { treasury = 300, standing = { ["3k_main_faction_cao_cao"] = -20 } })
        mock.local_faction = cao
        chenliu = mock.add_region("3k_main_chenliu_capital", cao)
        pingyuan = mock.add_region("3k_main_pingyuan_capital", liu)
        caocao = mock.add_character(1, cao, { surname = "names_cao", forename = "names_cao_cao", leader = true, army = true, region = chenliu,
            template = "3k_main_template_historical_cao_cao_hero_earth" })
        liubei = mock.add_character(2, liu, { surname = "names_liu", forename = "names_bei", leader = true, army = true, units = { "3k_main_unit_spear" },
            region = pingyuan, template = "3k_main_template_historical_liu_bei_hero_earth", traits = { "3k_main_ceo_trait_personality_kind" },
            rels = { { "3k_main_relationship_positive_03", 3 }, { "3k_main_relationship_negative_01", 1 } } })
        zhangfei = mock.add_character(3, liu, { surname = "names_zhang", forename = "names_fei", loyalty = 90,
            template = "3k_main_template_historical_zhang_fei_hero_fire" })
    ''')
    L.globals().votc_3k()
    return L

def write_cmds(text):
    with open('votc_commands.lua', 'w', encoding='utf-8') as f:
        f.write(text)

def poll(L):
    L.globals().mock.callbacks['votc_3k_poll_commands'].fn()

def ack():
    with open('votc_ack.json', encoding='utf-8') as f:
        return json.load(f)

def calls(L, name):
    out = []
    c = L.globals().mock.calls
    for i in range(1, len(c) + 1):
        if c[i].name == name:
            args = c[i].args
            out.append([args[j] for j in range(1, len(args) + 1)])
    return out

def main():
    work = tempfile.mkdtemp(prefix='votc_3k_')

    print('startup')
    L = fresh(work)
    check(L.globals().mock.callbacks['votc_3k_poll_commands'] is not None, 'poll timer registered')
    check(L.globals().mock.callbacks['votc_3k_poll_commands'].t == 0.5, 'timer interval in seconds')
    check(os.path.exists('votc_ack.json') and ack()['lastId'] == '0' * 20, 'empty ack written on start')
    check(L.globals().mock.saved['votc_campaign_id'] is not None, 'campaign id stored in the save')

    print('export')
    L.globals().mock.listeners['CharacterSelected'](L.eval('{ character = function() return liubei end }'))
    write_cmds('return { cmds = { { id = "00000000000000000001", op = "export", reqId = "r1" } } }\n')
    poll(L)
    state = json.load(open('votc_state.json', encoding='utf-8'))
    check(state['ok'] and state['reqId'] == 'r1', 'export answers the request')
    check(state['player']['name'] == '曹操' and state['target']['name'] == '刘备', 'Chinese names are surname first')
    check(state['dateText'] == '191年秋', 'date in the game language: ' + str(state.get('dateText')))
    check(state['target']['classKey'] == 'earth' and state['target']['subtypeName'] == '指挥', 'class from the generation template')
    check(state['target']['subtypeKey'] == '3k_main_template_historical_liu_bei_hero_earth', 'template key for backstories')
    check(state['target'].get('biography') == '刘备 将领类型： 仁德之君。', 'biography from the game text: ' + str(state['target'].get('biography')))
    check(state['target']['relationships'] == [{'kind': '义亲', 'name': '张飞'}], 'sworn kin named, acquaintances left out: ' + str(state['target'].get('relationships')))
    check(isinstance(state['target'].get('family'), dict), 'family block present')
    check(state['target']['traits'] == ['3k_main_ceo_trait_personality_kind'], 'personality traits read from CEOs')
    check(state['targetFaction']['attitudeToPlayer'] == -20, 'diplomatic standing as attitude')
    check(state['targetFaction']['atWarWithPlayer'] is False, 'not at war yet')
    check(state['target']['army']['unitCount'] == 2 and state['target']['army']['units'][0]['count'] == 1, 'army units without the general')
    check(state['playerFaction']['capitalName'] == '陈留', 'capital name')

    L.globals().mock.listeners['CharacterSelected'](L.eval('{ character = function() return caocao end }'))
    write_cmds('return { cmds = { { id = "00000000000000000002", op = "export", reqId = "r2" } } }\n')
    poll(L)
    state = json.load(open('votc_state.json', encoding='utf-8'))
    check(state['ok'] and state['target']['cqi'] == 2, "clicking your own leader keeps the previous target")

    L.globals().mock.listeners['SettlementSelected'](L.eval('{ settlement = function() return { region = function() return pingyuan end } end }'))
    write_cmds('return { cmds = { { id = "00000000000000000003", op = "export", reqId = "r3" } } }\n')
    poll(L)
    state = json.load(open('votc_state.json', encoding='utf-8'))
    check(state['ok'] and state['targetSource'] == 'settlement' and state['sceneRegionName'] == '平原', 'settlement selection talks to its owner there')

    print('commands')
    write_cmds('''return { cmds = {
        { id = "00000000000000000010", op = "transfer_gold", from = "3k_main_faction_liu_bei", to = "3k_main_faction_cao_cao", amount = 100 },
        { id = "00000000000000000011", op = "transfer_gold", from = "3k_main_faction_liu_bei", to = "3k_main_faction_cao_cao", amount = 99999 },
        { id = "00000000000000000012", op = "war", a = "3k_main_faction_liu_bei", b = "3k_main_faction_cao_cao" },
        { id = "00000000000000000013", op = "war", a = "3k_main_faction_liu_bei", b = "3k_main_faction_cao_cao" },
        { id = "00000000000000000014", op = "peace", a = "3k_main_faction_liu_bei", b = "3k_main_faction_cao_cao" },
        { id = "00000000000000000015", op = "add_trait", cqi = 3, trait = "3k_main_ceo_trait_personality_brave" },
        { id = "00000000000000000016", op = "add_trait", cqi = 3, trait = "wh2_main_trait_fighter" },
        { id = "00000000000000000017", op = "add_xp", cqi = 3, levels = 2 },
        { id = "00000000000000000018", op = "transfer_region", region = "3k_main_pingyuan_capital", from = "3k_main_faction_liu_bei", to = "3k_main_faction_cao_cao" },
        { id = "00000000000000000019", op = "kill", cqi = 1 },
        { id = "00000000000000000020", op = "kill", cqi = 3 },
        { id = "00000000000000000021", op = "os_execute" },
    } }
''')
    poll(L)
    a = ack()
    res = {r['id'][-2:]: r for r in a['results']}
    check(a['lastId'] == '00000000000000000021', 'ack names the last command')
    check(res['10']['ok'] and L.globals().mock.factions['3k_main_faction_cao_cao']._treasury == 5100, 'gold transferred')
    check(not res['11']['ok'] and 'only has' in res['11']['message'], 'cannot pay more than the treasury')
    deals = calls(L, 'deal')
    check(res['12']['ok'] and deals[0][2] == 'data_defined_situation_war_proposer_to_recipient' and deals[0][3] == 'faction_key:3k_main_faction_cao_cao', 'war through the automatic deal')
    check(res['13']['message'] == 'already at war', 'second war is a no-op')
    check(res['14']['ok'] and deals[1][2] == 'data_defined_situation_peace', 'peace through the automatic deal')
    check(res['15']['ok'] and calls(L, 'add_ceo')[0] == [3, '3k_main_ceo_trait_personality_brave'], 'trait added as a CEO')
    check(not res['16']['ok'], 'traits outside the whitelist are refused')
    check(res['17']['ok'] and calls(L, 'add_experience')[0] == [3, 3000, 0], 'experience added')
    check(res['18']['ok'] and L.globals().mock.gifted == '3k_main_pingyuan_capital', 'region gifted')
    check(not res['19']['ok'] and 'human faction leader' in res['19']['message'], "the player's own leader cannot be killed")
    check(res['20']['ok'] and L.globals().mock.characters[3]._dead, 'character killed')
    check(not res['21']['ok'] and 'unknown op' in res['21']['message'], 'unknown ops are refused')

    print('replay and ordering')
    before = len(L.globals().mock.calls)
    write_cmds('return { cmds = { { id = "00000000000000000010", op = "transfer_gold", from = "3k_main_faction_liu_bei", to = "3k_main_faction_cao_cao", amount = 1 } } }\n')
    poll(L)
    check(len(L.globals().mock.calls) == before, 'old ids are never run again')

    print('no modify interface')
    L.globals().mock.can_modify = False
    write_cmds('return { cmds = { { id = "00000000000000000030", op = "transfer_gold", from = "3k_main_faction_cao_cao", to = "3k_main_faction_liu_bei", amount = 10 } } }\n')
    poll(L)
    check(len(L.globals().mock.waiting) == 1 and ack()['lastId'] == '00000000000000000021', 'commands wait for a model context')
    L.globals().mock.flush_model_callbacks()
    check(ack()['lastId'] == '00000000000000000030' and L.globals().mock.factions['3k_main_faction_liu_bei']._treasury == 210, 'and run once it exists')
    L.globals().mock.can_modify = True

    print('safety')
    write_cmds('return { cmds = { { id = "00000000000000000040", op = os.execute("echo hacked") } } }\n')
    poll(L)
    check(ack()['lastId'] == '00000000000000000030', 'a command file with code is not executed (empty environment)')
    write_cmds('this is not lua')
    poll(L)
    check(ack()['lastId'] == '00000000000000000030', 'garbage is ignored')

    print('restart keeps the last id')
    L2 = LuaRuntime(unpack_returned_tuples=True)
    L2.execute(open(os.path.join(HERE, 'mock_3k.lua'), encoding='utf-8').read())
    L2.execute(open(MOD, encoding='utf-8').read())
    L2.execute('mock.local_faction = mock.add_faction("x", { human = true })')
    L2.globals().votc_3k()
    check(L2.globals().votc_3k_internal.get_last_processed_id() == '00000000000000000030', 'last id restored from the ack file')

    print()
    print('FAILURES:', failures)
    sys.exit(1 if failures else 0)

main()
