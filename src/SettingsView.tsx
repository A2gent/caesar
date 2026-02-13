import { useEffect, useState } from 'react';
import SettingsPanel from './SettingsPanel';
import { getApiBaseUrl, getSettings, setApiBaseUrl, updateSettings } from './api';

function SettingsView() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(() => getApiBaseUrl());
  const [apiBaseUrlMessage, setApiBaseUrlMessage] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const settingsData = await getSettings();
      setSettings(settingsData);
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
      setApiBaseUrlInput(normalized);
      setApiBaseUrlMessage(`Saved frontend backend URL: ${normalized}`);
      await loadSettings();
    } catch (err) {
      console.error('Failed to update API base URL:', err);
      setApiBaseUrlMessage('Failed to update backend URL');
    }
  };

  const handleResetApiBaseUrl = async () => {
    setApiBaseUrl('');
    const normalized = getApiBaseUrl();
    setApiBaseUrlInput(normalized);
    setApiBaseUrlMessage(`Reset to default backend URL: ${normalized}`);
    await loadSettings();
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
          <h2>Frontend connection</h2>
          <p className="settings-help">
            Agent backend URL is stored in this browser only (local storage), not in backend settings.
          </p>
          <label className="settings-field">
            <span>Agent backend URL</span>
            <input
              type="text"
              value={apiBaseUrlInput}
              onChange={(e) => setApiBaseUrlInput(e.target.value)}
              placeholder="http://localhost:8080"
              autoComplete="off"
            />
          </label>
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
          <SettingsPanel settings={settings} isSaving={isSaving} onSave={handleSaveSettings} />
        )}
      </div>
    </div>
  );
}

export default SettingsView;
