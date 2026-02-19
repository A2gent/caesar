import { useEffect, useState } from 'react';
import AgentUrlComboField from './AgentUrlComboField';
import SettingsPanel from './SettingsPanel';
import {
  addApiBaseUrlToHistory,
  getApiBaseUrl,
  getApiBaseUrlHistory,
  removeApiBaseUrlFromHistory,
  getSettingsPayload,
  setApiBaseUrl,
  updateSettings,
} from './api';

interface SettingsViewProps {
  onAgentNameRefresh?: () => void | Promise<void>;
}

function SettingsView({ onAgentNameRefresh }: SettingsViewProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [defaultSystemPromptWithoutBuiltInTools, setDefaultSystemPromptWithoutBuiltInTools] = useState('');
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(() => getApiBaseUrl());
  const [apiBaseUrlHistory, setApiBaseUrlHistory] = useState<string[]>(() => getApiBaseUrlHistory());
  const [apiBaseUrlMessage, setApiBaseUrlMessage] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const payload = await getSettingsPayload();
      setSettings(payload.settings || {});
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

  const handleSaveApiBaseUrl = async () => {
    try {
      setApiBaseUrl(apiBaseUrlInput);
      const normalized = getApiBaseUrl();
      addApiBaseUrlToHistory(normalized);
      setApiBaseUrlInput(normalized);
      setApiBaseUrlHistory(getApiBaseUrlHistory());
      setApiBaseUrlMessage(`Connected to agent at: ${normalized}`);
      await loadSettings();
      if (onAgentNameRefresh) {
        await onAgentNameRefresh();
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
    if (onAgentNameRefresh) {
      await onAgentNameRefresh();
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

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content page-content-narrow settings-sections">
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
            defaultSystemPrompt={defaultSystemPrompt}
            defaultSystemPromptWithoutBuiltInTools={defaultSystemPromptWithoutBuiltInTools}
          />
        )}
      </div>
    </div>
  );
}

export default SettingsView;
