import { EventEmitter } from 'events';
import { settingsRepository } from '../SettingsRepository';
import { activeGame } from '../games';
import { testWritable } from '../games/steam';
import type { FolderDetection, GameSetupWarning } from '../games/types';

export type InitializationWarning = GameSetupWarning;

export interface InitializationResult {
  success: boolean;
  /** folder of the active game (kept under the historical name used by the settings store) */
  ck3Path: string | null;
  warnings: InitializationWarning[];
  detectionResult?: FolderDetection;
}

class InitializationService extends EventEmitter {
  private initialized: boolean = false;
  private currentWarnings: InitializationWarning[] = [];

  /**
   * Run full initialization for the active game: detect its folder, check the mod and write access.
   */
  async initialize(): Promise<InitializationResult> {
    const game = activeGame();
    console.log(`InitializationService: Starting initialization for ${game.id}...`);
    const warnings: InitializationWarning[] = [];

    const existingPath = settingsRepository.getCK3UserFolderPath();
    const detectionResult = game.detectFolder(existingPath);

    if (!detectionResult.path) {
      warnings.push({
        type: 'path_not_found',
        message: detectionResult.error || `${game.name.en} folder not found`,
        suggestion: `Open settings and select the ${game.name.en} folder, e.g. ${game.folderExample}`,
      });
      this.currentWarnings = warnings;
      this.emit('initialization-complete', { success: false, ck3Path: null, warnings, detectionResult });
      return { success: false, ck3Path: null, warnings, detectionResult };
    }

    const gamePath = detectionResult.path;
    if (gamePath !== existingPath) {
      console.log(`InitializationService: Using detected ${game.id} path: ${gamePath} (${detectionResult.source})`);
      settingsRepository.setCK3UserFolderPath(gamePath);
    }

    warnings.push(...game.checkSetup(gamePath));

    this.currentWarnings = warnings;
    this.initialized = true;
    this.emit('initialization-complete', { success: true, ck3Path: gamePath, warnings, detectionResult });

    console.log(`InitializationService: Initialization complete. Path: ${gamePath}, Warnings: ${warnings.length}`);
    return { success: true, ck3Path: gamePath, warnings, detectionResult };
  }

  /**
   * Check the configured folder before each conversation.
   * success=false means a conversation cannot work at all.
   */
  async ensureRequiredFiles(): Promise<{ success: boolean; warnings: InitializationWarning[] }> {
    const game = activeGame();
    const gamePath = settingsRepository.getCK3UserFolderPath();

    if (!gamePath || !game.isValidFolder(gamePath)) {
      return {
        success: false,
        warnings: [{
          type: 'path_not_found',
          message: gamePath
            ? `The configured folder is not a ${game.name.en} folder: ${gamePath}`
            : `${game.name.en} folder is not configured`,
          suggestion: `Open settings (Ctrl+Shift+H) and select the ${game.name.en} folder, e.g. ${game.folderExample}`,
        }],
      };
    }

    // A missing mod shows up later with its own explanation, so only problems that stop
    // the bridge files from being written are reported here.
    const err = testWritable(gamePath);
    if (err) {
      return {
        success: false,
        warnings: [{
          type: 'permission',
          message: `Cannot write to ${gamePath}: ${err}`,
          suggestion: 'VOTC exchanges data with the game through files in this folder. Run VOTC as Administrator, or move the game to a folder your user can write to.',
        }],
      };
    }
    return { success: true, warnings: [] };
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
