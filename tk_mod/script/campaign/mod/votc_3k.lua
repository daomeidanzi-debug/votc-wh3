--------------------------------------------------------------------------------
-- VOTC Bridge - Total War: THREE KINGDOMS
--
-- Part of VOTC, a modified version of Voices of the Court
-- (Copyright (C) MrAndroPC and VOTC contributors, https://github.com/Voices-of-the-Court/VOTC).
-- Total War ports Copyright (C) 2026 daomeidanzi-debug.
-- Licensed under the GNU General Public License v3.0, WITHOUT ANY WARRANTY; the license
-- text is in votc_3k_license.txt in this pack. Source: https://github.com/daomeidanzi-debug/votc-wh3
-- Unofficial fan project, not affiliated with Creative Assembly or SEGA.
--
-- Same file protocol as the Warhammer III bridge (votc_wh3.lua), in the game's root folder:
--
--   votc_commands.lua  app  -> game   data-only Lua table: { cmds = { {id=..,op=..}, ... } }
--   votc_state.json    game -> app    snapshot of player + talk target (answer to op "export")
--   votc_ack.json      game -> app    id of the last processed command + per-command results
--
-- Three Kingdoms differs from Warhammer III in how the model is reached: reads go through
-- query interfaces (cm:query_faction, cm:query_character), and changes need a modify
-- interface, which only exists inside model events. Commands therefore run inside
-- cm:wait_for_model_sp, and diplomacy uses the game's automatic deals.
--------------------------------------------------------------------------------

local VOTC_VERSION = "3k-1.0.0"

local STATE_FILE = "votc_state.json"
local CMD_FILE = "votc_commands.lua"
local ACK_FILE = "votc_ack.json"
-- campaign timers count seconds
local POLL_INTERVAL_S = 0.5

-- Personality traits (CEOs) the app may read and grant. Keys exist in vanilla for every faction.
local ALLOWED_TRAITS = {
	["3k_main_ceo_trait_personality_brave"] = true,
	["3k_main_ceo_trait_personality_cowardly"] = true,
	["3k_main_ceo_trait_personality_honourable"] = true,
	["3k_main_ceo_trait_personality_deceitful"] = true,
	["3k_main_ceo_trait_personality_cruel"] = true,
	["3k_main_ceo_trait_personality_kind"] = true,
	["3k_main_ceo_trait_personality_ambitious"] = true,
	["3k_main_ceo_trait_personality_humble"] = true,
	["3k_main_ceo_trait_personality_loyal"] = true,
	["3k_main_ceo_trait_personality_disloyal"] = true,
	["3k_main_ceo_trait_personality_greedy"] = true,
	["3k_main_ceo_trait_personality_charitable"] = true,
	["3k_main_ceo_trait_personality_cautious"] = true,
	["3k_main_ceo_trait_personality_fiery"] = true,
	["3k_main_ceo_trait_personality_cunning"] = true,
	["3k_main_ceo_trait_personality_pacifist"] = true,
}

-- Automatic diplomatic deals (campaign database); the first faction is the proposer.
local DEALS = {
	war = "data_defined_situation_war_proposer_to_recipient",
	peace = "data_defined_situation_peace",
	alliance = "data_defined_situation_create_alliance_no_conditions",
	trade = "data_defined_situation_trade",
	-- proposer makes the recipient its vassal
	vassal = "data_defined_situation_vassalise_recipient_forced",
	-- proposer absorbs the recipient
	confederate = "data_defined_situation_confederate_recipient_no_requirements",
}

-- generation templates end in the character's element, which decides their class
-- fallback class names (the game's own text, ui_text_replacements 3k_general_type_<element>, is used first)
local CLASSES = {
	earth = { key = "earth", en = "Commander", zh = "指挥" },
	fire = { key = "fire", en = "Vanguard", zh = "先锋" },
	metal = { key = "metal", en = "Sentinel", zh = "铁卫" },
	water = { key = "water", en = "Strategist", zh = "军师" },
	wood = { key = "wood", en = "Champion", zh = "战士" },
}

local CHARACTER_TYPES = { "general", "minister", "spy", "castellan", "champion", "dignitary" }

-- Saved-value key holding this campaign's id; stored in the savegame by the campaign manager.
local CAMPAIGN_ID_KEY = "votc_campaign_id"

local last_selected = nil -- { kind = "character", cqi = n } or { kind = "settlement", region = key }
-- Command ids are digit strings, zero-padded to ID_WIDTH so they compare in numeric order
-- (Total War's Lua stores numbers as single-precision floats).
local ID_WIDTH = 20
local last_processed_id = string.rep("0", ID_WIDTH)
local last_cmd_raw = nil
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

local LOG_FILE = "votc_log.txt"
local LOG_MAX_BYTES = 256 * 1024

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
	msg = "[VOTC] " .. tostring(msg)
	append_log(msg)
	if type(ModLog) == "function" then
		pcall(ModLog, msg)
	elseif type(out) == "function" then
		pcall(out, msg)
	end
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

-- strip UI markup like [[col:red]]...[[/col]] and {{tr:...}} from localised strings
local function clean_text(s)
	s = s:gsub("%[%[[^%]]*%]%]", "")
	s = s:gsub("{{[^}]*}}", "")
	s = s:gsub("^%s+", ""):gsub("%s+$", "")
	return s
end

local function loc(key, fallback)
	fallback = fallback or ""
	if type(key) ~= "string" or key == "" then
		return fallback
	end
	local ok, s = pcall(function() return effect.get_localised_string(key) end)
	if ok and type(s) == "string" and s ~= "" and s ~= key then
		s = clean_text(s)
		if s ~= "" then
			return s
		end
	end
	return fallback
end

local function is_null(obj)
	if not obj then
		return true
	end
	return try(function() return obj:is_null_interface() end, false)
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
-- game lookups (query interfaces)
--------------------------------------------------------------------------------

local function get_faction(key)
	if type(key) ~= "string" or key == "" then
		return nil
	end
	local f = try(function() return cm:query_faction(key) end, nil)
	if f and not is_null(f) then
		return f
	end
	return nil
end

local function get_character(cqi)
	cqi = tonumber(cqi)
	if not cqi then
		return nil
	end
	local c = try(function() return cm:query_character(cqi) end, nil)
	if c and not is_null(c) and not try(function() return c:is_dead() end, false) then
		return c
	end
	return nil
end

local function cqi_of(c)
	return try(function() return c:command_queue_index() end, nil) or try(function() return c:cqi() end, 0)
end

local function character_name(c)
	local forename = loc(try(function() return c:get_forename() end, ""), "")
	local surname = loc(try(function() return c:get_surname() end, ""), "")
	-- Chinese names put the family name first
	local name = surname .. forename
	if forename ~= "" and surname ~= "" and not surname:find("[\128-\255]") then
		name = forename .. " " .. surname
	end
	if name == "" then
		name = try(function() return c:generation_template_key() end, "") or ""
	end
	return name
end

local function faction_name(f)
	return loc("factions_screen_name_" .. f:name(), f:name())
end

local function region_name(key)
	return loc("regions_onscreen_" .. key, key)
end

local function local_faction()
	local f = try(function() return cm:query_local_faction(true) end, nil)
	if f and not is_null(f) then
		return f
	end
	return nil
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

local function has_deal(a, b, component)
	return try(function() return a:has_specified_diplomatic_deal_with(component, b) end, false)
end

local function at_war(a, b)
	return has_deal(a, b, "treaty_components_war") or has_deal(a, b, "treaty_components_group_war")
end

-- the faction whose vassal `f` is, if any
local function master_of(f)
	local list = try(function() return f:factions_we_have_specified_diplomatic_deal_with_directional("treaty_components_vassalage", false) end, nil)
	if list and not try(function() return list:is_empty() end, true) then
		return list:item_at(0)
	end
	return nil
end

--------------------------------------------------------------------------------
-- export
--------------------------------------------------------------------------------

local function is_character_unit(u)
	return try(function() return u:unit_class() == "com" end, false)
end

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
	end
	for _, key in ipairs(order) do
		local e = by_key[key]
		army.units[#army.units + 1] = { key = e.key, name = e.name, count = e.count, strength = math.floor(e.strengthSum / e.count + 0.5) }
	end
	-- a Three Kingdoms army has up to three generals
	local chars = try(function() return mf:character_list() end, nil)
	if chars then
		for i = 0, chars:num_items() - 1 do
			local h = chars:item_at(i)
			if cqi_of(h) ~= cqi_of(c) then
				army.heroes[#army.heroes + 1] = character_name(h)
			end
		end
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

-- relationship kinds worth telling the AI about (acquaintances are not)
local RELATIONSHIP_SKIP = {
	["3k_main_relationship_positive_01"] = true,
	["3k_main_relationship_negative_01"] = true,
}
local MAX_RELATIONSHIPS = 20

-- name of the character behind a family member interface (nil when there is none)
local function family_name(member)
	if not member or is_null(member) then
		return nil
	end
	local ch = try(function() return member:character() end, nil)
	if ch and not is_null(ch) then
		return character_name(ch)
	end
	return nil
end

-- spouse, parents, children, and friends / sworn kin / rivals / nemeses with their names
local function export_family(c)
	local family = {}
	local fm = try(function() return c:family_member() end, nil)
	if fm and not is_null(fm) then
		if try(function() return fm:has_spouse() end, false) then
			family.spouse = family_name(try(function() return fm:spouse() end, nil))
		end
		if try(function() return fm:has_father() end, false) then
			family.father = family_name(try(function() return fm:father() end, nil))
		end
		if try(function() return fm:has_mother() end, false) then
			family.mother = family_name(try(function() return fm:mother() end, nil))
		end
		local kids = try(function() return fm:children() end, nil)
		if kids and not is_null(kids) and kids.num_items then
			family.children = new_array()
			for i = 0, math.min(try(function() return kids:num_items() end, 0), 12) - 1 do
				local name = family_name(try(function() return kids:item_at(i) end, nil))
				if name then
					family.children[#family.children + 1] = name
				end
			end
		end
	end
	local relationships = new_array()
	local own = cqi_of(c)
	local rels = try(function() return c:relationships() end, nil)
	if rels and not is_null(rels) then
		for i = 0, try(function() return rels:num_items() end, 0) - 1 do
			if #relationships >= MAX_RELATIONSHIPS then
				break
			end
			local rel = rels:item_at(i)
			local key = try(function() return rel:relationship_record_key() end, "") or ""
			if key ~= "" and not RELATIONSHIP_SKIP[key] then
				local kind = loc("character_relationships_name_" .. key, key)
				local chars = try(function() return rel:get_relationship_characters() end, nil)
				if chars and not is_null(chars) then
					for j = 0, try(function() return chars:num_items() end, 0) - 1 do
						local other = chars:item_at(j)
						if other and not is_null(other) and cqi_of(other) ~= own then
							relationships[#relationships + 1] = { kind = kind, name = character_name(other) }
						end
					end
				end
			end
		end
	end
	return family, relationships
end

local function export_character(c)
	local template = try(function() return c:generation_template_key() end, "") or ""
	local element = template:match("_(%a+)$")
	local class = element and CLASSES[element] or nil
	local t = {
		cqi = cqi_of(c),
		name = character_name(c),
		forename = loc(try(function() return c:get_forename() end, ""), ""),
		-- the generation template identifies historical characters (backstory files use it)
		subtypeKey = template ~= "" and template or try(function() return c:character_subtype_key() end, ""),
		subtypeName = class and loc("ui_text_replacements_localised_text_3k_general_type_" .. class.key, class.zh) or "",
		typeKey = character_type(c),
		rank = try(function() return c:rank() end, 0),
		age = try(function() return c:age() end, 0),
		isMale = try(function() return c:is_male() end, true),
		isFactionLeader = try(function() return c:is_faction_leader() end, false),
		isWounded = try(function() return c:is_wounded() end, false),
		isEmbedded = false,
		battlesWon = try(function() return c:battles_won() end, 0),
		battlesFought = try(function() return c:battles_fought() end, 0),
		factionKey = c:faction():name(),
		traits = new_array(),
		satisfaction = try(function() return c:loyalty() end, nil),
		classKey = class and class.key or nil,
		className = class and class.en or nil,
	}
	local post = try(function() return c:character_post() end, nil)
	if post and not is_null(post) then
		local post_key = try(function() return post:ministerial_position_record_key() end, nil)
		if post_key then
			t.postName = loc("ministerial_positions_localised_name_" .. post_key, post_key)
		end
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
	local ceos = try(function() return c:ceo_management() end, nil)
	if ceos and not is_null(ceos) then
		for key in pairs(ALLOWED_TRAITS) do
			if try(function() return ceos:has_ceo_equipped(key) end, false) then
				t.traits[#t.traits + 1] = key
			end
		end
	end
	t.family, t.relationships = export_family(c)
	-- the game's own short biography of famous characters (title and flavour line)
	if template ~= "" then
		local bio = loc("frontend_faction_leader_unique_characters_localised_description_" .. template, "")
		if bio ~= "" then
			t.biography = bio:gsub("%s+", " ")
		end
	end
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
		treasury = try(function() return f:treasury() end, 0),
		isHuman = try(function() return f:is_human() end, false),
		isDead = try(function() return f:is_dead() end, false),
		regions = new_array(),
		regionCount = 0,
		armyCount = 0,
		atWarWith = new_array(),
	}
	t.cultureName = loc("cultures_name_" .. t.cultureKey, "")
	t.subcultureName = loc("cultures_subcultures_name_" .. t.subcultureKey, "")

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
	if try(function() return f:has_capital_region() end, false) then
		local key = f:capital_region():name()
		t.capitalKey = key
		t.capitalName = region_name(key)
	end
	local leader = leader_of(f)
	if leader then
		t.leaderCqi = cqi_of(leader)
		t.leaderName = character_name(leader)
	end

	-- wars: walk the faction list once (diplomacy is per pair in Three Kingdoms)
	pcall(function()
		local all = cm:query_model():world():faction_list()
		for i = 0, all:num_items() - 1 do
			local other = all:item_at(i)
			if #t.atWarWith >= 20 then
				break
			end
			if other:name() ~= f:name() and not try(function() return other:is_dead() end, true) and at_war(f, other) then
				t.atWarWith[#t.atWarWith + 1] = { key = other:name(), name = faction_name(other) }
			end
		end
	end)

	if player and f:name() ~= player:name() then
		t.atWarWithPlayer = at_war(f, player)
		t.alliedWithPlayer = has_deal(f, player, "treaty_components_alliance") or has_deal(f, player, "treaty_components_coalition")
		local f_master = master_of(f)
		local p_master = master_of(player)
		t.isVassalOfPlayer = f_master ~= nil and f_master:name() == player:name()
		t.isMasterOfPlayer = p_master ~= nil and p_master:name() == f:name()
		-- diplomatic standing is roughly -100..100 like Warhammer's attitude
		t.attitudeToPlayer = try(function() return f:diplomatic_standing_with(player) end, 0)
		t.playerAttitudeToThem = try(function() return player:diplomatic_standing_with(f) end, 0)
		t.tradingWithPlayer = has_deal(f, player, "treaty_components_trade")
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
		local region = try(function() return cm:query_region(last_selected.region) end, nil)
		local owner = region and try(function() return region:owning_faction() end, nil)
		if not owner or is_null(owner) or try(function() return owner:is_dead() end, true) then
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

local function get_campaign_id()
	local id = try(function() return cm:get_saved_value(CAMPAIGN_ID_KEY) end, nil)
	if type(id) == "string" and id ~= "" then
		return id
	end
	local faction = local_faction_name() or "unknown"
	id = string.format("%s_%.0f_%04d", tostring(faction), now_seconds() or 0, math.random(0, 9999))
	id = id:gsub("[^%w_%-]", "_")
	cm:set_saved_value(CAMPAIGN_ID_KEY, id)
	log("new campaign id " .. id)
	return id
end

local SEASONS_ZH = { [0] = "春", [1] = "夏", [2] = "秋", [3] = "冬" }
local SEASONS_EN = { [0] = "Spring", [1] = "Summer", [2] = "Autumn", [3] = "Winter" }

local function date_text()
	local year = try(function() return cm:query_model():calendar_year() end, nil)
	if not year then
		return nil
	end
	local season = try(function() return cm:query_model():season() end, nil)
	-- the launcher writes the game language here ("CN" for Simplified Chinese)
	local language = (read_file("data/language.txt") or ""):upper()
	if language:find("CN") or language:find("ZH") then
		return string.format("%d年%s", year, season and SEASONS_ZH[season] or "")
	end
	return (season and SEASONS_EN[season] and (SEASONS_EN[season] .. " ") or "") .. tostring(year)
end

-- the world situation everyone knows: the biggest living factions, their leaders and their wars
local WORLD_FACTIONS = 15

local function export_world()
	local world = new_array()
	pcall(function()
		local all = cm:query_model():world():faction_list()
		local big = {}
		for i = 0, all:num_items() - 1 do
			local f = all:item_at(i)
			if not try(function() return f:is_dead() end, true) then
				local n = try(function() return f:region_list():num_items() end, 0)
				if n > 0 then
					big[#big + 1] = { f = f, regions = n }
				end
			end
		end
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

local function build_state(req_id, requested_cqi)
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
	if cqi_of(target.character) == cqi_of(player_char) then
		state.error = "target_is_player"
		return state
	end
	local target_faction = target.character:faction()

	state.turn = try(function() return cm:query_model():turn_number() end, 0)
	state.dateText = date_text()
	state.campaign = try(function() return cm:query_model():campaign_name() end, "")
	state.campaignId = try(get_campaign_id, nil)
	state.player = export_character(player_char)
	state.target = export_character(target.character)
	if target.sceneRegion then
		local r = target.sceneRegion
		state.sceneRegionKey = r:name()
		state.sceneRegionName = region_name(r:name())
		local owner = try(function() return r:owning_faction() end, nil)
		if owner and not is_null(owner) then
			state.sceneRegionOwnerName = faction_name(owner)
			state.sceneIsCapital = try(function() return owner:capital_region():name() == r:name() end, false)
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
-- command executors (run with a modify interface)
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

local function require_two_factions(a_key, b_key)
	local a = require_faction(a_key, "faction a")
	local b = require_faction(b_key, "faction b")
	if a:name() == b:name() then
		error("factions must differ", 0)
	end
	return a, b
end

local function apply_deal(a, b, deal)
	local key = DEALS[deal]
	local option = "faction_key:" .. b:name()
	if not try(function() return a:can_apply_automatic_diplomatic_deal(key, b, option) end, false) then
		error("the game does not allow " .. deal .. " between these factions right now", 0)
	end
	cm:modify_faction(a):apply_automatic_diplomatic_deal(key, b, option)
end

local EXECUTORS = {}

EXECUTORS.export = function(cmd)
	local ok, state = pcall(build_state, cmd.reqId, cmd.targetCqi)
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
	cm:modify_faction(from):decrease_treasury(amount)
	cm:modify_faction(to):increase_treasury(amount)
	return "transferred " .. amount
end

EXECUTORS.war = function(cmd)
	local a, b = require_two_factions(cmd.a, cmd.b)
	if at_war(a, b) then
		return "already at war"
	end
	apply_deal(a, b, "war")
	return "war declared"
end

EXECUTORS.peace = function(cmd)
	local a, b = require_two_factions(cmd.a, cmd.b)
	if not at_war(a, b) then
		return "not at war"
	end
	apply_deal(a, b, "peace")
	return "peace made"
end

EXECUTORS.alliance = function(cmd)
	local a, b = require_two_factions(cmd.a, cmd.b)
	if at_war(a, b) then
		apply_deal(a, b, "peace")
	end
	apply_deal(a, b, "alliance")
	return "alliance formed"
end

EXECUTORS.trade = function(cmd)
	local a, b = require_two_factions(cmd.a, cmd.b)
	if at_war(a, b) then
		error("cannot trade while at war", 0)
	end
	apply_deal(a, b, "trade")
	return "trade agreement"
end

EXECUTORS.vassal = function(cmd)
	local master, vassal = require_two_factions(cmd.master, cmd.vassal)
	if at_war(master, vassal) then
		apply_deal(master, vassal, "peace")
	end
	apply_deal(master, vassal, "vassal")
	return "vassalised"
end

EXECUTORS.confederate = function(cmd)
	local absorber, absorbed = require_two_factions(cmd.absorber, cmd.absorbed)
	if try(function() return absorbed:is_human() end, false) then
		error("cannot confederate a human faction", 0)
	end
	apply_deal(absorber, absorbed, "confederate")
	return "confederated"
end

EXECUTORS.transfer_region = function(cmd)
	local to = require_faction(cmd.to, "recipient")
	local region = try(function() return cm:query_region(cmd.region) end, nil)
	if not region or is_null(region) then
		error("region not found: " .. tostring(cmd.region), 0)
	end
	local owner = region:owning_faction()
	if is_null(owner) or owner:name() ~= cmd.from then
		error("region is not owned by " .. tostring(cmd.from), 0)
	end
	if owner:name() == to:name() then
		return "already owned"
	end
	cm:modify_model():get_modify_region(region):settlement_gifted_as_if_by_payload(cm:modify_faction(to))
	return "region transferred"
end

EXECUTORS.add_trait = function(cmd)
	local c = require_character(cmd.cqi)
	if not ALLOWED_TRAITS[cmd.trait] then
		error("trait not allowed: " .. tostring(cmd.trait), 0)
	end
	cm:modify_character(c):ceo_management():add_ceo(cmd.trait)
	return "trait added"
end

EXECUTORS.add_xp = function(cmd)
	local c = require_character(cmd.cqi)
	local levels = require_int(cmd.levels, 1, 5, "levels")
	-- roughly one rank per 1500 experience in the early ranks
	cm:modify_character(c):add_experience(levels * 1500, 0)
	return "experience added"
end

EXECUTORS.kill = function(cmd)
	local c = require_character(cmd.cqi)
	if try(function() return c:faction():is_human() and c:is_faction_leader() end, false) then
		error("refusing to kill a human faction leader", 0)
	end
	cm:modify_character(c):kill_character(false)
	return "killed"
end

EXECUTORS.replenish_ap = function(cmd)
	local c = require_character(cmd.cqi)
	cm:modify_character(c):replenish_action_points()
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

function votc_3k_poll_commands()
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
	-- changes to the model need its modify interface; reads work either way
	if cm:can_modify(true) then
		process_commands(data)
	else
		cm:wait_for_model_sp(function() process_commands(data) end)
	end
end

local function restore_last_processed_id()
	local raw = read_file(ACK_FILE)
	local id = raw and (raw:match('"lastId":"(%d+)"') or raw:match('"lastId":(%d+)'))
	id = normalize_id(id)
	if id then
		last_processed_id = id
	end
end

--------------------------------------------------------------------------------
-- entry point, called by the mod loader on the first tick
--------------------------------------------------------------------------------

function votc_3k()
	if started then
		return
	end
	if cm:is_multiplayer() then
		log("multiplayer campaign detected, VOTC is disabled")
		return
	end
	started = true

	restore_last_processed_id()
	pcall(get_campaign_id)

	core:add_listener(
		"votc_3k_character_selected",
		"CharacterSelected",
		true,
		function(context)
			local c = try(function() return context:character() end, nil)
			if c and not is_null(c) and not is_player_leader(c) then
				last_selected = { kind = "character", cqi = cqi_of(c) }
			end
		end,
		true
	)

	core:add_listener(
		"votc_3k_settlement_selected",
		"SettlementSelected",
		true,
		function(context)
			local region = try(function() return context:settlement():region():name() end, nil)
				or try(function() return context:garrison_residence():region():name() end, nil)
			if region then
				last_selected = { kind = "settlement", region = region }
			end
		end,
		true
	)

	cm:repeat_callback(function()
		local ok, err = pcall(votc_3k_poll_commands)
		if not ok then
			log("poll error: " .. tostring(err))
		end
	end, POLL_INTERVAL_S, "votc_3k_poll_commands")

	write_ack(new_array())
	log("bridge " .. VOTC_VERSION .. " started, last command id " .. last_processed_id)
end

-- exposed for tests
votc_3k_internal = {
	json_encode = json_encode,
	new_array = new_array,
	build_state = build_state,
	execute_command = execute_command,
	load_commands = load_commands,
	set_last_selected = function(v) last_selected = v end,
	get_last_processed_id = function() return last_processed_id end,
	ALLOWED_TRAITS = ALLOWED_TRAITS,
	DEALS = DEALS,
}
