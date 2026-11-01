import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Chat from './chat/Chat';
import ConfigPanel from './config/ConfigPanel';
import PromptLocaleNotification from './config/components/PromptLocaleNotification';
import { useConfigStore, useAppSettings } from './config/store/useConfigStore';
import type { InitializationWarning, TalkTargetInfo } from '../preload/global.d';
import TalkPicker from './TalkPicker';
import AlertIcon from './assets/Alert.png';

function App() {
  const { t } = useTranslation();
  const [showChat, setShowChat] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [initializationWarnings, setInitializationWarnings] = useState<InitializationWarning[]>([]);
  // Paradox games: partner picker and the "actions waiting" notice
  const [talkTargets, setTalkTargets] = useState<TalkTargetInfo[] | null>(null);
  const [pendingCommands, setPendingCommands] = useState<{ count: number; runCommand: string; auto?: boolean } | null>(null);
  const loadSettings = useConfigStore((state) => state.loadSettings);
  const appSettings = useAppSettings();

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const fontSize = appSettings?.messageFontSize ?? 1.1;
    document.documentElement.style.setProperty('--message-font-size', `${fontSize}rem`);
  }, [appSettings?.messageFontSize]);

  useEffect(() => {
    // Show settings panel on frontend initialization if the setting is enabled
    // Only run this once when appSettings are first loaded
    if (appSettings && appSettings.showSettingsOnStartup !== false && !showConfig) {
      setShowConfig(true);
    }
  }, [appSettings]); // Only depend on appSettings, not showConfig

  useEffect(() => {
    // Listen for VOTC:IN event to show chat
    const cleanupChatEvent = window.electronAPI.onChatReset(() => {
      console.log('Chat reset - showing chat interface');
      setShowChat(true);
      // When showing chat, reset mouse events to be ignored initially
      // They will be unignored when mouse enters the chat panel
      window.electronAPI?.setIgnoreMouseEvents(true);
    });

    return () => {
      cleanupChatEvent();
    };
  }, []);

  useEffect(() => {
    // Listen for toggle settings event from tray
    const cleanupToggleSettings = window.electronAPI.onToggleSettings(() => {
      console.log('Toggle settings event received');
      setShowConfig(prev => {
        const newState = !prev;
        // When closing the config panel, reset mouse events to be ignored
        if (!newState) {
          window.electronAPI?.setIgnoreMouseEvents(true);
        }
        return newState;
      });
    });

    return () => {
      cleanupToggleSettings();
    };
  }, []);

  useEffect(() => {
    // Listen for hide chat event (triggered by End Conversation)
    const cleanupHideChat = window.electronAPI.onHideChat(() => {
      console.log('Hide chat event received - hiding both chat and config');
      setShowChat(false);
      setShowConfig(false);
      // Reset mouse events when hiding panels
      window.electronAPI?.setIgnoreMouseEvents(true);
    });

    return () => {
      cleanupHideChat();
    };
  }, []);

    useEffect(() => {
    const cleanup = window.electronAPI?.onOverlayVisibilityChange((isVisible: boolean) => {
      console.log('Overlay visibility changed:', isVisible);
      setIsOverlayVisible(isVisible);
      
      // Safety: If hidden, force "ignore mouse" to ensure click-through
      // (The display:none below stops mouse events, but this is a good backup)
      if (!isVisible) {
        window.electronAPI?.setIgnoreMouseEvents(true);
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    // Fetch any cached warnings on mount
    const fetchWarnings = async () => {
      try {
        const warnings = await window.electronAPI?.getInitializationWarnings();
        if (warnings && warnings.length > 0) {
          console.log('Fetched cached initialization warnings:', warnings);
          setInitializationWarnings(warnings);
        }
      } catch (error) {
        console.error('Failed to fetch initialization warnings:', error);
      }
    };
    fetchWarnings();

    // Listen for initialization warnings from main process
    const cleanup = window.electronAPI?.onInitializationWarnings((warnings: InitializationWarning[]) => {
      console.log('Received initialization warnings:', warnings);
      setInitializationWarnings(warnings);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const cleanupPick = window.gameAPI?.onTalkPick((targets) => setTalkTargets(targets));
    const cleanupPending = window.gameAPI?.onCommandsPending((info) => {
      setPendingCommands(info.count > 0 ? info : null);
      if (info.count > 0 && info.runCommand && !info.auto) {
        // ready to paste into the game console
        navigator.clipboard?.writeText(info.runCommand).catch(() => { /* clipboard may be unavailable */ });
      }
    });
    return () => {
      cleanupPick?.();
      cleanupPending?.();
    };
  }, []);

  const dismissWarnings = useCallback(() => {
    setInitializationWarnings([]);
  }, []);

  const toggleConfig = useCallback(() => {
    setShowConfig(prev => {
      const newState = !prev;
      // When closing the config panel, only reset mouse events if chat is also hidden
      if (!newState && !showChat) {
        window.electronAPI?.setIgnoreMouseEvents(true);
      }
      return newState;
    });
  }, [showChat]);

  return (
    <div className="App" style={{ display: isOverlayVisible ? 'block' : 'none' }}>
      {/* Initialization Warnings Modal */}
      {initializationWarnings.length > 0 && (
        <div
          className="initialization-warnings-overlay"
          onMouseEnter={() => window.electronAPI?.setIgnoreMouseEvents(false)}
          onMouseLeave={() => window.electronAPI?.setIgnoreMouseEvents(true)}
        >
          <div className="initialization-warnings-modal">
            <h2>Initialization Warnings</h2>
            <div className="initialization-warnings-list">
              {initializationWarnings.map((warning, index) => (
                <div key={index} className="initialization-warning-item">
                  <div className="initialization-warning-header">
                    <span className="initialization-warning-icon"><img src={AlertIcon} alt="Warning" /></span>
                    <strong className="initialization-warning-title">{warning.message}</strong>
                  </div>
                  {warning.suggestion && (
                    <p className="initialization-warning-suggestion">{warning.suggestion}</p>
                  )}
                </div>
              ))}
            </div>
            <button className="initialization-warnings-dismiss" onClick={dismissWarnings}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {talkTargets && (
        <TalkPicker
          targets={talkTargets}
          onPick={(target) => {
            setTalkTargets(null);
            window.gameAPI.startTalk(target.id);
          }}
          onClose={() => {
            setTalkTargets(null);
            window.electronAPI?.setIgnoreMouseEvents(true);
          }}
        />
      )}
      {pendingCommands && (
        <div
          className="game-commands-pending"
          onMouseEnter={() => window.electronAPI?.setIgnoreMouseEvents(false)}
          onMouseLeave={() => window.electronAPI?.setIgnoreMouseEvents(true)}
          onClick={() => setPendingCommands(null)}
        >
          {pendingCommands.auto
            ? t('commandsPending.auto', { count: pendingCommands.count, defaultValue: '{{count}} agreed action(s) will be applied as soon as you are back in the game.' })
            : t('commandsPending.manual', { count: pendingCommands.count, command: pendingCommands.runCommand, defaultValue: '{{count}} action(s) waiting: open the game console and enter {{command}} (copied to the clipboard).' })}
        </div>
      )}
      {showChat && <Chat onToggleConfig={toggleConfig} />}
      {/* Global notification for prompt-locale auto-switches (startup / language change) */}
      <PromptLocaleNotification />
      {showConfig && (
        <ConfigPanel
          onClose={() => {
            setShowConfig(false);
            window.electronAPI?.setIgnoreMouseEvents(true);
          }}
        />
      )}
    </div>
  );
};

export default App;
