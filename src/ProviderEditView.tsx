import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listProviders, setActiveProvider, updateProvider, type LLMProviderType, type ProviderConfig } from './api';

function ProviderEditView() {
  const { providerType } = useParams<{ providerType: LLMProviderType }>();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');

  const selected = useMemo(
    () => providers.find((provider) => provider.type === providerType),
    [providers, providerType],
  );

  const loadProviders = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listProviders();
      setProviders(data);
    } catch (err) {
      console.error('Failed to load providers:', err);
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setApiKey('');
    setBaseURL(selected.base_url || selected.default_url || '');
    setModel(selected.model || selected.default_model || '');
  }, [selected]);

  const handleSave = async () => {
    if (!providerType) return;

    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      const updated = await updateProvider(providerType, {
        api_key: apiKey.trim() === '' ? undefined : apiKey.trim(),
        base_url: baseURL.trim(),
        model: model.trim(),
      });
      setProviders(updated);
      setApiKey('');
      setSuccess('Provider updated.');
    } catch (err) {
      console.error('Failed to update provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetActive = async () => {
    if (!providerType) return;
    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      const updated = await setActiveProvider(providerType);
      setProviders(updated);
      setSuccess('Provider is now active.');
    } catch (err) {
      console.error('Failed to set active provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to set active provider');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="sessions-loading">Loading provider...</div>;
  }

  if (!selected) {
    return (
      <div className="page-shell">
        <div className="page-content page-content-narrow">
          <div className="job-detail-error">
            Provider not found.
            <div className="settings-actions">
              <Link to="/providers" className="settings-add-btn">Back to providers</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>{selected.display_name}</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content page-content-narrow">
        <div className="settings-panel provider-edit-panel">
          <div className="provider-edit-top">
            <Link to="/providers" className="settings-add-btn">Back</Link>
            <div className="provider-list-meta">
              <span className={`status-badge ${selected.configured ? 'status-completed' : 'status-paused'}`}>
                {selected.configured ? 'Configured' : 'Not configured'}
              </span>
              {selected.is_active ? <span className="status-badge status-running">Active</span> : null}
            </div>
          </div>

          <label className="settings-field">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={selected.has_api_key ? 'Stored (enter to replace)' : 'Enter API key'}
              autoComplete="off"
              disabled={!selected.requires_key}
            />
          </label>

          <label className="settings-field">
            <span>Base URL</span>
            <input type="text" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} autoComplete="off" />
          </label>

          <label className="settings-field">
            <span>Default model</span>
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" />
          </label>

          <div className="settings-actions">
            <button type="button" className="settings-save-btn" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              className="settings-add-btn"
              onClick={handleSetActive}
              disabled={isSaving || selected.is_active}
            >
              Set active
            </button>
          </div>

          {success && <div className="settings-success">{success}</div>}
        </div>
      </div>
    </div>
  );
}

export default ProviderEditView;
