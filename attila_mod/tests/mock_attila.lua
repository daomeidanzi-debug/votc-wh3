-- Minimal mock of the Total War: ATTILA episodic scripting API used by votc_attila.lua.
-- Names are localisation keys (Attila scripts cannot localise); commands take lookup strings.

mock = { calls = {}, triggers = {}, local_faction = nil, multiplayer = false }
events = { FirstTickAfterWorldCreated = {}, TimeTrigger = {}, CharacterSelected = {}, SettlementSelected = {} }

local function record(name, ...)
	mock.calls[#mock.calls + 1] = { name = name, args = { ... } }
end

local function list(items)
	return {
		num_items = function() return #items end,
		item_at = function(_, i) return items[i + 1] end,
		is_null_interface = function() return false end,
	}
end

mock.factions, mock.faction_order, mock.regions, mock.wars, mock.alliances = {}, {}, {}, {}, {}

local function pair(a, b) return a < b and (a .. "|" .. b) or (b .. "|" .. a) end

function mock.add_faction(key, opts)
	opts = opts or {}
	local f = { _key = key, _treasury = opts.treasury or 1000, _human = opts.human or false, _regions = {}, _chars = {}, _leader = nil }
	function f:is_null_interface() return false end
	function f:name() return self._key end
	function f:treasury() return self._treasury end
	function f:is_human() return self._human end
	function f:culture() return "att_cult_roman" end
	function f:subculture() return "att_sub_cult_roman_west" end
	function f:state_religion() return "att_rel_chr_catholic" end
	function f:is_horde() return false end
	function f:region_list() return list(self._regions) end
	function f:military_force_list() return list({}) end
	function f:character_list() return list(self._chars) end
	function f:has_home_region() return #self._regions > 0 end
	function f:home_region() return self._regions[1] end
	function f:has_faction_leader() return self._leader ~= nil end
	function f:faction_leader() return self._leader end
	function f:at_war_with(o) return mock.wars[pair(self._key, o:name())] == true end
	function f:allied_with(o) return mock.alliances[pair(self._key, o:name())] == true end
	mock.factions[key] = f
	mock.faction_order[#mock.faction_order + 1] = f
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

function mock.add_character(cqi, faction, opts)
	opts = opts or {}
	local c = { _cqi = cqi, _faction = faction, _o = opts, _traits = opts.traits or {} }
	function c:is_null_interface() return false end
	function c:cqi() return self._cqi end
	function c:get_forename() return self._o.forename or "" end
	function c:get_surname() return self._o.surname or "" end
	function c:faction() return self._faction end
	function c:character_type(t) return t == (self._o.type or "general") end
	function c:rank() return 3 end
	function c:age() return self._o.age or 40 end
	function c:is_male() return self._o.male ~= false end
	function c:is_faction_leader() return self._o.leader == true end
	function c:is_embedded_in_military_force() return false end
	function c:battles_won() return 2 end
	function c:battles_fought() return 3 end
	function c:loyalty() return 7 end
	function c:gravitas() return 12 end
	function c:is_politician() return false end
	function c:has_region() return self._o.region ~= nil end
	function c:region() return self._o.region end
	function c:has_trait(k) return self._traits[k] == true end
	function c:has_father() return self._o.father ~= nil end
	function c:father() return self._o.father end
	function c:has_mother() return false end
	function c:has_military_force() return false end
	-- family_member is missing on purpose: the bridge must cope
	faction._chars[#faction._chars + 1] = c
	if opts.leader then faction._leader = c end
	return c
end

local world = {}
function world:faction_list() return list(mock.faction_order) end
function world:faction_exists(k) return mock.factions[k] ~= nil end
function world:faction_by_key(k) return mock.factions[k] end
function world:region_manager()
	return { region_by_key = function(_, k) return mock.regions[k] end }
end

local model = {}
function model:world() return world end
function model:turn_number() return 12 end
function model:is_multiplayer() return mock.multiplayer end
function model:faction_is_local(k) return mock.local_faction and mock.local_faction:name() == k end

local gi = {}
function gi:model() return model end
function gi:add_time_trigger(name, t) mock.triggers[#mock.triggers + 1] = name end
for _, name in ipairs({ "treasury_mod", "force_declare_war", "force_make_peace", "force_make_trade_agreement",
	"force_make_vassal", "transfer_region_to_faction", "force_add_trait", "add_agent_experience",
	"kill_character", "replenish_action_points" }) do
	gi[name] = function(self, ...) record(name, ...) end
end

scripting = { game_interface = gi }
campaign_name = "main_attila"

function mock.fire(event, context)
	for _, fn in ipairs(events[event]) do fn(context) end
end
