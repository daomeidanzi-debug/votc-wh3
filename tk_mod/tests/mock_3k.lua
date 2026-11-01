-- Minimal mock of the Three Kingdoms campaign scripting API used by votc_3k.lua:
-- query interfaces for reading, modify interfaces (only while a model context exists) for changes.

mock = { calls = {}, listeners = {}, callbacks = {}, loc = {}, saved = {}, can_modify = true, waiting = {} }

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

mock.factions = {}
mock.characters = {}
mock.regions = {}
mock.deals = {} -- deals["a|b|component"] = true (symmetric for war/alliance/trade)

local function deal_key(a, b, c) return a .. "|" .. b .. "|" .. c end

function mock.set_deal(a, b, component, value)
	mock.deals[deal_key(a, b, component)] = value
	mock.deals[deal_key(b, a, component)] = value
end

function mock.add_faction(key, opts)
	opts = opts or {}
	local f = { _key = key, _treasury = opts.treasury or 1000, _human = opts.human or false, _dead = false,
		_regions = {}, _forces = {}, _leader = nil, _standing = opts.standing or {}, _master = nil }
	function f:is_null_interface() return false end
	function f:name() return self._key end
	function f:treasury() return self._treasury end
	function f:is_human() return self._human end
	function f:is_dead() return self._dead end
	function f:culture() return "3k_main_chinese" end
	function f:subculture() return "3k_main_subculture_han" end
	function f:region_list() return list(self._regions) end
	function f:military_force_list() return list(self._forces) end
	function f:has_capital_region() return #self._regions > 0 end
	function f:capital_region() return self._regions[1] end
	function f:has_faction_leader() return self._leader ~= nil end
	function f:faction_leader() return self._leader or NULL end
	function f:has_specified_diplomatic_deal_with(component, other)
		return mock.deals[deal_key(self._key, other:name(), component)] == true
	end
	function f:factions_we_have_specified_diplomatic_deal_with_directional(component, as_master)
		assert(component == "treaty_components_vassalage")
		if as_master then return list({}) end
		return list(self._master and { mock.factions[self._master] } or {})
	end
	function f:diplomatic_standing_with(other) return self._standing[other:name()] or 0 end
	function f:can_apply_automatic_diplomatic_deal(key, other, option)
		assert(option == "faction_key:" .. other:name(), "deal option must name the recipient")
		return not mock.blocked_deals or not mock.blocked_deals[key]
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

local function unit(key, class)
	return {
		unit_key = function() return key end,
		unit_class = function() return class end,
		percentage_proportion_of_full_strength = function() return 80 end,
	}
end

function mock.add_character(cqi, faction, opts)
	opts = opts or {}
	local c = { _cqi = cqi, _faction = faction, _dead = false, _ceos = {}, _xp = 0 }
	for _, t in ipairs(opts.traits or {}) do c._ceos[t] = true end
	function c:is_null_interface() return false end
	function c:command_queue_index() return self._cqi end
	function c:get_forename() return opts.forename or "" end
	function c:get_surname() return opts.surname or "" end
	function c:generation_template_key() return opts.template or "" end
	function c:character_subtype_key() return "3k_general" end
	function c:character_type(t) return t == (opts.type or "general") end
	function c:rank() return opts.rank or 3 end
	function c:age() return opts.age or 30 end
	function c:is_male() return true end
	function c:is_faction_leader() return opts.leader == true end
	function c:is_wounded() return false end
	function c:is_dead() return self._dead end
	function c:battles_won() return 2 end
	function c:battles_fought() return 3 end
	function c:faction() return self._faction end
	function c:loyalty() return opts.loyalty or 50 end
	function c:character_post() return NULL end
	function c:has_region() return opts.region ~= nil end
	function c:region() return opts.region end
	function c:ceo_management()
		local ch = self
		return {
			is_null_interface = function() return false end,
			has_ceo_equipped = function(_, key) return ch._ceos[key] == true end,
		}
	end
	-- family: opts.spouse / opts.father (cqi of other mock characters), relationships: opts.rels = { { key, cqi } }
	function c:family_member()
		local function member(cqi)
			return { is_null_interface = function() return cqi == nil end, character = function() return mock.characters[cqi] end }
		end
		return {
			is_null_interface = function() return false end,
			has_spouse = function() return opts.spouse ~= nil end,
			spouse = function() return member(opts.spouse) end,
			has_father = function() return opts.father ~= nil end,
			father = function() return member(opts.father) end,
			has_mother = function() return false end,
		}
	end
	function c:relationships()
		local items = {}
		for _, r in ipairs(opts.rels or {}) do
			items[#items + 1] = {
				relationship_record_key = function() return r[1] end,
				get_relationship_characters = function() return list({ c, mock.characters[r[2]] }) end,
			}
		end
		return list(items)
	end
	function c:has_military_force() return opts.army == true end
	function c:military_force()
		local units = { unit("3k_general_unit", "com") }
		for _, k in ipairs(opts.units or {}) do units[#units + 1] = unit(k, "inf_mel") end
		return {
			unit_list = function() return list(units) end,
			character_list = function() return list({ c }) end,
		}
	end
	if opts.leader then faction._leader = c end
	mock.characters[cqi] = c
	return c
end

-- modify interfaces ------------------------------------------------------------

local function require_model(what)
	assert(mock.can_modify, what .. " called without a modify interface")
end

local function modify_faction(f)
	return {
		increase_treasury = function(_, n) require_model("increase_treasury"); record("increase_treasury", f:name(), n); f._treasury = f._treasury + n end,
		decrease_treasury = function(_, n) require_model("decrease_treasury"); record("decrease_treasury", f:name(), n); f._treasury = f._treasury - n end,
		apply_automatic_diplomatic_deal = function(_, key, other, option)
			require_model("apply_automatic_diplomatic_deal")
			record("deal", f:name(), other:name(), key, option)
			if key == "data_defined_situation_war_proposer_to_recipient" then mock.set_deal(f:name(), other:name(), "treaty_components_war", true) end
			if key == "data_defined_situation_peace" then mock.set_deal(f:name(), other:name(), "treaty_components_war", nil) end
		end,
	}
end

local function modify_character(c)
	return {
		ceo_management = function()
			return { add_ceo = function(_, key) require_model("add_ceo"); record("add_ceo", c._cqi, key); c._ceos[key] = true end }
		end,
		add_experience = function(_, n, r) require_model("add_experience"); record("add_experience", c._cqi, n, r) end,
		kill_character = function(_, b) require_model("kill_character"); record("kill_character", c._cqi, b); c._dead = true end,
		replenish_action_points = function() require_model("replenish_action_points"); record("replenish_action_points", c._cqi) end,
	}
end

-- campaign manager -------------------------------------------------------------

local function query_model()
	return {
		turn_number = function() return 12 end,
		calendar_year = function() return 191 end,
		season = function() return 2 end,
		campaign_name = function() return "3k_main_campaign_map" end,
		world = function()
			return {
				faction_list = function()
					local all = {}
					for _, f in pairs(mock.factions) do all[#all + 1] = f end
					table.sort(all, function(a, b) return a._key < b._key end)
					return list(all)
				end,
			}
		end,
	}
end

cm = {
	is_multiplayer = function() return false end,
	query_model = function() return query_model() end,
	query_faction = function(_, key) return mock.factions[key] or false end,
	query_character = function(_, cqi) return mock.characters[tonumber(cqi)] end,
	query_local_faction = function() return mock.local_faction end,
	query_region = function(_, key) return mock.regions[key] end,
	modify_faction = function(_, f)
		require_model("modify_faction")
		if type(f) == "string" then f = mock.factions[f] end
		return modify_faction(f)
	end,
	modify_character = function(_, c)
		require_model("modify_character")
		if type(c) ~= "table" then c = mock.characters[tonumber(c)] end
		return modify_character(c)
	end,
	modify_model = function()
		require_model("modify_model")
		return {
			get_modify_region = function(_, r)
				return {
					settlement_gifted_as_if_by_payload = function(_, mf)
						record("gift_region", r:name())
						mock.gifted = r:name()
					end,
				}
			end,
		}
	end,
	can_modify = function(_, silent) return mock.can_modify end,
	wait_for_model_sp = function(_, fn) mock.waiting[#mock.waiting + 1] = fn end,
	get_saved_value = function(_, k) return mock.saved[k] end,
	set_saved_value = function(_, k, v) mock.saved[k] = v end,
	repeat_callback = function(_, fn, t, name) mock.callbacks[name] = { fn = fn, t = t } end,
}

-- run the callbacks wait_for_model_sp queued, as the game does on its next model event
function mock.flush_model_callbacks()
	local was = mock.can_modify
	mock.can_modify = true
	local queued = mock.waiting
	mock.waiting = {}
	for _, fn in ipairs(queued) do fn() end
	mock.can_modify = was
end

effect = {
	get_localised_string = function(key) return mock.loc[key] or "" end,
}

core = {
	add_listener = function(_, name, event, cond, fn, persist)
		mock.listeners[event] = fn
	end,
}

function ModLog(text) end
