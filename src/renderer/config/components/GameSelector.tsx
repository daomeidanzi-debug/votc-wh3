import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfigStore, useAppSettings } from '../store/useConfigStore';
import Tooltip from './Tooltip';
import type { GameInfo } from '../../../preload/global.d';

/**
 * Picks the game the app talks to and its folder. Every game keeps its own folder, so
 * switching back and forth never loses a setting.
 */
const GameSelector: React.FC = () => {
  const { t } = useTranslation();
  const appSettings = useAppSettings();
  const loadSettings = useConfigStore((state) => state.loadSettings);
  const loadPromptSettings = useConfigStore((state) => state.loadPromptSettings);
  const selectCK3Folder = useConfigStore((state) => state.selectCK3Folder);
  const [games, setGames] = useState<GameInfo[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    window.gameAPI?.listGames().then(setGames).catch((error) => console.error('Failed to list games:', error));
  }, [appSettings?.language]);

  const activeId = appSettings?.activeGame ?? 'ck3';
  const active = games.find((g) => g.id === activeId);
  const folder = appSettings?.ck3UserFolderPath;
  const hasSelectedPath = !!folder && folder.trim() !== '';

  const onChangeGame = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSwitching(true);
    try {
      await window.gameAPI.setActiveGame(e.target.value);
      await loadSettings();
      // each game has its own prompts: show the new game's
      await loadPromptSettings();
    } catch (error) {
      console.error('Failed to switch game:', error);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="form-group ck3-folder-section game-selector">
      <label htmlFor="game-select">{t('settings.gameTitle', 'Game')}</label>
      <select id="game-select" value={activeId} onChange={onChangeGame} disabled={switching}>
        {games.map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
      {active && <p className="game-talk-hint">{active.talkHint}</p>}

      <label>
        {hasSelectedPath ? t('settings.selectedCK3FolderTitle') : t('settings.selectCK3UserFolderTitle')}
        <Tooltip
          text={active?.folderKind === 'install'
            ? t('settings.gameFolderInstallHelp', 'The game install folder (the one with the game .exe). The bridge files are written there.')
            : t('settings.gameFolderDocumentsHelp', 'The game folder in Documents\\Paradox Interactive (with logs, mod and save games).')}
          position="bottom"
        />
      </label>
      <div className={`ck3-path-display ${hasSelectedPath ? 'selected' : ''}`} onClick={() => selectCK3Folder()}>
        {hasSelectedPath ? (
          <span className="selected-path">{folder}</span>
        ) : (
          <span className="example-path-text">
            <span className="example-highlight">{t('settings.egline')}</span> {active?.folderExample ?? ''}{' '}
            <span className="example-highlight" style={{ fontStyle: 'italic' }}>({t('settings.ck3UserFolderClickToSelect')})</span>
          </span>
        )}
      </div>
    </div>
  );
};

export default GameSelector;
