import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TalkTargetInfo } from '../preload/global.d';

interface TalkPickerProps {
  targets: TalkTargetInfo[];
  onPick: (target: TalkTargetInfo) => void;
  onClose: () => void;
}

const GROUPS: Array<{ key: NonNullable<TalkTargetInfo['group']>; label: string; fallback: string }> = [
  { key: 'own', label: 'talkPicker.groupOwn', fallback: 'Your people' },
  { key: 'leaders', label: 'talkPicker.groupLeaders', fallback: 'Heads of state' },
  { key: 'people', label: 'talkPicker.groupPeople', fallback: 'Other characters' },
];

/**
 * Paradox games (HOI4, Victoria 3, EU5, Stellaris): pick who to talk to - the leader of a
 * country or any character the game reported. The list comes from the game's log.
 */
const TalkPicker: React.FC<TalkPickerProps> = ({ targets, onPick, onClose }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const shown = f
      ? targets.filter((x) => `${x.name} ${x.leader} ${x.leaderTitle} ${x.id}`.toLowerCase().includes(f))
      : targets;
    return GROUPS
      .map((g) => ({ ...g, items: shown.filter((x) => (x.group ?? 'leaders') === g.key) }))
      .filter((g) => g.items.length > 0);
  }, [targets, filter]);

  return (
    <div
      className="initialization-warnings-overlay talk-picker-overlay"
      onMouseEnter={() => window.electronAPI?.setIgnoreMouseEvents(false)}
      onMouseLeave={() => window.electronAPI?.setIgnoreMouseEvents(true)}
    >
      <div className="initialization-warnings-modal talk-picker">
        <h2>{t('talkPicker.title', 'Who do you want to talk to?')}</h2>
        {targets.length === 0 ? (
          <p className="initialization-warning-suggestion">
            {t('talkPicker.empty', 'No data from the game yet. Enable the VOTC mod, load a save and let one in-game month pass (or use Talk in the game), then try again.')}
          </p>
        ) : (
          <>
            <input
              className="talk-picker-filter"
              autoFocus
              placeholder={t('talkPicker.filter', 'Search name, title or country')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="talk-picker-list">
              {groups.map((g) => (
                <React.Fragment key={g.key}>
                  {groups.length > 1 && <div className="talk-picker-group">{t(g.label, g.fallback)}</div>}
                  {g.items.map((target) => (
                    <button key={target.id} className="talk-picker-item" onClick={() => onPick(target)}>
                      {g.key === 'leaders' ? (
                        <>
                          <span className="talk-picker-name">{target.name}</span>
                          <span className="talk-picker-leader">
                            {target.leader}{target.leaderTitle ? ` · ${target.leaderTitle}` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="talk-picker-name">{target.leader}</span>
                          <span className="talk-picker-leader">
                            {target.leaderTitle ? `${target.leaderTitle} · ` : ''}{target.name}
                          </span>
                        </>
                      )}
                      {target.status && <span className="talk-picker-status">{target.status}</span>}
                    </button>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </>
        )}
        <button className="initialization-warnings-dismiss" onClick={onClose}>
          {t('talkPicker.cancel', 'Cancel')}
        </button>
      </div>
    </div>
  );
};

export default TalkPicker;
