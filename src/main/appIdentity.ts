/**
 * The app's name, and the move of the user's data from the name it had before.
 * Imported first in main.ts: the data folder must be in place before any module reads it.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export const APP_TITLE = 'VOTC Multi';

/** Folder names under %APPDATA% this app used before (newest first): the WH3 port, the original VOTC. */
const PREVIOUS_NAMES = ['VOTC-WH3', 'VOTC'];
/** electron-store file of SettingsRepository */
const SETTINGS_FILE = 'votc-llm-config.json';
/** Chromium caches: rebuilt on their own, not worth copying. */
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'blob_storage', 'Shared Dictionary', 'logs']);

function migrateUserData(): void {
  try {
    const current = app.getPath('userData');
    // a settings file means this folder is in use already
    if (fs.existsSync(path.join(current, SETTINGS_FILE))) return;
    const appData = app.getPath('appData');
    for (const name of PREVIOUS_NAMES) {
      const old = path.join(appData, name);
      if (old === current || !fs.existsSync(path.join(old, SETTINGS_FILE))) continue;
      fs.mkdirSync(current, { recursive: true });
      for (const entry of fs.readdirSync(old)) {
        if (SKIP.has(entry)) continue;
        fs.cpSync(path.join(old, entry), path.join(current, entry), { recursive: true, force: false, errorOnExist: false });
      }
      console.log(`appIdentity: copied settings and conversations from ${old} to ${current}`);
      return;
    }
  } catch (error) {
    console.error('appIdentity: could not move the previous user data:', error);
  }
}

migrateUserData();
