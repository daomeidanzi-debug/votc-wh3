--------------------------------------------------------------------------------
-- Voices of the Court - Total War: WARHAMMER III bridge
--
-- Part of VOTC-WH3, a modified version of Voices of the Court
-- (Copyright (C) MrAndroPC and VOTC contributors, https://github.com/Voices-of-the-Court/VOTC).
-- Warhammer III port Copyright (C) 2026 daomeidanzi-debug.
-- Licensed under the GNU General Public License v3.0, WITHOUT ANY WARRANTY; the license
-- text is in votc_wh3_license.txt in this pack. Source: https://github.com/daomeidanzi-debug/votc-wh3
-- Unofficial fan project, not affiliated with Creative Assembly, SEGA or Games Workshop.
--
-- Talks to the VOTC desktop app through plain files in the game's root folder
-- (the working directory of Warhammer3.exe, same place script_log.txt goes):
--
--   votc_commands.lua  app  -> game   data-only Lua table: { cmds = { {id=..,op=..}, ... } }
--   votc_state.json    game -> app    snapshot of player + talk target (answer to op "export")
--   votc_ack.json      game -> app    id of the last processed command + per-command results
--
-- Commands are executed from a fixed whitelist (see EXECUTORS). The command file
-- is loaded with an empty environment, so it can only carry data.
--------------------------------------------------------------------------------

local VOTC_VERSION = "1.3.0"

local STATE_FILE = "votc_state.json"
local CMD_FILE = "votc_commands.lua"
local ACK_FILE = "votc_ack.json"
local POLL_INTERVAL_MS = 400
-- the game only polls while it has focus, so actions chosen during a long chat wait for the
-- player to return; only commands older than this (e.g. left over from a crash) are dropped
local STALE_COMMAND_SECONDS = 3600
local MAX_UNITS_PER_ARMY = 20

-- Traits that exist for every culture (no culture restriction in character_traits).
local ALLOWED_TRAITS = {
	wh2_main_trait_fighter = true,
	wh2_main_trait_pacifist = true,
	wh2_main_trait_wins = true,
	wh2_main_trait_defeats = true,
	wh2_main_trait_routed = true,
	wh2_main_trait_lazy = true,
	wh2_main_trait_public_order = true,
	wh2_main_trait_builder = true,
	wh2_main_trait_lone_wolf = true,
	wh2_main_trait_agent_target_fail = true,
	wh2_main_trait_agent_target_success = true,
}

-- Saved-value key holding this campaign's id; stored in the savegame by the campaign manager.
local CAMPAIGN_ID_KEY = "votc_campaign_id"

local last_selected = nil -- { kind = "character", cqi = n } or { kind = "settlement", region = key }
local last_processed_id = 0
local last_cmd_raw = nil
local started = false

--------------------------------------------------------------------------------
-- utils
--------------------------------------------------------------------------------

local function log(msg)
	msg = "[VOTC] " .. tostring(msg)
	if type(ModLog) == "function" then
		pcall(ModLog, msg)
	elseif type(out) == "function" then
		pcall(out, msg)
	end
end

-- pcall wrapper returning a default when the call errors or yields nil
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

-- strip UI markup like [[col:red]]...[[/col]] and {{tr:...}} from localised strings
local function clean_text(s)
	s = s:gsub("%[%[[^%]]*%]%]", "")
	s = s:gsub("{{[^}]*}}", "")
	s = s:gsub("^%s+", ""):gsub("%s+$", "")
	return s
end

local function nil_if_empty(s)
	if s == "" then
		return nil
	end
	return s
end

-- longest lore text sent to the app; cut on a UTF-8 character boundary
local MAX_LORE_BYTES = 4000

local function truncate_utf8(s, max_bytes)
	if #s <= max_bytes then
		return s
	end
	local cut = max_bytes
	-- step back over UTF-8 continuation bytes (10xxxxxx) so no character is split
	while cut > 0 do
		local b = s:byte(cut + 1)
		if not b or b < 0x80 or b >= 0xC0 then
			break
		end
		cut = cut - 1
	end
	return s:sub(1, cut) .. "…"
end

-- Text from the game's context objects, e.g. a unit's historical description. Works for any
-- record the game has loaded, including ones added by other mods, and is already localised.
local function context_text(cco_type, id, expression)
	local value = try(function()
		if type(cco) == "function" then
			local obj = cco(cco_type, id)
			if obj then
				return obj:Call(expression)
			end
		end
	end, nil)
	if (type(value) ~= "string" or value == "") and type(common) == "table" and common.get_context_value then
		value = try(function() return common.get_context_value(cco_type, id, expression) end, nil)
	end
	if type(value) ~= "string" then
		return nil
	end
	value = clean_text(value)
	if value == "" then
		return nil
	end
	return truncate_utf8(value, MAX_LORE_BYTES)
end

local function loc(key, fallback)
	fallback = fallback or ""
	if type(key) ~= "string" or key == "" then
		return fallback
	end
	local ok, s = pcall(common.get_localised_string, key)
	if ok and type(s) == "string" and s ~= "" and s ~= key then
		s = clean_text(s)
		if s ~= "" then
			return s
		end
	end
	return fallback
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

local function get_faction(key)
	if type(key) ~= "string" or key == "" then
		return nil
	end
	local f = try(function() return cm:get_faction(key) end, nil)
	if f and not f:is_null_interface() then
		return f
	end
	return nil
end

local function get_character(cqi)
	cqi = tonumber(cqi)
	if not cqi then
		return nil
	end
	local c = try(function() return cm:get_character_by_cqi(cqi) end, nil)
	if c and not c:is_null_interface() then
		return c
	end
	return nil
end

local function char_lookup(cqi)
	return "character_cqi:" .. tostring(cqi)
end

local function character_name(c)
	local forename = loc(c:get_forename(), "")
	local surname = loc(c:get_surname(), "")
	local name = forename
	if surname ~= "" then
		name = name ~= "" and (name .. " " .. surname) or surname
	end
	if name == "" then
		local subtype = c:character_subtype_key()
		name = loc("agent_subtypes_onscreen_name_override_" .. subtype, subtype)
	end
	return name
end

local function faction_name(f)
	return loc("factions_screen_name_" .. f:name(), f:name())
end

local function region_name(key)
	return loc("regions_onscreen_" .. key, key)
end

--------------------------------------------------------------------------------
-- export
--------------------------------------------------------------------------------

-- lords and embedded heroes occupy a unit slot with unit class "com"
local function is_character_unit(u)
	return try(function() return u:unit_class() == "com" end, false)
end

local function export_army(c)
	if not try(function() return c:has_military_force() end, false) then
		return nil
	end
	local mf = c:military_force()
	local army = { units = new_array(), heroes = new_array(), unitCount = 0 }
	local by_key = {}
	local order = {}

	local unit_list = mf:unit_list()
	for i = 0, unit_list:num_items() - 1 do
		local u = unit_list:item_at(i)
		army.unitCount = army.unitCount + 1
		if not is_character_unit(u) then
			local key = u:unit_key()
			local strength = try(function() return u:percentage_proportion_of_full_strength() end, 100)
			if not by_key[key] then
				by_key[key] = { key = key, name = loc("land_units_onscreen_name_" .. key, key), count = 0, strengthSum = 0 }
				order[#order + 1] = key
			end
			by_key[key].count = by_key[key].count + 1
			by_key[key].strengthSum = by_key[key].strengthSum + strength
		end
	end
	for _, key in ipairs(order) do
		local e = by_key[key]
		army.units[#army.units + 1] = { key = e.key, name = e.name, count = e.count, strength = math.floor(e.strengthSum / e.count + 0.5) }
	end

	local chars = try(function() return mf:character_list() end, nil)
	if chars then
		for i = 0, chars:num_items() - 1 do
			local h = chars:item_at(i)
			if h:command_queue_index() ~= c:command_queue_index() then
				army.heroes[#army.heroes + 1] = character_name(h)
			end
		end
	end
	return army
end

local function export_character(c)
	local subtype = c:character_subtype_key()
	local t = {
		cqi = c:command_queue_index(),
		name = character_name(c),
		forename = loc(c:get_forename(), ""),
		subtypeKey = subtype,
		subtypeName = loc("agent_subtypes_onscreen_name_override_" .. subtype, ""),
		typeKey = try(function() return c:character_type_key() end, ""),
		rank = try(function() return c:rank() end, 0),
		age = try(function() return c:age() end, 0),
		isMale = try(function() return c:is_male() end, true),
		isFactionLeader = try(function() return c:is_faction_leader() end, false),
		isWounded = try(function() return c:is_wounded() end, false),
		isEmbedded = try(function() return c:is_embedded_in_military_force() end, false),
		battlesWon = try(function() return c:battles_won() end, 0),
		battlesFought = try(function() return c:battles_fought() end, 0),
		factionKey = c:faction():name(),
		traits = new_array(),
	}
	if try(function() return c:has_region() end, false) then
		local r = c:region()
		t.regionKey = r:name()
		t.regionName = region_name(r:name())
		local owner = try(function() return r:owning_faction() end, nil)
		if owner and not owner:is_null_interface() then
			t.regionOwnerKey = owner:name()
			t.regionOwnerName = faction_name(owner)
		end
	end
	for key in pairs(ALLOWED_TRAITS) do
		if try(function() return c:has_trait(key) end, false) then
			t.traits[#t.traits + 1] = key
		end
	end
	-- lore from the game database (vanilla or mods): what this kind of character is, and the
	-- biography attached to the character's unit (legendary lords have their own)
	t.typeDescription = context_text("CcoAgentSubtypeRecord", subtype, "DescriptionTextOverride")
		or nil_if_empty(loc("agent_subtypes_description_text_override_" .. subtype, ""))
	t.biography = context_text("CcoAgentSubtypeRecord", subtype, "AssociatedUnitOverride.HistoricalDescription")
	t.army = export_army(c)
	return t
end

local function faction_list_names(list, limit)
	local result = new_array()
	if not list then
		return result
	end
	for i = 0, math.min(list:num_items(), limit) - 1 do
		local f = list:item_at(i)
		if not f:is_null_interface() and not try(function() return f:is_dead() end, false) then
			result[#result + 1] = { key = f:name(), name = faction_name(f) }
		end
	end
	return result
end

local function export_faction(f, player)
	local t = {
		key = f:name(),
		name = faction_name(f),
		cultureKey = f:culture(),
		cultureName = loc("cultures_name_" .. f:culture(), f:culture()),
		subcultureKey = f:subculture(),
		subcultureName = loc("cultures_subcultures_name_" .. f:subculture(), f:subculture()),
		treasury = try(function() return f:treasury() end, 0),
		isHuman = try(function() return f:is_human() end, false),
		isDead = try(function() return f:is_dead() end, false),
		regions = new_array(),
		regionCount = 0,
		armyCount = 0,
	}

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
		for i = 0, forces:num_items() - 1 do
			if not try(function() return forces:item_at(i):is_armed_citizenry() end, false) then
				t.armyCount = t.armyCount + 1
			end
		end
	end

	if try(function() return f:has_home_region() end, false) then
		local key = f:home_region():name()
		t.capitalKey = key
		t.capitalName = region_name(key)
	end
	if try(function() return f:has_faction_leader() end, false) then
		local leader = f:faction_leader()
		if not leader:is_null_interface() then
			t.leaderCqi = leader:command_queue_index()
			t.leaderName = character_name(leader)
		end
	end

	t.atWarWith = faction_list_names(try(function() return f:factions_at_war_with() end, nil), 20)

	if player and f:name() ~= player:name() then
		t.atWarWithPlayer = try(function() return f:at_war_with(player) end, false)
		t.alliedWithPlayer = try(function() return f:allied_with(player) end, false)
		t.isVassalOfPlayer = try(function() return f:is_vassal_of(player) end, false)
		t.isMasterOfPlayer = try(function() return player:is_vassal_of(f) end, false)
		t.attitudeToPlayer = try(function() return f:diplomatic_attitude_towards(player:name()) end, 0)
		t.playerAttitudeToThem = try(function() return player:diplomatic_attitude_towards(f:name()) end, 0)
		t.tradingWithPlayer = try(function() return cm:faction_has_trade_agreement_with_faction(f, player) end, false)
	end
	return t
end

local function leader_of(f)
	if f and try(function() return f:has_faction_leader() end, false) then
		local leader = f:faction_leader()
		if not leader:is_null_interface() then
			return leader
		end
	end
	return nil
end

local function is_panel_open(name)
	return try(function() return cm:get_campaign_ui_manager():is_panel_open(name) end, false)
end

local function local_faction_name()
	return try(function() return cm:get_local_faction_name(true) end, nil)
end

local function is_player_leader(c)
	return try(function() return c:is_faction_leader() and c:faction():name() == local_faction_name() end, false)
end

--------------------------------------------------------------------------------
-- reading what the UI shows (context objects), as vanilla scripts do
--------------------------------------------------------------------------------

local function context_id(uic, cco_type)
	local id = try(function() return uic:GetContextObjectId(cco_type) end, nil)
	if type(id) == "string" and id ~= "" then
		return id
	end
	return nil
end

local function character_from_context_id(id)
	-- vanilla converts a CcoCampaignCharacter id through its CQI expression
	local cqi = try(function() return common.get_context_value("CcoCampaignCharacter", id, "CQI") end, nil)
	return get_character(cqi) or get_character(id)
end

local function faction_from_context_id(id)
	local cqi = tonumber(id)
	if not cqi then
		return nil
	end
	local f = try(function() return cm:model():faction_for_command_queue_index(cqi) end, nil)
	if f and not f:is_null_interface() then
		return f
	end
	return nil
end

local function parent_of(uic)
	return try(function()
		local p = uic:Parent()
		if p then
			return UIComponent(p)
		end
	end, nil)
end

-- unit, its military force and faction, looked up by unit cqi (there is no direct model lookup)
local function find_unit(cqi)
	cqi = tonumber(cqi)
	if not cqi then
		return nil
	end
	local found_u, found_mf, found_f = nil, nil, nil
	pcall(function()
		local factions = cm:model():world():faction_list()
		for i = 0, factions:num_items() - 1 do
			local f = factions:item_at(i)
			local forces = f:military_force_list()
			for j = 0, forces:num_items() - 1 do
				local mf = forces:item_at(j)
				local units = mf:unit_list()
				for k = 0, units:num_items() - 1 do
					local u = units:item_at(k)
					if u:command_queue_index() == cqi then
						found_u, found_mf, found_f = u, mf, f
						return
					end
				end
			end
		end
	end)
	return found_u, found_mf, found_f
end

local MAX_UI_PARENTS = 10

-- What a clicked UI element (or one of its parents) shows: a unit card, a character or a faction.
local function context_selection(uic, want_faction)
	local node = uic
	for _ = 0, MAX_UI_PARENTS do
		if not node then
			return nil
		end
		local unit_id = context_id(node, "CcoCampaignUnit")
		if unit_id then
			local u = find_unit(unit_id)
			-- lords and heroes have a unit card too; for them the character context below wins
			if u and not is_character_unit(u) then
				return { kind = "unit", cqi = tonumber(unit_id) }
			end
		end
		local char_id = context_id(node, "CcoCampaignCharacter")
		if char_id then
			local c = character_from_context_id(char_id)
			if c then
				return { kind = "character", cqi = c:command_queue_index() }
			end
		end
		if want_faction then
			local faction_id = context_id(node, "CcoCampaignFaction")
			if faction_id then
				local f = faction_from_context_id(faction_id)
				if f then
					return { kind = "faction", key = f:name() }
				end
			end
		end
		node = parent_of(node)
	end
	return nil
end

local last_diplomacy_faction = nil -- faction clicked while the diplomacy screen is open

local function on_component_clicked(context)
	local uic = try(function() return UIComponent(context.component) end, nil)
	if not uic then
		return
	end
	local in_diplomacy = is_panel_open("diplomacy_dropdown")
	local sel = context_selection(uic, in_diplomacy)
	if not sel then
		return
	end
	if sel.kind == "faction" then
		if sel.key ~= local_faction_name() then
			last_diplomacy_faction = sel.key
		end
		return
	end
	if sel.kind == "character" then
		local c = get_character(sel.cqi)
		-- clicking around your own leader's panels should not replace the chosen target
		if not c or is_player_leader(c) then
			return
		end
		if in_diplomacy and c:faction():name() ~= local_faction_name() then
			last_diplomacy_faction = c:faction():name()
		end
	end
	last_selected = sel
end

-- distinct non-player factions shown anywhere inside a UI subtree
local function collect_factions(uic, player_key, out, budget)
	if not uic or budget.left <= 0 then
		return
	end
	budget.left = budget.left - 1
	local id = context_id(uic, "CcoCampaignFaction")
	if id then
		local f = faction_from_context_id(id)
		if f and f:name() ~= player_key and not out[f:name()] then
			out[f:name()] = f
			out.n = out.n + 1
		end
	end
	local count = try(function() return uic:ChildCount() end, 0)
	for i = 0, count - 1 do
		collect_factions(try(function() return UIComponent(uic:Find(i)) end, nil), player_key, out, budget)
	end
end

-- the other faction on the diplomacy screen: the one last clicked there, or the only one shown
local function get_diplomacy_target_faction(player_key)
	if not is_panel_open("diplomacy_dropdown") then
		return nil, nil
	end
	if last_diplomacy_faction then
		local f = get_faction(last_diplomacy_faction)
		if f then
			return f, nil
		end
	end
	local root = try(function() return core:get_ui_root() end, nil)
	for _, path in ipairs({ { "diplomacy_dropdown", "faction_right_status_panel" }, { "diplomacy_dropdown" } }) do
		local panel = try(function() return find_uicomponent(root, unpack(path)) end, nil)
		if panel then
			local found = { n = 0 }
			collect_factions(panel, player_key, found, { left = 5000 })
			if found.n == 1 then
				for key, f in pairs(found) do
					if key ~= "n" then
						return f, nil
					end
				end
			end
		end
	end
	return nil, "diplomacy_pick_faction"
end

-- the character shown in an open character details panel (heroes included)
local function get_details_panel_character()
	if not is_panel_open("character_details_panel") then
		return nil
	end
	local panel = try(function() return find_uicomponent(core:get_ui_root(), "character_details_panel", "character_context_parent") end, nil)
	local id = panel and context_id(panel, "CcoCampaignCharacter")
	return id and character_from_context_id(id) or nil
end

-- returns { character = c } or { unit = u, force = mf, faction = f, cqi = n }, source, error code
local function resolve_target(player_faction, requested_cqi)
	if requested_cqi then
		local c = get_character(requested_cqi)
		if c then
			return { character = c }, "requested", nil
		end
		return nil, "requested", "target_not_found"
	end

	local dip, dip_err = get_diplomacy_target_faction(player_faction:name())
	if dip then
		local leader = leader_of(dip)
		if leader then
			return { character = leader }, "diplomacy", nil
		end
		return nil, "diplomacy", "faction_has_no_leader"
	end
	if dip_err then
		return nil, "diplomacy", dip_err
	end

	local shown = get_details_panel_character()
	if shown and not is_player_leader(shown) then
		return { character = shown }, "details", nil
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

	if last_selected.kind == "unit" then
		local u, mf, f = find_unit(last_selected.cqi)
		if not u then
			return nil, "unit", "target_not_found"
		end
		return { unit = u, force = mf, faction = f, cqi = last_selected.cqi }, "unit", nil
	end

	if last_selected.kind == "settlement" then
		local region = try(function() return cm:get_region(last_selected.region) end, nil)
		local owner = region and try(function() return region:owning_faction() end, nil)
		if not owner or owner:is_null_interface() or try(function() return owner:is_dead() end, true) then
			return nil, "settlement", "settlement_unowned"
		end
		local leader = leader_of(owner)
		if leader then
			return { character = leader }, "settlement", nil
		end
		return nil, "settlement", "faction_has_no_leader"
	end

	return nil, "none", "nothing_selected"
end

-- A rank-and-file unit as a conversation partner: one of its soldiers. The negative id keeps
-- it apart from character ids; game actions refuse it because no character has that cqi.
local function export_unit(target)
	local u, mf, f, cqi = target.unit, target.force, target.faction, target.cqi
	local key = u:unit_key()
	local name = context_text("CcoCampaignUnit", cqi, "Name") or loc("land_units_onscreen_name_" .. key, key)
	local t = {
		cqi = -cqi,
		isUnit = true,
		unitCqi = cqi,
		unitKey = key,
		name = name,
		forename = "",
		subtypeKey = key,
		subtypeName = name,
		typeKey = "unit",
		rank = 0,
		age = 0,
		isMale = true,
		isFactionLeader = false,
		isWounded = false,
		isEmbedded = false,
		battlesWon = 0,
		battlesFought = 0,
		factionKey = f:name(),
		traits = new_array(),
		strength = math.floor(try(function() return u:percentage_proportion_of_full_strength() end, 100) + 0.5),
		biography = context_text("CcoCampaignUnit", cqi, "UnitRecordContext.HistoricalDescription"),
	}
	local general = try(function() return mf:general_character() end, nil)
	if general and not general:is_null_interface() then
		t.commanderCqi = general:command_queue_index()
		t.commanderName = character_name(general)
		if try(function() return general:has_region() end, false) then
			t.regionKey = general:region():name()
			t.regionName = region_name(t.regionKey)
		end
	end
	return t
end

-- One id per campaign: created the first time the mod runs in it, then kept in the save,
-- so every save of the same campaign (and only that campaign) shares conversation history.
local function get_campaign_id()
	local id = try(function() return cm:get_saved_value(CAMPAIGN_ID_KEY) end, nil)
	if type(id) == "string" and id ~= "" then
		return id
	end
	local faction = try(function() return cm:get_local_faction_name(true) end, "unknown")
	local stamp = now_seconds() or 0
	id = string.format("%s_%.0f_%04d", tostring(faction), stamp, math.random(0, 9999))
	id = id:gsub("[^%w_%-]", "_")
	cm:set_saved_value(CAMPAIGN_ID_KEY, id)
	log("new campaign id " .. id)
	return id
end

local function build_state(req_id, requested_cqi)
	local state = {
		version = VOTC_VERSION,
		reqId = req_id,
		ok = false,
		time = now_seconds(),
	}

	local player_faction = try(function() return cm:get_local_faction(true) end, nil)
	if not player_faction or player_faction:is_null_interface() then
		state.error = "no_local_faction"
		return state
	end
	local player_char = leader_of(player_faction)
	if not player_char then
		state.error = "player_has_no_leader"
		return state
	end

	local target, source, err = resolve_target(player_faction, requested_cqi)
	state.targetSource = source
	if err then
		state.error = err
		return state
	end
	local target_faction
	if target.character then
		if target.character:command_queue_index() == player_char:command_queue_index() then
			state.error = "target_is_player"
			return state
		end
		target_faction = target.character:faction()
	else
		target_faction = target.faction
	end

	state.turn = try(function() return cm:turn_number() end, 0)
	state.campaign = try(function() return cm:get_campaign_name() end, "")
	state.campaignId = try(get_campaign_id, nil)
	state.player = export_character(player_char)
	state.target = target.character and export_character(target.character) or export_unit(target)
	state.playerFaction = export_faction(player_faction, nil)
	if target_faction:name() ~= player_faction:name() then
		state.targetFaction = export_faction(target_faction, player_faction)
	end
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
	if try(function() return f:is_dead() end, false) then
		error((what or "faction") .. " is dead: " .. tostring(key), 0)
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

local function require_two_factions(cmd)
	local a = require_faction(cmd.a, "faction a")
	local b = require_faction(cmd.b, "faction b")
	if a:name() == b:name() then
		error("factions must differ", 0)
	end
	return a, b
end

local function require_general_with_army(cqi)
	local c = require_character(cqi, "general")
	if not try(function() return c:has_military_force() end, false) then
		error("character has no army", 0)
	end
	return c
end

local EXECUTORS = {}

EXECUTORS.export = function(cmd)
	local state = build_state(cmd.reqId, cmd.targetCqi)
	if not write_file(STATE_FILE, json_encode(state)) then
		error("could not write state file", 0)
	end
	return state.ok and "exported" or ("export failed: " .. tostring(state.error))
end

EXECUTORS.transfer_gold = function(cmd)
	local from = require_faction(cmd.from, "payer")
	local to = require_faction(cmd.to, "payee")
	if from:name() == to:name() then
		error("payer and payee are the same faction", 0)
	end
	local amount = require_int(cmd.amount, 1, 1000000, "amount")
	local treasury = from:treasury()
	if treasury < amount then
		error("payer only has " .. tostring(treasury), 0)
	end
	cm:treasury_mod(from:name(), -amount)
	cm:treasury_mod(to:name(), amount)
	return "transferred " .. amount
end

EXECUTORS.attitude = function(cmd)
	local a, b = require_two_factions(cmd)
	local amount = require_int(cmd.amount, -6, 6, "amount")
	if amount == 0 then
		return "no change"
	end
	cm:apply_dilemma_diplomatic_bonus(a:name(), b:name(), amount)
	cm:apply_dilemma_diplomatic_bonus(b:name(), a:name(), amount)
	return "attitude " .. amount
end

EXECUTORS.war = function(cmd)
	local a, b = require_two_factions(cmd)
	if a:at_war_with(b) then
		return "already at war"
	end
	cm:force_declare_war(a:name(), b:name(), false, false)
	return "war declared"
end

EXECUTORS.peace = function(cmd)
	local a, b = require_two_factions(cmd)
	if not a:at_war_with(b) then
		return "not at war"
	end
	cm:force_make_peace(a:name(), b:name())
	return "peace made"
end

EXECUTORS.alliance = function(cmd)
	local a, b = require_two_factions(cmd)
	if a:at_war_with(b) then
		cm:force_make_peace(a:name(), b:name())
	end
	cm:force_alliance(a:name(), b:name(), true)
	return "alliance formed"
end

EXECUTORS.trade = function(cmd)
	local a, b = require_two_factions(cmd)
	if a:at_war_with(b) then
		error("cannot trade while at war", 0)
	end
	cm:force_make_trade_agreement(a:name(), b:name())
	return "trade agreement"
end

EXECUTORS.vassal = function(cmd)
	local master = require_faction(cmd.master, "master")
	local vassal = require_faction(cmd.vassal, "vassal")
	if master:name() == vassal:name() then
		error("factions must differ", 0)
	end
	if master:at_war_with(vassal) then
		cm:force_make_peace(master:name(), vassal:name())
	end
	cm:force_make_vassal(master:name(), vassal:name())
	return "vassalised"
end

EXECUTORS.confederate = function(cmd)
	local absorber = require_faction(cmd.absorber, "absorber")
	local absorbed = require_faction(cmd.absorbed, "absorbed")
	if absorber:name() == absorbed:name() then
		error("factions must differ", 0)
	end
	if try(function() return absorbed:is_human() end, false) then
		error("cannot confederate a human faction", 0)
	end
	cm:force_confederation(absorber:name(), absorbed:name())
	return "confederated"
end

EXECUTORS.transfer_region = function(cmd)
	local to = require_faction(cmd.to, "recipient")
	local region = try(function() return cm:get_region(cmd.region) end, nil)
	if not region or region:is_null_interface() then
		error("region not found: " .. tostring(cmd.region), 0)
	end
	local owner = region:owning_faction()
	if owner:is_null_interface() or owner:name() ~= cmd.from then
		error("region is not owned by " .. tostring(cmd.from), 0)
	end
	if owner:name() == to:name() then
		return "already owned"
	end
	cm:transfer_region_to_faction(region:name(), to:name())
	return "region transferred"
end

EXECUTORS.add_trait = function(cmd)
	local c = require_character(cmd.cqi)
	if not ALLOWED_TRAITS[cmd.trait] then
		error("trait not allowed: " .. tostring(cmd.trait), 0)
	end
	cm:force_add_trait(char_lookup(c:command_queue_index()), cmd.trait, true)
	return "trait added"
end

EXECUTORS.add_xp = function(cmd)
	local c = require_character(cmd.cqi)
	local levels = require_int(cmd.levels, 1, 5, "levels")
	cm:add_agent_experience(char_lookup(c:command_queue_index()), levels, true)
	return "experience added"
end

EXECUTORS.wound = function(cmd)
	local c = require_character(cmd.cqi)
	local turns = require_int(cmd.turns, 1, 10, "turns")
	cm:wound_character(char_lookup(c:command_queue_index()), turns)
	return "wounded"
end

EXECUTORS.kill = function(cmd)
	local c = require_character(cmd.cqi)
	if try(function() return c:faction():is_human() and c:is_faction_leader() end, false) then
		error("refusing to kill a human faction leader", 0)
	end
	cm:kill_character(c:command_queue_index(), false)
	return "killed"
end

EXECUTORS.replenish_ap = function(cmd)
	local c = require_character(cmd.cqi)
	cm:replenish_action_points(char_lookup(c:command_queue_index()))
	return "action points replenished"
end

EXECUTORS.give_unit = function(cmd)
	local giver = require_general_with_army(cmd.fromCqi)
	local receiver = require_general_with_army(cmd.toCqi)
	if giver:command_queue_index() == receiver:command_queue_index() then
		error("giver and receiver are the same", 0)
	end
	if type(cmd.unit) ~= "string" or cmd.unit == "" then
		error("unit key missing", 0)
	end
	local has_unit = false
	local giver_units = giver:military_force():unit_list()
	for i = 0, giver_units:num_items() - 1 do
		local u = giver_units:item_at(i)
		if u:unit_key() == cmd.unit and not is_character_unit(u) then
			has_unit = true
			break
		end
	end
	if not has_unit then
		error("giver has no unit " .. cmd.unit, 0)
	end
	if receiver:military_force():unit_list():num_items() >= MAX_UNITS_PER_ARMY then
		error("receiving army is full", 0)
	end
	cm:remove_unit_from_character(char_lookup(giver:command_queue_index()), cmd.unit)
	cm:grant_unit_to_character(char_lookup(receiver:command_queue_index()), cmd.unit)
	return "unit given"
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

function votc_poll_commands()
	local raw = read_file(CMD_FILE)
	if not raw or raw == "" or raw == last_cmd_raw then
		return
	end
	local data, err = load_commands(raw)
	if not data then
		-- the app may be mid-write; retry on the next poll unless the content stays the same
		last_cmd_raw = raw
		log(err)
		return
	end
	last_cmd_raw = raw

	local results = new_array()
	local now = now_seconds()
	for _, cmd in ipairs(data.cmds) do
		if type(cmd) == "table" and type(cmd.id) == "number" and cmd.id > last_processed_id then
			last_processed_id = cmd.id
			local ok, message
			if now and type(cmd.ts) == "number" and math.abs(now - cmd.ts) > STALE_COMMAND_SECONDS then
				ok, message = false, "stale command ignored"
			else
				ok, message = execute_command(cmd)
			end
			log("cmd " .. string.format("%.0f", cmd.id) .. " " .. tostring(cmd.op) .. ": " .. (ok and "ok" or "FAILED") .. " - " .. message)
			results[#results + 1] = { id = cmd.id, op = tostring(cmd.op), ok = ok, message = message }
		end
	end
	if #results > 0 then
		write_ack(results)
	end
end

local function restore_last_processed_id()
	local raw = read_file(ACK_FILE)
	local id = raw and tonumber(raw:match('"lastId":(%d+)'))
	if id then
		last_processed_id = id
	end
end

--------------------------------------------------------------------------------
-- entry point, called by the mod loader on the first tick
--------------------------------------------------------------------------------

function votc_wh3()
	if started then
		return
	end
	if cm:is_multiplayer() then
		log("multiplayer campaign detected, Voices of the Court is disabled")
		return
	end
	started = true

	restore_last_processed_id()
	-- create the id right away so the very next save already carries it
	pcall(get_campaign_id)

	core:add_listener(
		"votc_character_selected",
		"CharacterSelected",
		true,
		function(context)
			local c = context:character()
			if c and not c:is_null_interface() then
				last_selected = { kind = "character", cqi = c:command_queue_index() }
			end
		end,
		true
	)

	-- hero and unit cards, portraits, character panels and the diplomacy faction list do not
	-- raise CharacterSelected; read what was clicked from the UI context instead
	core:add_listener(
		"votc_component_clicked",
		"ComponentLClickUp",
		true,
		function(context)
			pcall(on_component_clicked, context)
		end,
		true
	)

	core:add_listener(
		"votc_diplomacy_opened",
		"PanelOpenedCampaign",
		function(context) return context.string == "diplomacy_dropdown" end,
		function()
			last_diplomacy_faction = nil
		end,
		true
	)

	core:add_listener(
		"votc_settlement_selected",
		"SettlementSelected",
		true,
		function(context)
			local region = try(function() return context:garrison_residence():region():name() end, nil)
			if region then
				last_selected = { kind = "settlement", region = region }
			end
		end,
		true
	)

	cm:repeat_real_callback(function()
		local ok, err = pcall(votc_poll_commands)
		if not ok then
			log("poll error: " .. tostring(err))
		end
	end, POLL_INTERVAL_MS, "votc_poll_commands")

	write_ack(new_array())
	log("bridge " .. VOTC_VERSION .. " started, last command id " .. string.format("%.0f", last_processed_id))
end

-- exposed for tests
votc_wh3_internal = {
	json_encode = json_encode,
	new_array = new_array,
	build_state = build_state,
	get_campaign_id = get_campaign_id,
	execute_command = execute_command,
	load_commands = load_commands,
	clean_text = clean_text,
	set_last_selected = function(v) last_selected = v end,
	get_last_selected = function() return last_selected end,
	get_last_diplomacy_faction = function() return last_diplomacy_faction end,
	get_last_processed_id = function() return last_processed_id end,
	ALLOWED_TRAITS = ALLOWED_TRAITS,
	FILES = { state = STATE_FILE, cmd = CMD_FILE, ack = ACK_FILE },
}
