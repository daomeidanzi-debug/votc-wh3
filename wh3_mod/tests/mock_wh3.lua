-- Minimal mock of the Warhammer III campaign scripting API used by votc_wh3.lua.
-- Interfaces are plain tables with methods; lists are 0-indexed like the game's.

mock = { calls = {}, listeners = {}, real_callbacks = {}, loc = {}, panel_open = false, diplomacy_faction_cqi = nil }

local function record(name, ...)
	mock.calls[#mock.calls + 1] = { name = name, args = { ... } }
end

local function list(items)
	return {
		num_items = function() return #items end,
		item_at = function(_, i) return items[i + 1] end,
		is_empty = function() return #items == 0 end,
	}
end
mock.list = list

local NULL = { is_null_interface = function() return true end }

-- world ------------------------------------------------------------------------
mock.factions = {}
mock.characters = {}
mock.regions = {}

local next_faction_cqi = 100
function mock.add_faction(key, opts)
	opts = opts or {}
	next_faction_cqi = next_faction_cqi + 1
	opts.cqi = opts.cqi or next_faction_cqi
	local f = { _key = key, _treasury = opts.treasury or 1000, _human = opts.human or false, _dead = false,
		_wars = {}, _allies = {}, _vassal_of = nil, _attitude = opts.attitude or {}, _regions = {}, _forces = {}, _leader = nil,
		_culture = opts.culture or "wh_main_emp_empire", _subculture = opts.subculture or "wh_main_sc_emp_empire", _cqi = opts.cqi }
	function f:is_null_interface() return false end
	function f:name() return self._key end
	function f:command_queue_index() return self._cqi end
	function f:treasury() return self._treasury end
	function f:is_human() return self._human end
	function f:is_dead() return self._dead end
	function f:culture() return self._culture end
	function f:subculture() return self._subculture end
	function f:at_war_with(o) return self._wars[o:name()] == true end
	function f:allied_with(o) return self._allies[o:name()] == true end
	function f:is_vassal_of(o) return self._vassal_of == o:name() end
	function f:diplomatic_attitude_towards(k) assert(type(k) == "string"); return self._attitude[k] or 0 end
	function f:region_list() return list(self._regions) end
	function f:military_force_list() return list(self._forces) end
	function f:has_home_region() return #self._regions > 0 end
	function f:home_region() return self._regions[1] end
	function f:has_faction_leader() return self._leader ~= nil end
	function f:faction_leader() return self._leader or NULL end
	function f:factions_trading_with() return list({}) end
	function f:factions_at_war_with()
		local out = {}
		for k, v in pairs(self._wars) do if v then out[#out + 1] = mock.factions[k] end end
		return list(out)
	end
	mock.factions[key] = f
	return f
end

function mock.add_region(key, owner)
	local r = { _key = key, _owner = owner }
	function r:is_null_interface() return false end
	function r:name() return self._key end
	function r:owning_faction() return self._owner end
	mock.regions[key] = r
	owner._regions[#owner._regions + 1] = r
	return r
end

local next_unit_cqi = 5000
mock.units = {}
local function make_unit(key, class, strength)
	next_unit_cqi = next_unit_cqi + 1
	local cqi = next_unit_cqi
	local u = {
		_cqi = cqi,
		unit_key = function() return key end,
		unit_class = function() return class end,
		percentage_proportion_of_full_strength = function() return strength or 100 end,
		command_queue_index = function() return cqi end,
	}
	mock.units[cqi] = u
	return u
end

function mock.add_character(cqi, faction, opts)
	opts = opts or {}
	local c = { _cqi = cqi, _faction = faction, _traits = {}, _units = {}, _region = opts.region }
	function c:is_null_interface() return false end
	function c:command_queue_index() return self._cqi end
	function c:cqi() return self._cqi end
	function c:faction() return self._faction end
	function c:get_forename() return opts.forename or "" end
	function c:get_surname() return opts.surname or "" end
	function c:character_subtype_key() return opts.subtype or "wh_main_emp_lord" end
	function c:character_type_key() return opts.type or "general" end
	function c:rank() return opts.rank or 5 end
	function c:age() return opts.age or 40 end
	function c:is_male() return opts.male ~= false end
	function c:is_faction_leader() return self._faction._leader == self end
	function c:is_wounded() return false end
	function c:is_embedded_in_military_force() return false end
	function c:battles_won() return 3 end
	function c:battles_fought() error("not available in this build") end
	function c:has_trait(k) return self._traits[k] == true end
	function c:has_region() return self._region ~= nil end
	function c:region() return self._region end
	function c:has_military_force() return opts.army == true end
	local mf = {
		unit_list = function() return list(c._units) end,
		character_list = function() return list({ c }) end,
		general_character = function() return c end,
		is_armed_citizenry = function() return false end,
	}
	function c:military_force() return mf end
	if opts.army then
		c._units[#c._units + 1] = make_unit(opts.subtype or "wh_main_emp_lord", "com")
		for _, u in ipairs(opts.units or {}) do
			c._units[#c._units + 1] = make_unit(u, "inf_mel", 80)
		end
		faction._forces[#faction._forces + 1] = mf
	end
	if opts.leader then faction._leader = c end
	mock.characters[cqi] = c
	return c
end

-- globals ------------------------------------------------------------------------
common = {
	get_localised_string = function(key)
		return mock.loc[key] or ""
	end,
	-- character context ids convert to a cqi through "CQI", like the real engine
	get_context_value = function(cco_type, id, expression)
		if cco_type == "CcoCampaignCharacter" and expression == "CQI" then
			return tonumber(id)
		end
		return nil
	end,
}

function out(s) mock.log = (mock.log or "") .. tostring(s) .. "\n" end
function ModLog(s) out(s) end

core = {
	add_listener = function(_, name, event, cond, fn, persist)
		mock.listeners[event] = fn
	end,
	get_ui_root = function() return {} end,
}

-- UI components: mock.ui_component({ CcoCampaignUnit = "5002" }, children) builds a node whose
-- GetContextObjectId answers from the table; children get Parent() links.
function mock.ui_component(contexts, children)
	local node = { _contexts = contexts or {}, _children = children or {}, _parent = nil }
	function node:GetContextObjectId(t) return self._contexts[t] end
	function node:Parent() return self._parent end
	function node:ChildCount() return #self._children end
	function node:Find(i) return self._children[i + 1] end
	for _, child in ipairs(node._children) do child._parent = node end
	return node
end

mock.ui = {}      -- "a/b/c" path -> component, for find_uicomponent
mock.panels = {}  -- panel name -> true when open

function mock.click(component)
	mock.listeners["ComponentLClickUp"]({ component = component })
end

function find_uicomponent(root, ...)
	return mock.ui[table.concat({ ... }, "/")] or false
end

function UIComponent(x) return x end

-- context objects: mock.cco_values[type][id][expression] = value (as the engine's cco() global)
mock.cco_values = { CcoAgentSubtypeRecord = {} }
function cco(cco_type, id)
	local records = mock.cco_values[cco_type] or {}
	local record = records[id]
	return {
		Call = function(_, expression)
			if record == nil then return nil end
			return record[expression]
		end,
	}
end

cm = {}
-- the savegame's saved values; tests copy this table between VMs to simulate save/load
mock.saved_values = {}
function cm:get_saved_value(name) return mock.saved_values[name] end
function cm:set_saved_value(name, value) assert(not name:find(":"), "illegal saved value name"); mock.saved_values[name] = value end
function cm:get_local_faction_name(force) return mock.local_faction and mock.local_faction:name() or false end
function cm:is_multiplayer() return false end
function cm:turn_number() return 42 end
function cm:get_campaign_name() return "main_warhammer" end
function cm:get_local_faction(force) return mock.local_faction end
function cm:get_faction(key) return mock.factions[key] or false end
function cm:get_region(key) return mock.regions[key] or false end
function cm:get_character_by_cqi(cqi) return mock.characters[tonumber(cqi)] or false end
function cm:faction_has_trade_agreement_with_faction(a, b) return false end
function cm:get_campaign_ui_manager()
	return { is_panel_open = function(_, p) return mock.panels[p] == true end }
end
function cm:model()
	return {
		faction_for_command_queue_index = function(_, cqi)
			for _, f in pairs(mock.factions) do if f:command_queue_index() == cqi then return f end end
			return NULL
		end,
		world = function()
			return {
				faction_list = function()
					local all = {}
					for _, f in pairs(mock.factions) do all[#all + 1] = f end
					return list(all)
				end,
			}
		end,
	}
end
function cm:repeat_real_callback(fn, ms, name) mock.real_callbacks[name] = fn end

local function cqi_of(lookup) return tonumber(tostring(lookup):match("character_cqi:(%d+)")) end

function cm:treasury_mod(key, amount) record("treasury_mod", key, amount); mock.factions[key]._treasury = mock.factions[key]._treasury + amount end
function cm:apply_dilemma_diplomatic_bonus(a, b, n) record("apply_dilemma_diplomatic_bonus", a, b, n) end
function cm:force_declare_war(a, b, x, y) record("force_declare_war", a, b, x, y); mock.factions[a]._wars[b] = true; mock.factions[b]._wars[a] = true end
function cm:force_make_peace(a, b) record("force_make_peace", a, b); mock.factions[a]._wars[b] = nil; mock.factions[b]._wars[a] = nil end
function cm:force_alliance(a, b, m) record("force_alliance", a, b, m); mock.factions[a]._allies[b] = true; mock.factions[b]._allies[a] = true end
function cm:force_make_trade_agreement(a, b) record("force_make_trade_agreement", a, b) end
function cm:force_make_vassal(a, b) record("force_make_vassal", a, b); mock.factions[b]._vassal_of = a end
function cm:force_confederation(a, b) record("force_confederation", a, b) end
function cm:transfer_region_to_faction(r, f) record("transfer_region_to_faction", r, f); mock.regions[r]._owner = mock.factions[f] end
function cm:force_add_trait(l, t, s) record("force_add_trait", cqi_of(l), t, s); mock.characters[cqi_of(l)]._traits[t] = true end
function cm:add_agent_experience(l, n, by_level) record("add_agent_experience", cqi_of(l), n, by_level) end
function cm:wound_character(l, t) record("wound_character", cqi_of(l), t) end
function cm:kill_character(c, d) assert(type(c) == "number"); record("kill_character", c, d) end
function cm:replenish_action_points(l) record("replenish_action_points", cqi_of(l)) end
function cm:remove_unit_from_character(l, u) record("remove_unit_from_character", cqi_of(l), u) end
function cm:grant_unit_to_character(l, u) record("grant_unit_to_character", cqi_of(l), u) end
