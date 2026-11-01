"""Runs VOTC_Bridge.lua against a mock of the Civilization VI UI scripting API (lupa, Lua 5.1).

usage: python civ6_mod/tests/test_bridge_civ6.py
"""
import os, sys
from lupa.lua51 import LuaRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.join(HERE, '..', 'VOTC_Bridge', 'VOTC_Bridge.lua')

failures = 0
def check(cond, msg):
    global failures
    if cond:
        print('  ok  ', msg)
    else:
        failures += 1
        print('  FAIL', msg)

MOCK = r'''
ExposedMembers = {}
printed = {}
function print(s) printed[#printed + 1] = s end
handlers = {}
-- every listener of an event runs, in order
local function event(name)
  handlers[name] = {}
  return { Add = function(fn) table.insert(handlers[name], fn) end }
end
function fire(name, ...) for _, fn in ipairs(handlers[name] or {}) do fn(...) end end
Events = { LoadScreenClose = event("load"), LocalPlayerTurnBegin = event("turn") }
LuaEvents = setmetatable({}, { __index = function(t, k) local e = event("lua:" .. k); rawset(t, k, e); return e end })
Mouse = { eLClick = 1 }
UI = { PlaySound = function() end }
local function control()
  local c = { hidden = true, callbacks = {} }
  function c:SetText(t) self.text = t end
  function c:SetToolTipString(t) self.tooltip = t end
  function c:RegisterCallback(kind, fn) self.callbacks[kind] = fn end
  function c:ChangeParent(p) self.parent = p end
  function c:SetHide(h) self.hidden = h end
  return c
end
Controls = { VOTCTalkButton = control(), VOTCTalkLabel = control() }
diplomacy_screen = { name = "DiplomacyActionView" }
ContextPtr = { LookUpControl = function(_, path) if path == "/InGame/DiplomacyActionView" then return diplomacy_screen end end }
Locale = { Lookup = function(k) return (k:gsub("^LOC_", ""):gsub("_NAME$", ""):gsub("_", " ")) end,
  GetCurrentLanguage = function() return { Type = "zh_Hans_CN" } end }
Calendar = { MakeYearStr = function(t) return "1500 AD" end }
GameConfiguration = { GetValue = function(k) return 4711 end }
Modding = { GetActiveMods = function() return { { Name = "LOC_BBG_NAME" }, { Name = "LOC_VOTC" } } end }
Game = { GetLocalPlayer = function() return 0 end, GetCurrentGameTurn = function() return 120 end }
GameInfo = {
  Governments = { [3] = { Name = "LOC_GOVERNMENT_MONARCHY_NAME" } },
  Eras = { [2] = { Name = "LOC_ERA_MEDIEVAL_NAME" } },
  Religions = {},
  DiplomaticStates = { [5] = { StateType = "DIPLO_STATE_DENOUNCED", Name = "LOC_DIPLO_STATE_DENOUNCED_NAME" } },
  Alliances = {},
  Governors = { [1] = { Name = "LOC_GOVERNOR_MAGNUS_NAME", Title = "LOC_GOVERNOR_MAGNUS_TITLE", Description = "Logistics [ICON_Food] expert" } },
  GreatPersonIndividuals = { [7] = { Name = "LOC_GP_HYPATIA_NAME", GreatPersonClassType = "SCIENTIST" } },
  GreatPersonClasses = { SCIENTIST = { Name = "LOC_GP_CLASS_SCIENTIST_NAME" } },
}
local configs = {
  [0] = { civ = "LOC_CIVILIZATION_CHINA_DESCRIPTION", leader = "LOC_LEADER_QIN_NAME" },
  [1] = { civ = "LOC_CIVILIZATION_ROME_DESCRIPTION", leader = "LOC_LEADER_TRAJAN_NAME" },
  [2] = { civ = "LOC_CIVILIZATION_SPAIN_DESCRIPTION", leader = "LOC_LEADER_PHILIP_NAME" },
  [20] = { civ = "LOC_CIVILIZATION_KABUL_DESCRIPTION", leader = "LOC_LEADER_MINOR_NAME" },
}
PlayerConfigurations = {}
for id, c in pairs(configs) do
  PlayerConfigurations[id] = { GetCivilizationShortDescription = function() return c.civ end, GetLeaderName = function() return c.leader end }
end
local met = { [1] = true, [20] = true }
local function player(id, major)
  local p = { id = id }
  function p:GetID() return self.id end
  function p:IsMajor() return major end
  function p:GetCulture() return { GetCurrentGovernment = function() return 3 end } end
  function p:GetCities() return { GetCapitalCity = function() return { GetName = function() return "LOC_CITY_X" end } end, GetCount = function() return 4 end } end
  function p:GetEra() return 2 end
  function p:GetScore() return 300 end
  function p:GetTreasury() return { GetGoldBalance = function() return 812.6 end } end
  function p:GetFavor() return 40 end
  function p:GetReligion() return { GetReligionInMajorityOfCities = function() return -1 end } end
  function p:GetDiplomacy()
    return {
      HasMet = function(_, o) return met[o] == true end,
      IsAtWarWith = function(_, o) return (id == 0 and o == 1) or (id == 1 and o == 0) end,
      GetAllianceType = function() return -1 end,
      GetGrievancesAgainst = function(_, o) return o == 1 and 25 or 0 end,
    }
  end
  function p:GetDiplomaticAI() return { GetDiplomaticStateIndex = function() return 5 end } end
  function p:GetInfluence() return { GetSuzerain = function() return id == 20 and 1 or -1 end } end
  function p:GetGovernors()
    return { GetGovernorList = function() return true, { { GetType = function() return 1 end, GetAssignedCity = function() return { GetName = function() return "LOC_CITY_XIAN" end } end } } end }
  end
  function p:GetUnits()
    local units = { { GetGreatPerson = function() return { GetIndividual = function() return 7 end } end, GetX = function() return 1 end, GetY = function() return 1 end },
                    { GetGreatPerson = function() return { GetIndividual = function() return -1 end } end } }
    return { Members = function() local i = 0 return function() i = i + 1; if units[i] then return i, units[i] end end end }
  end
  return p
end
Players = { [0] = player(0, true), [1] = player(1, true), [2] = player(2, true), [20] = player(20, false) }
PlayerManager = {
  GetAliveMajors = function() return { Players[0], Players[1], Players[2] } end,
  GetAliveMinors = function() return { Players[20] } end,
}
Map = { GetPlot = function() return {} end }
Cities = { GetPlotPurchaseCity = function() return nil end }
'''

L = LuaRuntime(unpack_returned_tuples=True)
L.execute(MOCK)
L.execute(open(MOD, encoding='utf-8').read())

print('civ6 bridge')
n = L.eval('ExposedMembers.VOTC_Build("talk")')
check(n >= 1, f'snapshot built in {n} chunk(s)')
text = ''.join(L.eval(f'ExposedMembers.VOTC_Chunk({i + 1})') for i in range(n))
lines = text.split('\n')
check(lines[0] == 'VOTC|BEGIN|civ6|1|talk' and lines[-1] == 'VOTC|END', 'BEGIN .. END')
has = lambda s: s in lines
check(has('VOTC|P|tag|P0') and has('VOTC|P|name|CIVILIZATION CHINA DESCRIPTION') and has('VOTC|P|gold|812'), 'player civilization with its treasury')
check(has('VOTC|P|government|GOVERNMENT MONARCHY') and has('VOTC|P|era|ERA MEDIEVAL'), 'government and era localised')
check(has('VOTC|C|P1|leader|LEADER TRAJAN') and has('VOTC|R|P1|war|yes') and has('VOTC|R|P1|opinion|-70'), 'met civilization, war and stance')
check(has('VOTC|R|P1|grievances|25') and has('VOTC|C|P1|war_with|CIVILIZATION CHINA DESCRIPTION'), 'grievances and wars')
check(not any('|P2|' in l for l in lines), 'civilizations not yet met are left out')
check(has('VOTC|C|P20|leader_title|City-state') and has('VOTC|R|P20|suzerain|CIVILIZATION ROME DESCRIPTION'), 'city-state and its suzerain')
check(has('VOTC|CH|P0|GOVERNOR MAGNUS|title|Governor, GOVERNOR MAGNUS TITLE') and has('VOTC|CH|P0|GOVERNOR MAGNUS|location|CITY XIAN'), 'governor with title and city')
check(has('VOTC|CH|P0|GOVERNOR MAGNUS|desc|Logistics expert'), 'icons stripped from text')
check(has('VOTC|CH|P0|GP HYPATIA|title|GP CLASS SCIENTIST'), 'great person')
check(has('VOTC|CH|P1|LEADER TRAJAN|ruler|yes'), 'foreign leader as a person')
check(has('VOTC|META|mods|BBG;VOTC') and has('VOTC|META|campaign|4711'), 'mods and campaign id')

# chunks never cut a UTF-8 character
L.execute('GameInfo.Governors[1].Description = string.rep("测试", 900)')
n2 = L.eval('ExposedMembers.VOTC_Build("x")')
chunks = [L.eval(f'ExposedMembers.VOTC_Chunk({i + 1})') for i in range(n2)]
ok = n2 > 1
for c in chunks:
    raw = c.encode('utf-8', 'surrogateescape') if isinstance(c, str) else c
    try:
        (raw if isinstance(raw, bytes) else bytes(raw)).decode('utf-8')
    except Exception:
        ok = False
check(ok, f'{n2} chunks, each valid UTF-8')

# turn start prints the snapshot to Lua.log
L.execute('printed = {}; fire("turn")')
check(L.eval('#printed') > 10 and L.eval('printed[1]') == 'VOTC|BEGIN|civ6|1|turn', 'turn start logs the snapshot')

# an error inside the game API never escapes
L.execute('Players[0].GetDiplomacy = function() error("boom") end')
check(L.eval('ExposedMembers.VOTC_Build("x")') == -1 and str(L.eval('ExposedMembers.VOTC_LAST')).startswith('VOTC|ERROR|'), 'errors reported, not thrown')

# the Talk (VOTC) button in the leader diplomacy screen
L.execute('fire("load")')
check(L.eval('Controls.VOTCTalkButton.parent == diplomacy_screen and Controls.VOTCTalkButton.hidden == false'), 'button moved into the diplomacy screen at load')
check(L.eval('Controls.VOTCTalkLabel.text') == '交谈（VOTC）', 'label in the game language')
check(L.eval('ExposedMembers.VOTC_TalkSeq') == 0, 'no click yet')
L.execute('fire("lua:DiplomacyRibbon_OpenDiplomacyActionView", 1)')
L.execute('Controls.VOTCTalkButton.callbacks[Mouse.eLClick]()')
check(L.eval('ExposedMembers.VOTC_TalkSeq') == 1 and L.eval('ExposedMembers.VOTC_TalkPlayer') == 1, 'a click records the leader shown')
L.execute('fire("lua:DiploPopup_TalkToLeader", 20); Controls.VOTCTalkButton.callbacks[Mouse.eLClick]()')
check(L.eval('ExposedMembers.VOTC_TalkSeq') == 2 and L.eval('ExposedMembers.VOTC_TalkPlayer') == 20, 'the latest leader opened counts')

print('FAILED' if failures else 'all passed', failures)
sys.exit(1 if failures else 0)
