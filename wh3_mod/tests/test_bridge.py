"""Runs votc_wh3.lua against mock_wh3.lua in a real Lua 5.1 VM (lupa).

usage: python test_bridge.py [extra_commands_file.lua]
       python test_bridge.py --fixtures <out_dir>
The optional argument is a command file produced by the TypeScript serializer;
it is executed through the bridge as an end-to-end check. --fixtures writes
real bridge exports used by tests/node/pipeline.test.cjs.
"""
import json, os, sys, tempfile, time
from lupa.lua51 import LuaRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.join(HERE, '..', 'script', 'campaign', 'mod', 'votc_wh3.lua')

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
    L.execute(open(os.path.join(HERE, 'mock_wh3.lua'), encoding='utf-8').read())
    L.execute(open(MOD, encoding='utf-8').read())
    L.execute(r'''
        mock.loc["names_name_karl"] = "卡尔·弗兰茨"
        mock.loc["names_name_grimgor"] = "格里姆格"
        mock.loc["names_name_iron"] = "[[col:red]]铁皮[[/col]]"
        mock.loc["factions_screen_name_wh_main_emp_empire"] = "瑞克领"
        mock.loc["factions_screen_name_wh_main_grn_greenskins"] = "格里姆格的\"铁牙\"部落"
        mock.loc["regions_onscreen_altdorf"] = "奥特多夫"
        mock.loc["land_units_onscreen_name_wh_main_emp_inf_swordsmen"] = "剑士"
        player = mock.add_faction("wh_main_emp_empire", { human = true, treasury = 5000 })
        orcs = mock.add_faction("wh_main_grn_greenskins", { treasury = 300, culture = "wh_main_grn_greenskins", subculture = "wh_main_sc_grn_greenskins", attitude = { wh_main_emp_empire = -40 } })
        mock.local_faction = player
        altdorf = mock.add_region("altdorf", player)
        badlands = mock.add_region("black_crag", orcs)
        karl = mock.add_character(1, player, { forename = "names_name_karl", leader = true, army = true, units = { "wh_main_emp_inf_swordsmen", "wh_main_emp_inf_swordsmen" }, region = altdorf })
        grim = mock.add_character(2, orcs, { forename = "names_name_grimgor", surname = "names_name_iron", subtype = "wh_main_grn_orc_warboss", leader = true, army = true, units = { "wh_main_grn_inf_orc_boyz" }, region = badlands })
        mock.cco_values.CcoAgentSubtypeRecord["wh_main_grn_orc_warboss"] = {
            DescriptionTextOverride = "Orc Warbosses rule through [[col:red]]brute force[[/col]].",
            ["AssociatedUnitOverride.HistoricalDescription"] = "格里姆格·铁皮是最强大的黑兽人。",
        }
        hero = mock.add_character(3, player, { forename = "", subtype = "wh_main_emp_captain", type = "champion" })
    ''')
    L.globals().votc_wh3()
    return L

def write_cmds(text):
    with open('votc_commands.lua', 'w', encoding='utf-8') as f:
        f.write(text)

def poll(L):
    L.globals().mock.real_callbacks['votc_poll_commands']()

def ack():
    return json.load(open('votc_ack.json', encoding='utf-8'))

def calls(L):
    out = []
    c = L.globals().mock.calls
    for i in range(1, len(c) + 1):
        e = c[i]
        args = e.args
        out.append((e.name, [args[j] for j in range(1, len(args) + 1)]))
    return out

def main():
    workdir = tempfile.mkdtemp(prefix='votc_test_')
    now = int(time.time())

    print('startup')
    L = fresh(workdir)
    check(L.globals().mock.listeners['CharacterSelected'] is not None, 'CharacterSelected listener registered')
    check(os.path.exists('votc_ack.json') and ack()['lastId'] == 0, 'startup ack written with lastId 0')

    print('export without selection')
    write_cmds('return { cmds = { { id = 1, ts = %d, op = "export", reqId = "r1" } } }' % now)
    poll(L)
    st = json.load(open('votc_state.json', encoding='utf-8'))
    check(st['ok'] is False and st['error'] == 'nothing_selected', 'reports nothing_selected')
    check(ack()['results'][0]['ok'] is True, 'export command itself acks ok')

    print('export after selecting the orc warboss')
    L.execute('mock.listeners["CharacterSelected"]({ character = function() return grim end })')
    write_cmds('return { cmds = { { id = 2, ts = %d, op = "export", reqId = "r2" } } }' % now)
    poll(L)
    raw = open('votc_state.json', 'rb').read()
    st = json.loads(raw.decode('utf-8'))
    check(st['ok'] is True and st['reqId'] == 'r2', 'state ok with matching reqId')
    check(st['target']['name'] == '格里姆格 铁皮', 'target name localised, markup stripped: %r' % st['target']['name'])
    check(st['player']['name'] == '卡尔·弗兰茨', 'player name localised')
    check(st['targetFaction']['name'] == '格里姆格的"铁牙"部落', 'quotes in faction name survive JSON')
    check(st['targetFaction']['attitudeToPlayer'] == -40, 'attitude exported')
    check(st['targetFaction']['regions'] == [{'key': 'black_crag', 'name': 'black_crag'}], 'regions exported with fallback name')
    check(st['player']['army']['units'] == [{'key': 'wh_main_emp_inf_swordsmen', 'name': '剑士', 'count': 2, 'strength': 80}], 'army grouped, lord unit excluded')
    check(st['player']['army']['unitCount'] == 3, 'unitCount counts every slot')
    check(st['player']['battlesFought'] == 0, 'erroring getter falls back to default')
    check(st['player']['traits'] == [], 'empty traits encode as []')
    check(st['player']['regionName'] == '奥特多夫', 'region name localised')
    check('playerFaction' in st and 'attitudeToPlayer' not in st['playerFaction'], 'player faction has no self relation')

    print('campaign id')
    cid = st['campaignId']
    import re
    check(isinstance(cid, str) and cid.startswith('wh_main_emp_empire_') and re.fullmatch(r'[A-Za-z0-9_-]+', cid) is not None, 'campaign id created and filesystem-safe: %r' % cid)
    check(L.eval('mock.saved_values.votc_campaign_id') == cid, 'campaign id stored as a saved value (goes into the savegame)')
    write_cmds('return { cmds = { { id = 2.5, ts = %d, op = "export", reqId = "r2b" } } }' % now)
    poll(L)
    check(json.load(open('votc_state.json', encoding='utf-8'))['campaignId'] == cid, 'campaign id stable across exports')
    # loading a save of the same campaign: a new VM whose saved values come from the save
    L_load = LuaRuntime(unpack_returned_tuples=True)
    L_load.execute(open(os.path.join(HERE, 'mock_wh3.lua'), encoding='utf-8').read())
    L_load.execute(open(MOD, encoding='utf-8').read())
    L_load.execute('player = mock.add_faction("wh_main_emp_empire", { human = true }); mock.local_faction = player; mock.saved_values.votc_campaign_id = %s' % json.dumps(cid))
    L_load.globals().votc_wh3()
    check(L_load.eval('votc_wh3_internal.get_campaign_id()') == cid, 'same id after loading a save of this campaign')
    # a brand new campaign (no saved value yet) gets its own id
    L_new = LuaRuntime(unpack_returned_tuples=True)
    L_new.execute(open(os.path.join(HERE, 'mock_wh3.lua'), encoding='utf-8').read())
    L_new.execute(open(MOD, encoding='utf-8').read())
    L_new.execute('player = mock.add_faction("wh_main_emp_empire", { human = true }); mock.local_faction = player; math.randomseed(12345)')
    L_new.globals().votc_wh3()
    new_id = L_new.eval('mock.saved_values.votc_campaign_id')
    check(isinstance(new_id, str) and new_id != cid, 'new campaign gets a different id at startup: %r' % new_id)

    print('lore from the game database (vanilla and mod characters)')
    L.execute(r'''
        mock.cco_values.CcoAgentSubtypeRecord["wh_main_grn_orc_warboss"] = {
            DescriptionTextOverride = "Orc Warbosses rule through [[col:red]]brute force[[/col]].",
            ["AssociatedUnitOverride.HistoricalDescription"] = "格里姆格·铁皮是最强大的黑兽人。",
        }
        mock.cco_values.CcoAgentSubtypeRecord["my_mod_lord"] = {
            DescriptionTextOverride = "A lord added by another mod.",
            ["AssociatedUnitOverride.HistoricalDescription"] = string.rep("长", 2000),
        }
        mock.loc["agent_subtypes_description_text_override_wh_main_emp_captain"] = "Captains lead the Empire's soldiers."
        modlord = mock.add_character(4, orcs, { forename = "names_name_grimgor", subtype = "my_mod_lord" })
    ''')
    L.execute('mock.listeners["CharacterSelected"]({ character = function() return grim end })')
    write_cmds('return { cmds = { { id = 2.6, ts = %d, op = "export", reqId = "lore1" } } }' % now)
    poll(L)
    st = json.load(open('votc_state.json', encoding='utf-8'))
    check(st['target']['typeDescription'] == 'Orc Warbosses rule through brute force.', 'type description read via cco, markup stripped')
    check(st['target']['biography'] == '格里姆格·铁皮是最强大的黑兽人。', 'biography read via cco')
    check('biography' not in st['player'] and 'typeDescription' not in st['player'], 'no lore -> fields omitted')
    L.execute('mock.listeners["CharacterSelected"]({ character = function() return modlord end })')
    write_cmds('return { cmds = { { id = 2.7, ts = %d, op = "export", reqId = "lore2" } } }' % now)
    poll(L)
    raw = open('votc_state.json', 'rb').read()
    st = json.loads(raw.decode('utf-8'))  # strict UTF-8 decode: fails if truncation split a character
    bio = st['target']['biography']
    check(st['target']['typeDescription'] == 'A lord added by another mod.', 'mod-added character type works')
    check(bio.endswith('…') and len(bio.encode('utf-8')) <= 4000 + 3 and set(bio[:-1]) == {'长'}, 'long biography truncated on a UTF-8 boundary (%d bytes)' % len(bio.encode('utf-8')))

    print('export of own hero (empty forename falls back to subtype)')
    L.execute('mock.listeners["CharacterSelected"]({ character = function() return hero end })')
    write_cmds('return { cmds = { { id = 3, ts = %d, op = "export", reqId = "r3" } } }' % now)
    poll(L)
    st = json.load(open('votc_state.json', encoding='utf-8'))
    check(st['ok'] and st['target']['name'] == 'wh_main_emp_captain' and 'targetFaction' not in st, 'own hero exported without targetFaction')

    print('selecting yourself')
    L.execute('mock.listeners["CharacterSelected"]({ character = function() return karl end })')
    write_cmds('return { cmds = { { id = 4, ts = %d, op = "export", reqId = "r4" } } }' % now)
    poll(L)
    st = json.load(open('votc_state.json', encoding='utf-8'))
    check(st['error'] == 'target_is_player', 'target_is_player error')

    print('settlement selection -> owner faction leader')
    L.execute('mock.listeners["SettlementSelected"]({ garrison_residence = function() return { region = function() return badlands end } end })')
    write_cmds('return { cmds = { { id = 5, ts = %d, op = "export", reqId = "r5" } } }' % now)
    poll(L)
    st = json.load(open('votc_state.json', encoding='utf-8'))
    check(st['ok'] and st['target']['cqi'] == 2 and st['targetSource'] == 'settlement', 'settlement resolves to warboss')

    next_id = [6.0]
    def export(label):
        next_id[0] += 0.01
        write_cmds('return { cmds = { { id = %.2f, ts = %d, op = "export", reqId = "%s" } } }' % (next_id[0], now, label))
        poll(L)
        return json.load(open('votc_state.json', encoding='utf-8'))

    L.execute(r'''
        elves = mock.add_faction("wh2_main_hef_eataine", { attitude = { wh_main_emp_empire = 30 } })
        tyrion = mock.add_character(6, elves, { forename = "names_name_tyrion", leader = true })
        mock.loc["names_name_tyrion"] = "泰瑞昂"
    ''')

    print('diplomacy screen: the single foreign faction shown')
    L.execute(r'''
        mock.listeners["CharacterSelected"]({ character = function() return hero end })
        mock.panels.diplomacy_dropdown = true
        mock.listeners["PanelOpenedCampaign"]({ string = "diplomacy_dropdown" })
        mock.ui["diplomacy_dropdown/faction_right_status_panel"] = mock.ui_component({}, {
            mock.ui_component({ CcoCampaignFaction = tostring(orcs:command_queue_index()) }),
            mock.ui_component({ CcoCampaignFaction = tostring(player:command_queue_index()) }),
        })
    ''')
    st = export('dip1')
    check(st['ok'] and st['target']['cqi'] == 2 and st['targetSource'] == 'diplomacy', 'diplomacy panel faction resolved (player faction ignored)')

    print('diplomacy screen: several factions shown and none clicked')
    L.execute(r'''
        mock.ui["diplomacy_dropdown/faction_right_status_panel"] = nil
        mock.ui["diplomacy_dropdown"] = mock.ui_component({}, {
            mock.ui_component({ CcoCampaignFaction = tostring(orcs:command_queue_index()) }),
            mock.ui_component({}, { mock.ui_component({ CcoCampaignFaction = tostring(elves:command_queue_index()) }) }),
        })
    ''')
    st = export('dip2')
    check(not st['ok'] and st['error'] == 'diplomacy_pick_faction', 'ambiguous diplomacy screen asks the player to click a faction')

    print('diplomacy screen: clicking a faction row picks it')
    L.execute(r'''
        local row = mock.ui_component({ CcoCampaignFaction = tostring(elves:command_queue_index()) }, { mock.ui_component({}) })
        mock.click(row._children[1])   -- the click lands on a child of the row
    ''')
    st = export('dip3')
    check(st['ok'] and st['target']['cqi'] == 6 and st['target']['name'] == '泰瑞昂', 'clicked faction leader is the target')
    L.execute(r'''
        local portrait = mock.ui_component({ CcoCampaignCharacter = "2" })
        mock.click(portrait)
    ''')
    st = export('dip4')
    check(st['ok'] and st['target']['cqi'] == 2, 'clicking a leader portrait in diplomacy picks that faction')
    L.execute('mock.listeners["PanelOpenedCampaign"]({ string = "diplomacy_dropdown" })')
    check(L.eval('votc_wh3_internal.get_last_diplomacy_faction()') is None, 'reopening diplomacy forgets the previous pick')
    L.execute('mock.panels.diplomacy_dropdown = false; mock.ui["diplomacy_dropdown"] = nil')

    print('character details panel (heroes)')
    L.execute(r'''
        mock.listeners["CharacterSelected"]({ character = function() return grim end })
        mock.panels.character_details_panel = true
        mock.ui["character_details_panel/character_context_parent"] = mock.ui_component({ CcoCampaignCharacter = "3" })
    ''')
    st = export('det1')
    check(st['ok'] and st['target']['cqi'] == 3 and st['targetSource'] == 'details', 'hero shown in the details panel is the target')
    L.execute('mock.ui["character_details_panel/character_context_parent"] = mock.ui_component({ CcoCampaignCharacter = "1" })')
    st = export('det2')
    check(st['ok'] and st['target']['cqi'] == 2, 'details panel of your own leader falls back to the selection')
    L.execute('mock.panels.character_details_panel = false')

    print('cards in an army panel')
    L.execute(r'''
        local swords = karl._units[2]
        mock.cco_values.CcoCampaignUnit = { [swords:command_queue_index()] = { Name = "第二剑士团", ["UnitRecordContext.HistoricalDescription"] = "帝国最坚韧的步兵。" } }
        local army_panel = mock.ui_component({ CcoCampaignCharacter = "1" }, {
            mock.ui_component({ CcoCampaignUnit = tostring(swords:command_queue_index()) }, { mock.ui_component({}) }),
            mock.ui_component({ CcoCampaignUnit = tostring(karl._units[1]:command_queue_index()) }),
        })
        mock.click(army_panel._children[1]._children[1])
    ''')
    sel = L.eval('votc_wh3_internal.get_last_selected()')
    check(sel is not None and sel.kind == 'unit', 'clicking a unit card selects the unit')
    st = export('unit1')
    t = st['target']
    check(st['ok'] and t.get('isUnit') is True and t['cqi'] < 0 and st['targetSource'] == 'unit', 'unit exported as a soldier with a negative id')
    check(t['name'] == '第二剑士团' and t['commanderName'] == '卡尔·弗兰茨' and t['strength'] == 80, 'unit name, commander and strength')
    check(t['biography'] == '帝国最坚韧的步兵。' and 'targetFaction' not in st, 'unit lore read, own faction has no targetFaction')
    L.execute(r'''
        mock.listeners["CharacterSelected"]({ character = function() return grim end })
        local lord_card = mock.ui_component({ CcoCampaignCharacter = "1" }, { mock.ui_component({ CcoCampaignUnit = tostring(karl._units[1]:command_queue_index()) }) })
        mock.click(lord_card._children[1])
    ''')
    st = export('unit2')
    check(st['ok'] and st['target']['cqi'] == 2, "your own lord's card (a commander unit) does not replace the target")
    L.execute(r'''
        local boyz = grim._units[2]
        mock.click(mock.ui_component({ CcoCampaignUnit = tostring(boyz:command_queue_index()) }))
    ''')
    st = export('unit3')
    check(st['ok'] and st['target'].get('isUnit') and st['targetFaction']['key'] == 'wh_main_grn_greenskins', 'enemy unit carries its faction')
    L.execute('mock.click(mock.ui_component({}, {}))')
    st = export('unit4')
    check(st['target'].get('isUnit'), 'clicking something without a context keeps the selection')
    L.execute('mock.click(mock.ui_component({ CcoCampaignCharacter = "3" }))')
    st = export('hero1')
    check(st['ok'] and st['target']['cqi'] == 3 and st['targetSource'] == 'selection', 'clicking a hero card selects the hero')
    write_cmds('return { cmds = { { id = 6.9, ts = %d, op = "kill", cqi = -%d } } }' % (now, 5003))
    poll(L)
    check(ack()['results'][0]['ok'] is False, 'character commands never match a unit id')

    print('actions')
    write_cmds('return { cmds = {'
               '{ id = 10, ts = %d, op = "transfer_gold", from = "wh_main_grn_greenskins", to = "wh_main_emp_empire", amount = 200 },'
               '{ id = 11, ts = %d, op = "transfer_gold", from = "wh_main_grn_greenskins", to = "wh_main_emp_empire", amount = 99999 },'
               '{ id = 12, ts = %d, op = "attitude", a = "wh_main_emp_empire", b = "wh_main_grn_greenskins", amount = 3 },'
               '{ id = 13, ts = %d, op = "attitude", a = "wh_main_emp_empire", b = "wh_main_grn_greenskins", amount = 9 },'
               '{ id = 14, ts = %d, op = "war", a = "wh_main_grn_greenskins", b = "wh_main_emp_empire" },'
               '{ id = 15, ts = %d, op = "peace", a = "wh_main_grn_greenskins", b = "wh_main_emp_empire" },'
               '{ id = 16, ts = %d, op = "add_trait", cqi = 2, trait = "wh2_main_trait_pacifist" },'
               '{ id = 17, ts = %d, op = "add_trait", cqi = 2, trait = "evil_custom_trait" },'
               '{ id = 18, ts = %d, op = "give_unit", fromCqi = 1, toCqi = 2, unit = "wh_main_emp_inf_swordsmen" },'
               '{ id = 19, ts = %d, op = "give_unit", fromCqi = 1, toCqi = 2, unit = "wh_main_emp_lord" },'
               '{ id = 20, ts = %d, op = "transfer_region", region = "black_crag", from = "wh_main_grn_greenskins", to = "wh_main_emp_empire" },'
               '{ id = 21, ts = %d, op = "kill", cqi = 1 },'
               '{ id = 22, ts = %d, op = "kill", cqi = 2 },'
               '{ id = 23, ts = %d, op = "launch_missiles" },'
               '{ id = 24, ts = %d, op = "wound", cqi = 999, turns = 2 },'
               '{ id = 25, ts = %d, op = "add_xp", cqi = 2, levels = 2 },'
               '{ id = 26, ts = %d, op = "replenish_ap", cqi = 2 },'
               '{ id = 27, ts = %d, op = "alliance", a = "wh_main_grn_greenskins", b = "wh_main_emp_empire" },'
               '{ id = 28, ts = %d, op = "vassal", master = "wh_main_emp_empire", vassal = "wh_main_grn_greenskins" },'
               '{ id = 29, ts = %d, op = "confederate", absorber = "wh_main_grn_greenskins", absorbed = "wh_main_emp_empire" },'
               '} }' % tuple([now] * 20))
    poll(L)
    res = {r['id']: r for r in ack()['results']}
    check(ack()['lastId'] == 29, 'lastId advanced to 29')
    expect = {10: True, 11: False, 12: True, 13: False, 14: True, 15: True, 16: True, 17: False, 18: True, 19: False,
              20: True, 21: False, 22: True, 23: False, 24: False, 25: True, 26: True, 27: True, 28: True, 29: False}
    for i, ok in expect.items():
        check(res[i]['ok'] is ok, 'cmd %d %s -> %s (%s)' % (i, res[i]['op'], 'ok' if ok else 'rejected', res[i]['message']))
    t = L.eval('player:treasury()'), L.eval('orcs:treasury()')
    check(t == (5200, 100), 'treasuries after transfer: %r' % (t,))
    cl = calls(L)
    names = [c[0] for c in cl]
    check(names.count('apply_dilemma_diplomatic_bonus') == 2, 'attitude applied both directions once')
    check(('kill_character', [2, False]) in cl and not any(c[0] == 'kill_character' and c[1][0] == 1 for c in cl), 'only the AI lord was killed')
    check(('remove_unit_from_character', [1, 'wh_main_emp_inf_swordsmen']) in cl and ('grant_unit_to_character', [2, 'wh_main_emp_inf_swordsmen']) in cl, 'unit moved between armies')
    check(L.eval('badlands:owning_faction():name()') == 'wh_main_emp_empire', 'region transferred')

    print('replay protection')
    n_before = len(calls(L))
    poll(L)  # same file content
    write_cmds(open('votc_commands.lua', encoding='utf-8').read() + '\n')  # same ids, new content
    poll(L)
    check(len(calls(L)) == n_before, 'already processed ids are not executed again')

    print('stale commands')
    write_cmds('return { cmds = { { id = 30, ts = %d, op = "treasury_mod" }, { id = 31, ts = %d, op = "transfer_gold", from = "wh_main_emp_empire", to = "wh_main_grn_greenskins", amount = 1 } } }' % (now, now - 7200))
    poll(L)
    res = {r['id']: r for r in ack()['results']}
    check(res[31]['ok'] is False and 'stale' in res[31]['message'], 'old command ignored as stale')

    print('sandboxing and malformed files')
    write_cmds('return { cmds = { { id = 40, ts = %d, op = "export", reqId = tostring(io) } } }' % now)
    poll(L)
    check(ack()['lastId'] == 31, 'command file cannot call globals (eval error, nothing run)')
    write_cmds('return { cmds = { { id = 41, ts = %d, op = "exp')
    poll(L)
    check(ack()['lastId'] == 31, 'truncated file is ignored')
    write_cmds('return { cmds = { { id = 41, ts = %d, op = "export", reqId = "r41" } } }' % now)
    poll(L)
    check(ack()['lastId'] == 41, 'complete file processed after truncated one')

    print('reload restores last id')
    L2 = LuaRuntime(unpack_returned_tuples=True)
    L2.execute(open(os.path.join(HERE, 'mock_wh3.lua'), encoding='utf-8').read())
    L2.execute(open(MOD, encoding='utf-8').read())
    L2.execute('player = mock.add_faction("wh_main_emp_empire", { human = true }); mock.local_faction = player')
    L2.globals().votc_wh3()
    check(L2.eval('votc_wh3_internal.get_last_processed_id()') == 41, 'last id restored from ack file')
    L2.globals().mock.real_callbacks['votc_poll_commands']()
    check(len(calls(L2)) == 0, 'commands from before the reload are not replayed')

    print('json encoder edge cases')
    enc = L.eval('votc_wh3_internal.json_encode')
    L.execute('t_edge = { big = 1761400000123000, frac = 0.5, nan = 0/0, ctrl = "a\\1b\\nc\\\\d", empty = votc_wh3_internal.new_array(), nested = { 1, 2, { x = true } } }')
    s = enc(L.eval('t_edge'))
    d = json.loads(s)
    check(d['big'] == 1761400000123000, 'large integer ids keep full precision')
    check(d['frac'] == 0.5 and d['nan'] == 0, 'fraction and NaN encoded')
    check(d['ctrl'] == 'a\x01b\nc\\d', 'control chars and backslashes escaped')
    check(d['empty'] == [] and d['nested'] == [1, 2, {'x': True}], 'arrays encoded')

    if len(sys.argv) > 1:
        print('end-to-end with TypeScript-serialized commands')
        L3 = fresh(tempfile.mkdtemp(prefix='votc_e2e_'))
        L3.execute('mock.listeners["CharacterSelected"]({ character = function() return grim end })')
        write_cmds(open(sys.argv[1], encoding='utf-8').read())
        L3.globals().mock.real_callbacks['votc_poll_commands']()
        a = ack()
        for r in a['results']:
            print('     ', r['op'], r['ok'], r['message'])
        check(len(a['results']) > 0 and all(r['ok'] for r in a['results']), 'all serialized commands executed')
        st = json.load(open('votc_state.json', encoding='utf-8'))
        check(st.get('ok') is True, 'serialized export produced a state')

    print()
    print('FAILURES:', failures)
    sys.exit(1 if failures else 0)

def make_fixtures(out_dir):
    """Write real bridge exports (foreign warboss, own hero) for the Node tests."""
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    now = int(time.time())
    selectors = (
        ('state_foreign.json', 'mock.listeners["CharacterSelected"]({ character = function() return grim end })'),
        ('state_own_hero.json', 'mock.listeners["CharacterSelected"]({ character = function() return hero end })'),
        ('state_enemy_unit.json', 'mock.click(mock.ui_component({ CcoCampaignUnit = tostring(grim._units[2]:command_queue_index()) }))'),
    )
    for name, select in selectors:
        L = fresh(tempfile.mkdtemp(prefix='votc_fx_'))
        L.execute(select)
        write_cmds('return { cmds = { { id = 1, ts = %d, op = "export", reqId = "fixture" } } }' % now)
        poll(L)
        with open('votc_state.json', 'rb') as src, open(os.path.join(out_dir, name), 'wb') as dst:
            dst.write(src.read())
        print('wrote', name)

if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--fixtures':
        make_fixtures(sys.argv[2])
    else:
        main()
