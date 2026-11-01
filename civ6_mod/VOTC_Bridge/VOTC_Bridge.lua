-- VOTC Bridge - Civilization VI (GPL-3.0, see LICENSE.txt).
-- Part of VOTC, a modified version of Voices of the Court. Unofficial fan project, not
-- affiliated with Firaxis Games or 2K.
--
-- An invisible InGame context. It builds a snapshot of the local player's civilization, the
-- civilizations and city-states it has met and the people the player can talk to, in the
-- same line format as the VOTC Paradox mods (see src/main/games/paradox/types.ts):
--
--   VOTC|BEGIN|civ6|1|<reason>   VOTC|META|<key>|<value>   VOTC|P|<key>|<value>
--   VOTC|C|<tag>|<key>|<value>   VOTC|R|<tag>|<key>|<value> VOTC|CH|<tag>|<name>|<key>|<value>
--   VOTC|END
--
-- Tags are "P" + player id. The VOTC app fetches the text over FireTuner from the InGame
-- state (ExposedMembers.VOTC_Build / ExposedMembers.VOTC_LAST); the same lines go to
-- Lua.log at the start of each turn. Agreed actions are applied by the app in the
-- GameCore_Tuner state; this file never changes the game.

local VERSION = "1"
local MAX_OTHERS = 40

local lines = {}

local function clean(s)
	s = tostring(s or "")
	s = s:gsub("%[[^%]]*%]", "")   -- [ICON_Gold], [COLOR_...]
	s = s:gsub("[|\r\n]", " ")
	s = s:gsub("%s+", " ")
	return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function L(key)
	if key == nil or key == "" then return "" end
	local ok, s = pcall(Locale.Lookup, key)
	if ok and s then return clean(s) end
	return clean(key)
end

local function add(...)
	local parts = { ... }
	for i = 1, #parts do parts[i] = clean(parts[i]) end
	lines[#lines + 1] = "VOTC|" .. table.concat(parts, "|")
end

local function try(fn, default)
	local ok, v = pcall(fn)
	if ok and v ~= nil then return v end
	return default
end

local function tag(id) return "P" .. tostring(id) end

local function civ_name(id)
	return try(function() return L(PlayerConfigurations[id]:GetCivilizationShortDescription()) end, tag(id))
end

local function leader_name(id)
	return try(function() return L(PlayerConfigurations[id]:GetLeaderName()) end, "")
end

local function government(p)
	return try(function()
		local g = p:GetCulture():GetCurrentGovernment()
		if g == nil or g < 0 then return "" end
		return L(GameInfo.Governments[g].Name)
	end, "")
end

local function capital(p)
	return try(function()
		local c = p:GetCities():GetCapitalCity()
		return c and L(c:GetName()) or ""
	end, "")
end

-- what kind of country, its standing and its wars: one block for the player (P) or another (C)
local function country_lines(kind, id, p, others)
	local function put(key, value)
		if value == nil or value == "" then return end
		if kind == "P" then add("P", key, value) else add("C", tag(id), key, value) end
	end
	put("tag", tag(id))
	put("name", civ_name(id))
	local minor = not try(function() return p:IsMajor() end, true)
	if minor then
		put("leader", civ_name(id))
		put("leader_title", "City-state")
		put("kind", "city-state")
	else
		put("leader", leader_name(id))
		put("leader_title", "Leader")
		put("government", government(p))
	end
	put("capital", capital(p))
	put("era", try(function() return L(GameInfo.Eras[p:GetEra()].Name) end, ""))
	put("cities", try(function() return p:GetCities():GetCount() end, nil))
	put("score", try(function() return p:GetScore() end, nil))
	if kind == "P" then
		put("gold", try(function() return math.floor(p:GetTreasury():GetGoldBalance()) end, nil))
		put("favor", try(function() return p:GetFavor() end, nil))
	end
	local religion = try(function()
		local r = p:GetReligion():GetReligionInMajorityOfCities()
		if r == nil or r < 0 then return "" end
		return L(GameInfo.Religions[r].Name)
	end, "")
	put("religion", religion)
	local diplo = try(function() return p:GetDiplomacy() end, nil)
	if diplo then
		for _, o in ipairs(others) do
			if o ~= id then
				if try(function() return diplo:IsAtWarWith(o) end, false) then put("war_with", civ_name(o)) end
				if try(function() return diplo:GetAllianceType(o) end, -1) ~= -1 then put("allies", civ_name(o)) end
			end
		end
	end
end

-- diplomatic state of `p` towards the local player as an opinion -100..100
local STATE_OPINION = {
	DIPLO_STATE_ALLIED = 90, DIPLO_STATE_DECLARED_FRIEND = 70, DIPLO_STATE_FRIENDLY = 40,
	DIPLO_STATE_NEUTRAL = 0, DIPLO_STATE_UNFRIENDLY = -40, DIPLO_STATE_DENOUNCED = -70, DIPLO_STATE_WAR = -100,
}

local function relation_lines(id, p, me, myDiplo)
	local t = tag(id)
	if try(function() return myDiplo:IsAtWarWith(id) end, false) then add("R", t, "war", "yes") end
	if try(function() return myDiplo:GetAllianceType(id) end, -1) ~= -1 then
		add("R", t, "ally", "yes")
		add("R", t, "alliance", try(function() return L(GameInfo.Alliances[myDiplo:GetAllianceType(id)].Name) end, ""))
	end
	local state = try(function()
		local idx = p:GetDiplomaticAI():GetDiplomaticStateIndex(me)
		return idx and idx >= 0 and GameInfo.DiplomaticStates[idx] or nil
	end, nil)
	if state then
		if STATE_OPINION[state.StateType] then add("R", t, "opinion", STATE_OPINION[state.StateType]) end
		add("R", t, "diplomatic_state", L(state.Name))
	end
	local grievances = try(function() return myDiplo:GetGrievancesAgainst(id) end, nil)
	if grievances and grievances ~= 0 then add("R", t, "grievances", grievances) end
	-- city-states: who holds sway over them
	local suzerain = try(function() return p:GetInfluence():GetSuzerain() end, -1)
	if suzerain and suzerain >= 0 then add("R", t, "suzerain", civ_name(suzerain)) end
end

-- the people of the local player's civilization: governors and great people
local function people_lines(me, p)
	local t = tag(me)
	local leader = leader_name(me)
	if leader ~= "" then
		add("CH", t, leader, "ruler", "yes")
		add("CH", t, leader, "title", "Leader of " .. civ_name(me))
	end
	pcall(function()
		local has, list = p:GetGovernors():GetGovernorList()
		if not has or not list then return end
		for _, g in ipairs(list) do
			local def = GameInfo.Governors[g:GetType()]
			if def then
				local name = L(def.Name)
				add("CH", t, name, "title", "Governor, " .. L(def.Title))
				add("CH", t, name, "desc", L(def.Description))
				local city = try(function() return g:GetAssignedCity() end, nil)
				if city then add("CH", t, name, "location", L(city:GetName())) end
			end
		end
	end)
	pcall(function()
		for _, u in p:GetUnits():Members() do
			local individual = try(function() return u:GetGreatPerson():GetIndividual() end, -1)
			if individual and individual >= 0 then
				local def = GameInfo.GreatPersonIndividuals[individual]
				if def then
					local name = L(def.Name)
					local class = try(function() return L(GameInfo.GreatPersonClasses[def.GreatPersonClassType].Name) end, "Great Person")
					add("CH", t, name, "title", class)
					local plot = try(function() return Map.GetPlot(u:GetX(), u:GetY()) end, nil)
					local city = plot and try(function() return Cities.GetPlotPurchaseCity(plot) end, nil)
					if city then add("CH", t, name, "location", L(city:GetName())) end
				end
			end
		end
	end)
end

local function build(reason)
	lines = {}
	local me = Game.GetLocalPlayer()
	if me == nil or me < 0 then return nil end
	local p = Players[me]
	local myDiplo = p:GetDiplomacy()
	add("BEGIN", "civ6", VERSION, reason or "snapshot")
	local turn = try(function() return Game.GetCurrentGameTurn() end, 0)
	add("META", "turn", turn)
	add("META", "date", try(function() return Calendar.MakeYearStr(turn) end, ""))
	add("META", "campaign", try(function() return tostring(GameConfiguration.GetValue("GAME_SYNC_RANDOM_SEED") or 0) end, "0"))
	pcall(function()
		local names = {}
		for _, m in ipairs(Modding.GetActiveMods() or {}) do
			if m.Name and #names < 30 then names[#names + 1] = L(m.Name) end
		end
		add("META", "mods", table.concat(names, ";"))
	end)

	-- everyone the player has met
	local others = {}
	local function consider(list)
		for _, o in ipairs(list or {}) do
			local id = o:GetID()
			if id ~= me and #others < MAX_OTHERS and try(function() return myDiplo:HasMet(id) end, false) then
				others[#others + 1] = id
			end
		end
	end
	consider(try(function() return PlayerManager.GetAliveMajors() end, {}))
	consider(try(function() return PlayerManager.GetAliveMinors() end, {}))
	local all = { me }
	for _, id in ipairs(others) do all[#all + 1] = id end

	country_lines("P", me, p, all)
	for _, id in ipairs(others) do
		local o = Players[id]
		country_lines("C", id, o, all)
		relation_lines(id, o, me, myDiplo)
		local leader = try(function() return o:IsMajor() end, false) and leader_name(id) or ""
		if leader ~= "" then
			add("CH", tag(id), leader, "ruler", "yes")
			add("CH", tag(id), leader, "title", "Leader of " .. civ_name(id))
		end
	end
	people_lines(me, p)
	add("END")
	return table.concat(lines, "\n")
end

-- FireTuner replies hold about 2 KB; split the text into pieces that never cut a UTF-8 character
local CHUNK_BYTES = 1200

local function split_utf8(text)
	local chunks, i = {}, 1
	while i <= #text do
		local j = math.min(#text, i + CHUNK_BYTES - 1)
		-- back off while the next byte continues a multi-byte character
		while j < #text and j > i and text:byte(j + 1) >= 0x80 and text:byte(j + 1) < 0xC0 do j = j - 1 end
		chunks[#chunks + 1] = text:sub(i, j)
		i = j + 1
	end
	return chunks
end

-- the app's entry points (FireTuner runs code in the InGame state, which shares ExposedMembers):
-- VOTC_Build(reason) -> number of chunks (-1 on error), VOTC_Chunk(n) -> chunk n (1-based)
ExposedMembers.VOTC_Build = function(reason)
	local ok, text = pcall(build, reason)
	if not ok then
		ExposedMembers.VOTC_LAST = "VOTC|ERROR|" .. clean(text)
		ExposedMembers.VOTC_CHUNKS = { ExposedMembers.VOTC_LAST }
		return -1
	end
	ExposedMembers.VOTC_LAST = text or ""
	ExposedMembers.VOTC_CHUNKS = split_utf8(ExposedMembers.VOTC_LAST)
	return #ExposedMembers.VOTC_CHUNKS
end

ExposedMembers.VOTC_Chunk = function(n)
	local chunks = ExposedMembers.VOTC_CHUNKS or {}
	return chunks[n] or ""
end

local function log_snapshot(reason)
	if ExposedMembers.VOTC_Build(reason) >= 0 then
		for line in ExposedMembers.VOTC_LAST:gmatch("[^\n]+") do print(line) end
	end
end

-- ---------------------------------------------------------------- "Talk (VOTC)" in diplomacy
-- The leader screen (DiplomacyActionView) is opened through these events with the other
-- player's id; the button sits inside that screen. A click is a request the app picks up
-- over FireTuner (VOTC_TalkSeq grows, VOTC_TalkPlayer names the leader); the app also reads
-- the screen's own selection, in case the player switched leaders inside it.
local shown_player = -1
local talk_seq = 0

local function track(id)
	if type(id) == "number" then shown_player = id end
end
for _, name in ipairs({ "DiplomacyRibbon_OpenDiplomacyActionView", "TopPanel_OpenDiplomacyActionView",
	"DiploPopup_TalkToLeader", "CityBannerManager_TalkToLeader", "DiplomacyActionView_OpenLite" }) do
	pcall(function() LuaEvents[name].Add(track) end)
end

local function on_talk()
	talk_seq = talk_seq + 1
	ExposedMembers.VOTC_TalkPlayer = shown_player
	ExposedMembers.VOTC_TalkSeq = talk_seq
	print("VOTC|TALK|" .. tostring(shown_player))
	pcall(function() UI.PlaySound("Play_UI_Click") end)
end

local function attach_button()
	local lang = try(function() return Locale.GetCurrentLanguage().Type end, "en_US")
	Controls.VOTCTalkLabel:SetText(lang:find("^zh") and "交谈（VOTC）" or "Talk (VOTC)")
	Controls.VOTCTalkButton:SetToolTipString(lang:find("^zh") and "在 VOTC 程序里与这位领袖对话" or "Talk with this leader in the VOTC app")
	Controls.VOTCTalkButton:RegisterCallback(Mouse.eLClick, on_talk)
	local screen = ContextPtr:LookUpControl("/InGame/DiplomacyActionView")
	if screen ~= nil then
		Controls.VOTCTalkButton:ChangeParent(screen)
		Controls.VOTCTalkButton:SetHide(false)
	end
end

ExposedMembers.VOTC_TalkSeq = 0
ExposedMembers.VOTC_TalkPlayer = -1

Events.LoadScreenClose.Add(function() pcall(attach_button) end)
Events.LoadScreenClose.Add(function() pcall(log_snapshot, "load") end)
Events.LocalPlayerTurnBegin.Add(function() pcall(log_snapshot, "turn") end)
