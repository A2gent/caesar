import { useEffect, useRef, useState } from 'react';
import AgentUrlComboField from './AgentUrlComboField';
import SettingsPanel from './SettingsPanel';
import {
  addApiBaseUrlToHistory,
  getApiBaseUrl,
  getApiBaseUrlHistory,
  removeApiBaseUrlFromHistory,
  getSettingsPayload,
  saveAgentName,
  setApiBaseUrl,
  updateSettings,
} from './api';
import { getAgentEmoji, setAgentEmoji } from './agentVisuals';

interface SettingsViewProps {
  onAgentNameRefresh?: () => void | Promise<void>;
  onBackendChanged?: () => void | Promise<void>;
  themeMode: 'dark' | 'light';
  onThemeChange: (nextTheme: 'dark' | 'light') => void;
}

const AGENT_NAME_SETTING_KEY = 'AAGENT_NAME';
const MAIN_AGENT_EMOJI_OPTIONS = [
  '🤖', '🧠', '✨', '🚀', '⚡', '🛠️', '🔍', '💡', '🧩', '📚', '🗂️', '🧭', '🛰️', '🦾', '🎯', '🦉',
  '🦊', '🐺', '🐼', '🦁', '🐯', '🐙', '🐢', '🐬', '🦄', '🐝', '🦜', '🐘', '🧬', '🧪', '🔬', '🧱',
  '🧰', '🔧', '⚙️', '🧲', '📡', '🧮', '📈', '📊', '🗺️', '🗃️', '🪄', '🪐', '🌌', '🔥', '🌟', '🌈',
  '☀️', '🌙', '🌊', '🌿', '🍀', '🏆', '🎵', '🎨', '🎮', '📎', '✅', '❇️', '🫡', '💻', '🖥️', '⌨️',
  '🖱️', '📱', '🔒', '🧷', '📌', '📁', '🧾', '📝', '🧑‍💻', '🫶', '💬', '📬', '🚢', '🛡️', '📍', '🪙',
];

function SettingsView({ onAgentNameRefresh, onBackendChanged, themeMode, onThemeChange }: SettingsViewProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [defaultSystemPromptWithoutBuiltInTools, setDefaultSystemPromptWithoutBuiltInTools] = useState('');
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(() => getApiBaseUrl());
  const [apiBaseUrlHistory, setApiBaseUrlHistory] = useState<string[]>(() => getApiBaseUrlHistory());
  const [apiBaseUrlMessage, setApiBaseUrlMessage] = useState<string | null>(null);
  const [saveRequestKey, setSaveRequestKey] = useState(0);
  const [mainAgentEmoji, setMainAgentEmoji] = useState(() => getAgentEmoji('main'));
  const [customEmojiInput, setCustomEmojiInput] = useState('');
  const [isEmojiDropdownOpen, setIsEmojiDropdownOpen] = useState(false);
  const emojiDropdownRef = useRef<HTMLDivElement | null>(null);
  const [mainAgentName, setMainAgentName] = useState('');
  const [isSavingAgentName, setIsSavingAgentName] = useState(false);
  const [agentNameMessage, setAgentNameMessage] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const payload = await getSettingsPayload();
      setSettings(payload.settings || {});
      setMainAgentName((payload.settings || {})[AGENT_NAME_SETTING_KEY] || '');
      setDefaultSystemPrompt((payload.defaultSystemPrompt || '').trim());
      setDefaultSystemPromptWithoutBuiltInTools((payload.defaultSystemPromptWithoutBuiltInTools || '').trim());
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (emojiDropdownRef.current && !emojiDropdownRef.current.contains(event.target as Node)) {
        setIsEmojiDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const handleSaveApiBaseUrl = async () => {
    try {
      setApiBaseUrl(apiBaseUrlInput);
      const normalized = getApiBaseUrl();
      addApiBaseUrlToHistory(normalized);
      setApiBaseUrlInput(normalized);
      setApiBaseUrlHistory(getApiBaseUrlHistory());
      setApiBaseUrlMessage(`Connected to agent at: ${normalized}`);
      await loadSettings();
      if (onBackendChanged) {
        await onBackendChanged();
      }
    } catch (err) {
      console.error('Failed to update API base URL:', err);
      setApiBaseUrlMessage('Failed to update backend URL');
    }
  };

  const handleResetApiBaseUrl = async () => {
    setApiBaseUrl('');
    const normalized = getApiBaseUrl();
    setApiBaseUrlInput(normalized);
    setApiBaseUrlMessage(`Reset to default: ${normalized}`);
    await loadSettings();
    if (onBackendChanged) {
      await onBackendChanged();
    }
  };

  const handleRemoveUrlFromHistory = (url: string) => {
    removeApiBaseUrlFromHistory(url);
    setApiBaseUrlHistory(getApiBaseUrlHistory());
  };

  const handleSaveSettings = async (nextSettings: Record<string, string>) => {
    setIsSaving(true);
    setError(null);
    try {
      const saved = await updateSettings(nextSettings);
      setSettings(saved);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAgentName = async () => {
    setIsSavingAgentName(true);
    setAgentNameMessage(null);
    try {
      await saveAgentName(mainAgentName);
      setAgentNameMessage('Agent name saved.');
      if (onAgentNameRefresh) {
        await onAgentNameRefresh();
      }
    } catch (err) {
      console.error('Failed to save agent name:', err);
      setAgentNameMessage('Failed to save agent name.');
    } finally {
      setIsSavingAgentName(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Settings</h1>
        <button
          type="button"
          className="settings-save-btn"
          onClick={() => setSaveRequestKey((prev) => prev + 1)}
          disabled={isLoading || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save settings'}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content page-content-narrow settings-sections">
        <div className="settings-panel">
          <h2>Appearance</h2>
          <p className="settings-help">
            Choose how the interface is rendered in this browser.
          </p>
          <div className="settings-field settings-field-inline settings-theme-toggle-row">
            <span>Light mode</span>
            <button
              type="button"
              className={`ios-switch ${themeMode === 'light' ? 'on' : ''}`}
              role="switch"
              aria-checked={themeMode === 'light'}
              aria-label={themeMode === 'light' ? 'Disable light mode' : 'Enable light mode'}
              title={themeMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              onClick={() => onThemeChange(themeMode === 'light' ? 'dark' : 'light')}
            >
              <span className="ios-switch-thumb" aria-hidden="true" />
            </button>
          </div>
          <label className="settings-field" style={{ marginTop: 12 }}>
            <span>Main agent name</span>
            <div className="settings-agent-name-row">
              <input
                type="text"
                value={mainAgentName}
                onChange={(event) => setMainAgentName(event.target.value)}
                placeholder="A2"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleSaveAgentName();
                  }
                }}
              />
              <button
                type="button"
                className="settings-save-btn"
                onClick={() => void handleSaveAgentName()}
                disabled={isSavingAgentName}
              >
                {isSavingAgentName ? 'Saving...' : 'Save name'}
              </button>
            </div>
          </label>
          {agentNameMessage ? <div className="settings-success">{agentNameMessage}</div> : null}

          <label className="settings-field" style={{ marginTop: 12 }}>
            <span>Main agent emoji</span>
            <div className="settings-emoji-picker-row">
              <div className="settings-emoji-dropdown" ref={emojiDropdownRef}>
                <button
                  type="button"
                  className="settings-emoji-dropdown-trigger"
                  onClick={() => setIsEmojiDropdownOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={isEmojiDropdownOpen}
                  aria-label="Open emoji selector"
                >
                  <span className="settings-emoji-current">{mainAgentEmoji}</span>
                  <span>Choose emoji</span>
                  <span aria-hidden="true">▾</span>
                </button>
                {isEmojiDropdownOpen ? (
                  <div className="settings-emoji-dropdown-panel" role="listbox" aria-label="Choose main agent emoji">
                    {MAIN_AGENT_EMOJI_OPTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className={`settings-emoji-option ${mainAgentEmoji === emoji ? 'active' : ''}`}
                        onClick={() => {
                          setMainAgentEmoji(emoji);
                          setAgentEmoji('main', emoji);
                          setCustomEmojiInput('');
                          setIsEmojiDropdownOpen(false);
                        }}
                        aria-label={`Set emoji to ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <input
                type="text"
                className="settings-emoji-custom-input"
                value={customEmojiInput}
                onChange={(event) => {
                  const next = event.target.value;
                  setCustomEmojiInput(next);
                  if (!next.trim()) {
                    return;
                  }
                  setMainAgentEmoji(next);
                  setAgentEmoji('main', next);
                  setIsEmojiDropdownOpen(false);
                }}
                placeholder={MAIN_AGENT_EMOJI_OPTIONS.includes(mainAgentEmoji) ? 'Type your own' : mainAgentEmoji}
                aria-label="Custom emoji input"
                maxLength={8}
              />
            </div>
          </label>
        </div>

        <div className="settings-panel">
          <h2>Agent Connection</h2>
          <p className="settings-help">
            Connect this web app to an agent backend running on any machine. Switch between URLs to manage multiple agents — each one can run independently on a different server or device. The URL is stored in this browser only (local storage).
          </p>
          <div className="settings-field">
            <span>Agent backend URL</span>
            <AgentUrlComboField
              value={apiBaseUrlInput}
              history={apiBaseUrlHistory}
              onChange={setApiBaseUrlInput}
              onRemoveFromHistory={handleRemoveUrlFromHistory}
            />
          </div>
          <div className="settings-actions">
            <button type="button" onClick={handleSaveApiBaseUrl} className="settings-save-btn">
              Save URL
            </button>
            <button type="button" onClick={handleResetApiBaseUrl} className="settings-add-btn">
              Reset to default
            </button>
          </div>
          {apiBaseUrlMessage && <div className="settings-success">{apiBaseUrlMessage}</div>}
        </div>

        {isLoading ? (
          <div className="sessions-loading">Loading settings...</div>
        ) : (
          <SettingsPanel
            settings={settings}
            isSaving={isSaving}
            onSave={handleSaveSettings}
            saveRequestKey={saveRequestKey}
            defaultSystemPrompt={defaultSystemPrompt}
            defaultSystemPromptWithoutBuiltInTools={defaultSystemPromptWithoutBuiltInTools}
          />
        )}
      </div>
    </div>
  );
}

export default SettingsView;
