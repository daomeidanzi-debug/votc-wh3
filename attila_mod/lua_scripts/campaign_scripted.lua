
print("campaign_scripted.lua loaded");

system.ClearRequiredFiles();

-- Set up the "include" paths
package.path = ";?.lua;data/ui/templates/?.lua;data/ui/?.lua"

require "data.lua_scripts.all_scripted"
require "data.lua_scripts.export_advice"

events = get_events();

-- VOTC Bridge (GPL-3.0): everything above is the game's own file, unchanged.
-- Loads the VOTC campaign bridge; a missing or broken bridge never stops the campaign.
local votc_ok, votc_err = pcall(require, "data.lua_scripts.votc_attila");
if not votc_ok then print("VOTC bridge failed to load: " .. tostring(votc_err)); end;
