--------------------------------------------------------------------------------
-- VOTC Bridge - Total War: ATTILA
--
-- Part of VOTC, a modified version of Voices of the Court
-- (Copyright (C) MrAndroPC and VOTC contributors, https://github.com/Voices-of-the-Court/VOTC).
-- Total War ports Copyright (C) 2026 daomeidanzi-debug.
-- Licensed under the GNU General Public License v3.0, WITHOUT ANY WARRANTY; the license
-- text is in votc_attila_license.txt in this pack. Source: https://github.com/daomeidanzi-debug/votc-wh3
-- Unofficial fan project, not affiliated with Creative Assembly or SEGA.
--
-- Same file protocol as the Warhammer III and Three Kingdoms bridges, in the game's root folder:
--
--   votc_commands.lua  app  -> game   data-only Lua table: { cmds = { {id=..,op=..}, ... } }
--   votc_state.json    game -> app    snapshot of player + talk target (answer to op "export")
--   votc_ack.json      game -> app    id of the last processed command + per-command results
--
-- Attila differs from the newer games:
--  * the script cannot read localised text, so names travel as {{loc_key}} tokens and the
--    app fills them in from the game's (and the mods') .loc files;
--  * there is no campaign mod folder: lua_scripts/campaign_scripted.lua (loaded by the
--    engine for every campaign) requires this file, and it hooks the global events tables;
--  * commands go through the episodic scripting interface with character lookup strings.
--------------------------------------------------------------------------------

local VOTC_VERSION = "attila-1.0.0"

local STATE_FILE = "votc_state.json"
local CMD_FILE = "votc_commands.lua"
local ACK_FILE = "votc_ack.json"
local LOG_FILE = "votc_log.txt"
local LOG_MAX_BYTES = 256 * 1024
local POLL_TRIGGER = "votc_attila_poll"
-- campaign time triggers count seconds
local POLL_INTERVAL_S = 0.5

local CHARACTER_TYPES = { "general", "champion", "spy", "dignitary" }

local ID_WIDTH = 20
local last_processed_id = string.rep("0", ID_WIDTH)
local last_cmd_raw = nil
local last_selected = nil -- { kind = "character", cqi = n } or { kind = "settlement", region = key }
local started = false

local function normalize_id(id)
	if type(id) == "number" then
		if id ~= math.floor(id) or id < 0 then
			return nil
		end
		id = string.format("%.0f", id)
	end
	if type(id) ~= "string" or not id:match("^%d+$") or #id > ID_WIDTH then
		return nil
	end
	return string.rep("0", ID_WIDTH - #id) .. id
end

--------------------------------------------------------------------------------
-- utils
--------------------------------------------------------------------------------

local function append_log(line)
	pcall(function()
		local f = io.open(LOG_FILE, "rb")
		if f then
			local size = f:seek("end")
			f:close()
			if size and size > LOG_MAX_BYTES then
				local old = io.open(LOG_FILE, "rb")
				local text = old:read("*a")
				old:close()
				local keep = io.open(LOG_FILE, "wb")
				keep:write(text:sub(-math.floor(LOG_MAX_BYTES / 2)))
				keep:close()
			end
		end
		local out_file = io.open(LOG_FILE, "ab")
		if out_file then
			local stamp = (os and os.date) and os.date("%Y-%m-%d %H:%M:%S") or "?"
			out_file:write(stamp .. " " .. line .. "\n")
			out_file:close()
		end
	end)
end

local function log(msg)
	append_log("[VOTC] " .. tostring(msg))
end

local function try(fn, default)
	local ok, result = pcall(fn)
	if ok and result ~= nil then
		return result
	end
	return default
end

local function now_seconds()
	if os and os.time then
		return os.time()
	end
	return nil
end

local function read_file(path)
	local f = io.open(path, "rb")
	if not f then
		return nil
	end
	local content = f:read("*a")
	f:close()
	return content
end

local function write_file(path, content)
	local f, err = io.open(path, "wb")
	if not f then
		log("could not open " .. path .. " for writing: " .. tostring(err))
		return false
	end
	f:write(content)
	f:flush()
	f:close()
	return true
end

-- a localisation key for the app to resolve
local function tok(key)
	if type(key) ~= "string" or key == "" then
		return ""
	end
	return "{{" .. key .. "}}"
end

local function is_null(obj)
	if not obj then
		return true
	end
	return try(function() return obj:is_null_interface() end, false)
end

-- the episodic scripting game interface (campaign manager first, the raw module as fallback)
local function gi()
	if type(cm) == "table" then
		local g = try(function() return rawget(cm, "game_interface") end, nil)
		if g then
			return g
		end
	end
	if type(scripting) == "table" and scripting.game_interface then
		return scripting.game_interface
	end
	local ok, es = pcall(require, "lua_scripts.EpisodicScripting")
	if ok and type(es) == "table" and es.game_interface then
		return es.game_interface
	end
	return nil
end

local function model()
	local g = gi()
	return g and g:model() or nil
end

local function char_str(c)
	return "character_cqi:" .. tostring(c:cqi())
end

--------------------------------------------------------------------------------
-- JSON encoding (arrays are tables created with new_array)
--------------------------------------------------------------------------------

local ARRAY_MT = {}

local function new_array()
	return setmetatable({}, ARRAY_MT)
end

local function json_string(s)
	s = tostring(s)
	s = s:gsub("\\", "\\\\")
	s = s:gsub('"', '\\"')
	s = s:gsub("\n", "\\n")
	s = s:gsub("\r", "\\r")
	s = s:gsub("\t", "\\t")
	s = s:gsub("[%z\1-\31\127]", function(c)
		return string.format("\\u%04x", c:byte())
	end)
	return '"' .. s .. '"'
end

local function json_number(n)
	if n ~= n or n == math.huge or n == -math.huge then
		return "0"
	end
	if n == math.floor(n) and math.abs(n) < 2 ^ 53 then
		return string.format("%.0f", n)
	end
	return string.format("%.4f", n)
end

local json_encode

local function json_table(t)
	local is_array = getmetatable(t) == ARRAY_MT or (next(t) ~= nil and #t > 0)
	local parts = {}
	if is_array then
		for i = 1, #t do
			parts[#parts + 1] = json_encode(t[i])
		end
		return "[" .. table.concat(parts, ",") .. "]"
	end
	local keys = {}
	for k in pairs(t) do
		keys[#keys + 1] = tostring(k)
	end
	table.sort(keys)
	for _, k in ipairs(keys) do
		local v = t[k]
		if v ~= nil and type(v) ~= "function" then
			parts[#parts + 1] = json_string(k) .. ":" .. json_encode(v)
		end
	end
	return "{" .. table.concat(parts, ",") .. "}"
end

json_encode = function(v)
	local tv = type(v)
	if v == nil then
		return "null"
	elseif tv == "boolean" then
		return v and "true" or "false"
	elseif tv == "number" then
		return json_number(v)
	elseif tv == "string" then
		return json_string(v)
	elseif tv == "table" then
		return json_table(v)
	end
	return "null"
end

--------------------------------------------------------------------------------
-- game lookups
--------------------------------------------------------------------------------

local function faction_list()
	local m = model()
	return m and try(function() return m:world():faction_list() end, nil) or nil
end

local function each_faction(fn)
	local list = faction_list()
	if not list then
		return
	end
	for i = 0, list:num_items() - 1 do
		if fn(list:item_at(i)) then
			return
		end
	end
end

local function get_faction(key)
	if type(key) ~= "string" or key == "" then
		return nil
	end
	local m = model()
	if not m then
		return nil
	end
	if try(function() return m:world():faction_exists(key) end, true) then
		local f = try(function() return m:world():faction_by_key(key) end, nil)
		if f and not is_null(f) then
			return f
		end
	end
	return nil
end

-- Attila cannot look a character up by cqi; walk the factions (only for the two of a conversation)
local function get_character(cqi)
	cqi = tonumber(cqi)
	if not cqi then
		return nil
	end
	local found = nil
	each_faction(function(f)
		local chars = try(function() return f:character_list() end, nil)
		if chars then
			for i = 0, chars:num_items() - 1 do
				local c = chars:item_at(i)
				if try(function() return c:cqi() end, -1) == cqi then
					found = c
					return true
				end
			end
		end
		return false
	end)
	return found
end

local function get_region(key)
	local m = model()
	if not m or type(key) ~= "string" then
		return nil
	end
	local r = try(function() return m:world():region_manager():region_by_key(key) end, nil)
	if r and not is_null(r) then
		return r
	end
	return nil
end

local function character_name(c)
	local forename = try(function() return c:get_forename() end, "") or ""
	local surname = try(function() return c:get_surname() end, "") or ""
	local name = tok(forename)
	if surname ~= "" then
		name = name .. " " .. tok(surname)
	end
	return name
end

local function faction_name(f)
	return tok("factions_screen_name_" .. f:name())
end

local function region_name(key)
	return tok("regions_onscreen_" .. key)
end

local function local_faction()
	local m = model()
	if not m then
		return nil
	end
	local found = nil
	each_faction(function(f)
		if try(function() return m:faction_is_local(f:name()) end, false) then
			found = f
			return true
		end
		return false
	end)
	return found
end

local function local_faction_name()
	local f = local_faction()
	return f and f:name() or nil
end

local function leader_of(f)
	if f and try(function() return f:has_faction_leader() end, true) then
		local leader = try(function() return f:faction_leader() end, nil)
		if leader and not is_null(leader) then
			return leader
		end
	end
	return nil
end

local function is_player_leader(c)
	return try(function() return c:is_faction_leader() and c:faction():name() == local_faction_name() end, false)
end

local function at_war(a, b)
	return try(function() return a:at_war_with(b) end, false)
end

local function allied(a, b)
	return try(function() return a:allied_with(b) end, false)
end

--------------------------------------------------------------------------------
-- export
--------------------------------------------------------------------------------

local function export_army(c)
	if not try(function() return c:has_military_force() end, false) then
		return nil
	end
	local mf = c:military_force()
	local army = { units = new_array(), heroes = new_array(), unitCount = 0 }
	local by_key, order = {}, {}
	local unit_list = try(function() return mf:unit_list() end, nil)
	if unit_list then
		for i = 0, unit_list:num_items() - 1 do
			local u = unit_list:item_at(i)
			army.unitCount = army.unitCount + 1
			local key = try(function() return u:unit_key() end, "")
			if key ~= "" then
				local strength = try(function() return u:percentage_proportion_of_full_strength() end, 100)
				if not by_key[key] then
					by_key[key] = { key = key, name = tok("land_units_onscreen_name_" .. key), count = 0, strengthSum = 0 }
					order[#order + 1] = key
				end
				by_key[key].count = by_key[key].count + 1
				by_key[key].strengthSum = by_key[key].strengthSum + strength
			end
		end
	end
	for _, key in ipairs(order) do
		local e = by_key[key]
		army.units[#army.units + 1] = { key = e.key, name = e.name, count = e.count, strength = math.floor(e.strengthSum / e.count + 0.5) }
	end
	return army
end

local function character_type(c)
	for _, t in ipairs(CHARACTER_TYPES) do
		if try(function() return c:character_type(t) end, false) then
			return t
		end
	end
	return ""
end

local function export_family(c)
	local family = {}
	if try(function() return c:has_father() end, false) then
		local f = try(function() return c:father() end, nil)
		if f and not is_null(f) then family.father = character_name(f) end
	end
	if try(function() return c:has_mother() end, false) then
		local m = try(function() return c:mother() end, nil)
		if m and not is_null(m) then family.mother = character_name(m) end
	end
	-- the family tree interface (spouse, children) is not documented for Attila; use it when it answers
	local fm = try(function() return c:family_member() end, nil)
	if fm and not is_null(fm) then
		local spouse = try(function() return fm:spouse() end, nil)
		if spouse and not is_null(spouse) then
			local sc = try(function() return spouse:character() end, nil) or spouse
			local name = try(function() return character_name(sc) end, nil)
			if name and name ~= "" then family.spouse = name end
		end
		local kids = try(function() return fm:children() end, nil)
		if kids and not is_null(kids) and try(function() return kids:num_items() end, 0) > 0 then
			family.children = new_array()
			for i = 0, math.min(kids:num_items(), 12) - 1 do
				local k = kids:item_at(i)
				local kc = try(function() return k:character() end, nil) or k
				local name = try(function() return character_name(kc) end, nil)
				if name and name ~= "" then family.children[#family.children + 1] = name end
			end
		end
	end
	return family
end

local function export_character(c, trait_keys)
	local t = {
		cqi = c:cqi(),
		name = character_name(c),
		forename = tok(try(function() return c:get_forename() end, "")),
		subtypeKey = "",
		subtypeName = "",
		typeKey = character_type(c),
		rank = try(function() return c:rank() end, 0),
		age = try(function() return c:age() end, 0),
		isMale = try(function() return c:is_male() end, true),
		isFactionLeader = try(function() return c:is_faction_leader() end, false),
		isWounded = false,
		isEmbedded = try(function() return c:is_embedded_in_military_force() end, false),
		battlesWon = try(function() return c:battles_won() end, 0),
		battlesFought = try(function() return c:battles_fought() end, 0),
		factionKey = c:faction():name(),
		traits = new_array(),
		satisfaction = try(function() return c:loyalty() end, nil),
		gravitas = try(function() return c:gravitas() end, nil),
	}
	-- wives count as generals in Attila
	if t.typeKey == "general" and not t.isMale then
		t.typeKey = "family"
	end
	if try(function() return c:is_politician() end, false) then
		t.postName = "politician"
	end
	if try(function() return c:has_region() end, false) then
		local r = c:region()
		t.regionKey = r:name()
		t.regionName = region_name(r:name())
		local owner = try(function() return r:owning_faction() end, nil)
		if owner and not is_null(owner) then
			t.regionOwnerKey = owner:name()
			t.regionOwnerName = faction_name(owner)
		end
	end
	for _, key in ipairs(trait_keys) do
		if try(function() return c:has_trait(key) end, false) then
			t.traits[#t.traits + 1] = key
		end
	end
	t.family = export_family(c)
	t.army = export_army(c)
	return t
end

local function export_faction(f, player)
	local t = {
		key = f:name(),
		name = faction_name(f),
		cultureKey = try(function() return f:culture() end, ""),
		cultureName = "",
		subcultureKey = try(function() return f:subculture() end, ""),
		subcultureName = "",
		religionKey = try(function() return f:state_religion() end, ""),
		treasury = try(function() return f:treasury() end, 0),
		isHuman = try(function() return f:is_human() end, false),
		isDead = false,
		isHorde = try(function() return f:is_horde() end, false),
		regions = new_array(),
		regionCount = 0,
		armyCount = 0,
		atWarWith = new_array(),
	}
	t.cultureName = tok("cultures_name_" .. t.cultureKey)
	t.subcultureName = tok("cultures_subcultures_name_" .. t.subcultureKey)
	local regions = try(function() return f:region_list() end, nil)
	if regions then
		t.regionCount = regions:num_items()
		for i = 0, math.min(regions:num_items(), 40) - 1 do
			local key = regions:item_at(i):name()
			t.regions[#t.regions + 1] = { key = key, name = region_name(key) }
		end
	end
	local forces = try(function() return f:military_force_list() end, nil)
	if forces then
		t.armyCount = forces:num_items()
	end
	local home = try(function() return f:home_region() end, nil)
	if home and not is_null(home) and try(function() return f:has_home_region() end, true) then
		t.capitalKey = home:name()
		t.capitalName = region_name(home:name())
	end
	local leader = leader_of(f)
	if leader then
		t.leaderCqi = leader:cqi()
		t.leaderName = character_name(leader)
	end
	each_faction(function(other)
		if #t.atWarWith >= 20 then
			return true
		end
		if other:name() ~= f:name() and at_war(f, other) then
			t.atWarWith[#t.atWarWith + 1] = { key = other:name(), name = faction_name(other) }
		end
		return false
	end)
	if player and f:name() ~= player:name() then
		t.atWarWithPlayer = at_war(f, player)
		t.alliedWithPlayer = allied(f, player)
		t.isVassalOfPlayer = try(function() return f:is_vassal_of(player) end, false)
		t.isMasterOfPlayer = try(function() return player:is_vassal_of(f) end, false)
		t.tradingWithPlayer = try(function() return f:trade_agreement_with(player) end, false)
	end
	return t
end

local function resolve_target(requested_cqi)
	if requested_cqi then
		local c = get_character(requested_cqi)
		if c then
			return { character = c }, "requested", nil
		end
		return nil, "requested", "target_not_found"
	end
	if not last_selected then
		return nil, "none", "nothing_selected"
	end
	if last_selected.kind == "character" then
		local c = get_character(last_selected.cqi)
		if not c then
			return nil, "selection", "target_not_found"
		end
		return { character = c }, "selection", nil
	end
	if last_selected.kind == "settlement" then
		local region = get_region(last_selected.region)
		local owner = region and try(function() return region:owning_faction() end, nil)
		if not owner or is_null(owner) then
			return nil, "settlement", "settlement_unowned"
		end
		local leader = leader_of(owner)
		if leader then
			return { character = leader, sceneRegion = region }, "settlement", nil
		end
		return nil, "settlement", "faction_has_no_leader"
	end
	return nil, "none", "nothing_selected"
end

-- the biggest living factions everyone knows of, their leaders and wars
local WORLD_FACTIONS = 15

local function export_world()
	local world = new_array()
	pcall(function()
		local big = {}
		each_faction(function(f)
			local n = try(function() return f:region_list():num_items() end, 0)
			if n > 0 then
				big[#big + 1] = { f = f, regions = n }
			end
			return false
		end)
		table.sort(big, function(a, b) return a.regions > b.regions end)
		for i = 1, math.min(#big, WORLD_FACTIONS) do
			local f = big[i].f
			local leader = leader_of(f)
			local entry = {
				name = faction_name(f),
				leaderName = leader and character_name(leader) or "",
				regionCount = big[i].regions,
				atWarWith = new_array(),
			}
			for j = 1, math.min(#big, WORLD_FACTIONS) do
				if j ~= i and at_war(f, big[j].f) then
					entry.atWarWith[#entry.atWarWith + 1] = faction_name(big[j].f)
				end
			end
			world[#world + 1] = entry
		end
	end)
	return world
end

-- trait keys to test (the app sends them: Attila cannot list a character's traits)
local function parse_trait_keys(s)
	local keys = {}
	if type(s) == "string" then
		for key in s:gmatch("[%w_]+") do
			keys[#keys + 1] = key
		end
	end
	return keys
end

local function build_state(req_id, requested_cqi, trait_list)
	local state = { version = VOTC_VERSION, reqId = req_id, ok = false, time = now_seconds() }
	local player_faction = local_faction()
	if not player_faction then
		state.error = "no_local_faction"
		return state
	end
	local player_char = leader_of(player_faction)
	if not player_char then
		state.error = "player_has_no_leader"
		return state
	end
	local target, source, err = resolve_target(requested_cqi)
	state.targetSource = source
	if err then
		state.error = err
		return state
	end
	if target.character:cqi() == player_char:cqi() then
		state.error = "target_is_player"
		return state
	end
	local target_faction = target.character:faction()
	local trait_keys = parse_trait_keys(trait_list)
	local m = model()

	state.turn = try(function() return m:turn_number() end, 0)
	state.campaign = type(campaign_name) == "string" and campaign_name or ""
	-- Attila keeps no script data in the savegame we could rely on; one id per campaign + faction
	state.campaignId = (state.campaign ~= "" and state.campaign or "attila") .. "_" .. player_faction:name()
	state.player = export_character(player_char, trait_keys)
	state.target = export_character(target.character, trait_keys)
	if target.sceneRegion then
		local r = target.sceneRegion
		state.sceneRegionKey = r:name()
		state.sceneRegionName = region_name(r:name())
		local owner = try(function() return r:owning_faction() end, nil)
		if owner and not is_null(owner) then
			state.sceneRegionOwnerName = faction_name(owner)
			state.sceneIsCapital = try(function() return owner:home_region():name() == r:name() end, false)
		end
	end
	state.playerFaction = export_faction(player_faction, nil)
	if target_faction:name() ~= player_faction:name() then
		state.targetFaction = export_faction(target_faction, player_faction)
	end
	state.world = export_world()
	state.ok = true
	return state
end

--------------------------------------------------------------------------------
-- command executors
--------------------------------------------------------------------------------

local function require_faction(key, what)
	local f = get_faction(key)
	if not f then
		error((what or "faction") .. " not found: " .. tostring(key), 0)
	end
	return f
end

local function require_character(cqi, what)
	local c = get_character(cqi)
	if not c then
		error((what or "character") .. " not found: " .. tostring(cqi), 0)
	end
	return c
end

local function require_int(v, lo, hi, what)
	v = tonumber(v)
	if not v then
		error((what or "value") .. " is not a number", 0)
	end
	v = math.floor(v)
	if v < lo or v > hi then
		error((what or "value") .. " out of range: " .. tostring(v), 0)
	end
	return v
end

local function require_two_factions(a_key, b_key)
	local a = require_faction(a_key, "faction a")
	local b = require_faction(b_key, "faction b")
	if a:name() == b:name() then
		error("factions must differ", 0)
	end
	return a, b
end

local function interface()
	local g = gi()
	if not g then
		error("the game interface is not ready", 0)
	end
	return g
end

local EXECUTORS = {}

EXECUTORS.export = function(cmd)
	local ok, state = pcall(build_state, cmd.reqId, cmd.targetCqi, cmd.traits)
	if not ok then
		log("export error: " .. tostring(state))
		state = { version = VOTC_VERSION, reqId = cmd.reqId, ok = false, error = "internal: " .. tostring(state), time = now_seconds() }
	end
	if not write_file(STATE_FILE, json_encode(state)) then
		error("could not write state file", 0)
	end
	return state.ok and "exported" or ("export failed: " .. tostring(state.error))
end

EXECUTORS.transfer_gold = function(cmd)
	local from, to = require_two_factions(cmd.from, cmd.to)
	local amount = require_int(cmd.amount, 1, 1000000, "amount")
	local treasury = try(function() return from:treasury() end, 0)
	if treasury < amount then
		error("payer only has " .. tostring(treasury), 0)
	end
	interface():treasury_mod(from:name(), -amount)
	interface():treasury_mod(to:name(), amount)
	return "transferred " .. amount
end

EXECUTORS.war = function(cmd)
	local a, b = require_two_factions(cmd.a, cmd.b)
	if at_war(a, b) then
		return "already at war"
	end
	interface():force_declare_war(a:name(), b:name())
	return "war declared"
end

EXECUTORS.peace = function(cmd)
	local a, b = require_two_factions(cmd.a, cmd.b)
	if not at_war(a, b) then
		return "not at war"
	end
	interface():force_make_peace(a:name(), b:name())
	return "peace made"
end

EXECUTORS.trade = function(cmd)
	local a, b = require_two_factions(cmd.a, cmd.b)
	if at_war(a, b) then
		error("cannot trade while at war", 0)
	end
	interface():force_make_trade_agreement(a:name(), b:name())
	return "trade agreement"
end

EXECUTORS.vassal = function(cmd)
	local master, vassal = require_two_factions(cmd.master, cmd.vassal)
	if try(function() return vassal:is_human() end, false) then
		error("cannot make a human faction a vassal", 0)
	end
	if at_war(master, vassal) then
		interface():force_make_peace(master:name(), vassal:name())
	end
	interface():force_make_vassal(master:name(), vassal:name())
	return "vassalised"
end

EXECUTORS.transfer_region = function(cmd)
	local to = require_faction(cmd.to, "recipient")
	local region = get_region(cmd.region)
	if not region then
		error("region not found: " .. tostring(cmd.region), 0)
	end
	local owner = region:owning_faction()
	if is_null(owner) or owner:name() ~= cmd.from then
		error("region is not owned by " .. tostring(cmd.from), 0)
	end
	if owner:name() == to:name() then
		return "already owned"
	end
	interface():transfer_region_to_faction(region:name(), to:name())
	return "region transferred"
end

EXECUTORS.add_trait = function(cmd)
	local c = require_character(cmd.cqi)
	if type(cmd.trait) ~= "string" or not cmd.trait:match("^[%w_]+$") then
		error("bad trait key: " .. tostring(cmd.trait), 0)
	end
	interface():force_add_trait(char_str(c), cmd.trait, true)
	return "trait added"
end

EXECUTORS.add_xp = function(cmd)
	local c = require_character(cmd.cqi)
	local levels = require_int(cmd.levels, 1, 5, "levels")
	interface():add_agent_experience(char_str(c), levels * 1500)
	return "experience added"
end

EXECUTORS.kill = function(cmd)
	local c = require_character(cmd.cqi)
	if try(function() return c:faction():is_human() and c:is_faction_leader() end, false) then
		error("refusing to kill a human faction leader", 0)
	end
	interface():kill_character(char_str(c), false, true)
	return "killed"
end

EXECUTORS.replenish_ap = function(cmd)
	local c = require_character(cmd.cqi)
	interface():replenish_action_points(char_str(c))
	return "action points replenished"
end

--------------------------------------------------------------------------------
-- command file polling
--------------------------------------------------------------------------------

local function load_commands(raw)
	local chunk, err = loadstring(raw, "votc_commands")
	if not chunk then
		return nil, "parse error: " .. tostring(err)
	end
	if setfenv then
		setfenv(chunk, {})
	end
	local ok, data = pcall(chunk)
	if not ok then
		return nil, "eval error: " .. tostring(data)
	end
	if type(data) ~= "table" or type(data.cmds) ~= "table" then
		return nil, "malformed command file"
	end
	return data, nil
end

local function write_ack(results)
	write_file(ACK_FILE, json_encode({ version = VOTC_VERSION, lastId = last_processed_id, results = results, time = now_seconds() }))
end

local function execute_command(cmd)
	local exec = EXECUTORS[cmd.op]
	if not exec then
		return false, "unknown op: " .. tostring(cmd.op)
	end
	local ok, result = pcall(exec, cmd)
	if not ok then
		return false, tostring(result)
	end
	return true, tostring(result or "ok")
end

local function process_commands(data)
	local results = new_array()
	for _, cmd in ipairs(data.cmds) do
		local id = type(cmd) == "table" and normalize_id(cmd.id) or nil
		if id and id > last_processed_id then
			last_processed_id = id
			local ok, message = execute_command(cmd)
			log("cmd " .. id .. " " .. tostring(cmd.op) .. ": " .. (ok and "ok" or "FAILED") .. " - " .. message)
			results[#results + 1] = { id = id, op = tostring(cmd.op), ok = ok, message = message }
		end
	end
	if #results > 0 then
		write_ack(results)
	end
end

local function poll_commands()
	local raw = read_file(CMD_FILE)
	if not raw or raw == "" or raw == last_cmd_raw then
		return
	end
	local data, err = load_commands(raw)
	last_cmd_raw = raw
	if not data then
		-- the app may be mid-write; a changed file is read again on the next poll
		log(err)
		return
	end
	process_commands(data)
end

local function restore_last_processed_id()
	local raw = read_file(ACK_FILE)
	local id = raw and (raw:match('"lastId":"(%d+)"') or raw:match('"lastId":(%d+)'))
	id = normalize_id(id)
	if id then
		last_processed_id = id
	end
end

local function arm_poll()
	local g = gi()
	if g then
		pcall(function() g:add_time_trigger(POLL_TRIGGER, POLL_INTERVAL_S) end)
	end
end

--------------------------------------------------------------------------------
-- entry points: the engine's global event tables
--------------------------------------------------------------------------------

local function start()
	if started then
		return
	end
	local m = model()
	if not m then
		return
	end
	if try(function() return m:is_multiplayer() end, false) then
		log("multiplayer campaign detected, VOTC is disabled")
		started = true
		return
	end
	started = true
	restore_last_processed_id()
	write_ack(new_array())
	arm_poll()
	log("bridge " .. VOTC_VERSION .. " started, last command id " .. last_processed_id)
end

local function on(event_name, fn)
	local ev = _G.events
	if type(ev) ~= "table" then
		local ok, e = pcall(require, "data.lua_scripts.events")
		if ok and type(e) == "table" then
			ev = e
			_G.events = e
		end
	end
	if type(ev) ~= "table" then
		log("no events table, cannot listen to " .. event_name)
		return
	end
	ev[event_name] = ev[event_name] or {}
	ev[event_name][#ev[event_name] + 1] = function(context)
		local ok, err = pcall(fn, context)
		if not ok then
			log(event_name .. " error: " .. tostring(err))
		end
	end
end

if not _G.votc_attila_installed then
	_G.votc_attila_installed = true

	on("FirstTickAfterWorldCreated", function()
		start()
	end)

	on("TimeTrigger", function(context)
		if try(function() return context.string end, nil) ~= POLL_TRIGGER then
			return
		end
		local ok, err = pcall(poll_commands)
		if not ok then
			log("poll error: " .. tostring(err))
		end
		arm_poll()
	end)

	on("CharacterSelected", function(context)
		local c = try(function() return context:character() end, nil)
		if c and not is_null(c) and not is_player_leader(c) then
			last_selected = { kind = "character", cqi = c:cqi() }
		end
	end)

	on("SettlementSelected", function(context)
		local region = try(function() return context:garrison_residence():region():name() end, nil)
			or try(function() return context:settlement():region():name() end, nil)
		if region then
			last_selected = { kind = "settlement", region = region }
		end
	end)
end

-- exposed for tests
votc_attila_internal = {
	json_encode = json_encode,
	new_array = new_array,
	build_state = build_state,
	execute_command = execute_command,
	load_commands = load_commands,
	start = start,
	poll_commands = poll_commands,
	set_last_selected = function(v) last_selected = v end,
	get_last_processed_id = function() return last_processed_id end,
}
