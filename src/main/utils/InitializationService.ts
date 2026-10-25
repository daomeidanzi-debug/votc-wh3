import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { settingsRepository } from '../SettingsRepository';
import { Wh3PathDetector, Wh3DetectionResult, isWh3GameDir } from '../wh3/Wh3PathDetector';
import { WH3_EXE_NAME, WH3_MOD_PACK_NAME } from '../wh3/types';

export interface InitializationWarning {
  type: 'permission' | 'path_not_found' | 'path_detection' | 'mod_missing';
  message: string;
  suggestion?: string;
}

export interface InitializationResult {
  success: boolean;
  /** Warhammer III install folder (kept under the historical name used by the settings store) */
  ck3Path: string | null;
  warnings: InitializationWarning[];
  detectionResult?: Wh3DetectionResult;
}

const PERMISSION_TEST_FILE = 'votc_permission_test.tmp';
const WH3_STEAM_APP_ID = '1142710';

class InitializationService extends EventEmitter {
  private initialized: boolean = false;
  private currentWarnings: InitializationWarning[] = [];

  /**
   * Run full initialization: detect the Warhammer III folder, check the mod pack and write access.
   */
  async initialize(): Promise<InitializationResult> {
    console.log('InitializationService: Starting initialization...');
    const warnings: InitializationWarning[] = [];

    const existingPath = settingsRepository.getCK3UserFolderPath();
    const detectionResult = Wh3PathDetector.detect(existingPath);

    if (!detectionResult.path) {
      warnings.push({
        type: 'path_not_found',
        message: detectionResult.error || 'Warhammer III folder not found',
        suggestion: 'Open settings and select the Total War: WARHAMMER III install folder (the one that contains Warhammer3.exe).'
      });
      this.currentWarnings = warnings;
      this.emit('initialization-complete', { success: false, ck3Path: null, warnings, detectionResult });
      return { success: false, ck3Path: null, warnings, detectionResult };
    }

    const gamePath = detectionResult.path;
    if (gamePath !== existingPath) {
      console.log(`InitializationService: Using detected Warhammer III path: ${gamePath} (${detectionResult.source})`);
      settingsRepository.setCK3UserFolderPath(gamePath);
    }

    warnings.push(...this.checkModInstalled(gamePath));
    warnings.push(...this.testWritePermissions(gamePath));

    this.currentWarnings = warnings;
    this.initialized = true;
    this.emit('initialization-complete', { success: true, ck3Path: gamePath, warnings, detectionResult });

    console.log(`InitializationService: Initialization complete. Path: ${gamePath}, Warnings: ${warnings.length}`);
    return { success: true, ck3Path: gamePath, warnings, detectionResult };
  }

  /** The pack is either in the game's data folder or in a Steam Workshop item folder. */
  private isModInstalled(gamePath: string): boolean {
    if (fs.existsSync(path.join(gamePath, 'data', WH3_MOD_PACK_NAME))) {
      return true;
    }
    // <library>/steamapps/common/<game>  ->  <library>/steamapps/workshop/content/1142710/<item>/
    const workshop = path.join(gamePath, '..', '..', 'workshop', 'content', WH3_STEAM_APP_ID);
    try {
      if (!fs.existsSync(workshop)) return false;
      for (const item of fs.readdirSync(workshop)) {
        if (fs.existsSync(path.join(workshop, item, WH3_MOD_PACK_NAME))) {
          return true;
        }
      }
    } catch (error) {
      console.warn('InitializationService: could not scan workshop folder:', error);
    }
    return false;
  }

  private checkModInstalled(gamePath: string): InitializationWarning[] {
    if (this.isModInstalled(gamePath)) {
      return [];
    }
    return [{
      type: 'mod_missing',
      message: `${WH3_MOD_PACK_NAME} was not found in ${path.join(gamePath, 'data')}`,
      suggestion: `Copy ${WH3_MOD_PACK_NAME} into the game's data folder and enable it in the Warhammer III launcher's mod manager. (Ignore this if you installed it from the Steam Workshop.)`
    }];
  }

  /**
   * The bridge files live in the game folder, so the app needs write access there.
   */
  testWritePermissions(gamePath: string): InitializationWarning[] {
    const testFilePath = path.join(gamePath, PERMISSION_TEST_FILE);
    try {
      fs.writeFileSync(testFilePath, 'test', 'utf-8');
      fs.readFileSync(testFilePath, 'utf-8');
      fs.unlinkSync(testFilePath);
      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [{
        type: this.isPermissionError(error) ? 'permission' : 'path_not_found',
        message: `Cannot write to the Warhammer III folder: ${message}`,
        suggestion: 'VOTC exchanges data with the game through files in the game folder. Run VOTC as Administrator, or move the game to a folder your user can write to.'
      }];
    }
  }

  private isPermissionError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      const code = (error as NodeJS.ErrnoException).code;
      return (
        message.includes('permission') ||
        message.includes('access is denied') ||
        code === 'EPERM' ||
        code === 'EACCES'
      );
    }
    return false;
  }

  /**
   * Check the configured folder before each conversation.
   * success=false means a conversation cannot work at all.
   */
  async ensureRequiredFiles(): Promise<{ success: boolean; warnings: InitializationWarning[] }> {
    const gamePath = settingsRepository.getCK3UserFolderPath();

    if (!gamePath || !isWh3GameDir(gamePath)) {
      return {
        success: false,
        warnings: [{
          type: 'path_not_found',
          message: gamePath
            ? `The configured folder does not contain ${WH3_EXE_NAME}: ${gamePath}`
            : 'Warhammer III folder is not configured',
          suggestion: 'Open settings (Ctrl+Shift+H) and select the Total War: WARHAMMER III install folder (the one that contains Warhammer3.exe).'
        }]
      };
    }

    // A missing mod shows up as an export timeout with its own explanation, so only
    // problems that stop the bridge files from being written are reported here.
    const warnings = this.testWritePermissions(gamePath);
    return { success: warnings.length === 0, warnings };
  }

  getWarnings(): InitializationWarning[] {
    return [...this.currentWarnings];
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  clearWarnings(): void {
    this.currentWarnings = [];
  }
}

export const initializationService = new InitializationService();
