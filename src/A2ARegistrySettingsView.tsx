import { useEffect, useState } from 'react';
import { listIntegrations, updateIntegration, type Integration } from './api';
import {
  clearStoredLocalA2AAgentID,
  fetchRegistrySelfAgent,
  getStoredA2ARegistryOwnerEmail,
  getStoredA2ARegistryURL,
  getStoredLocalA2AAgentID,
  storeA2ARegistryOwnerEmail,
  storeA2ARegistryURL,
  storeLocalA2AAgentID,
} from './a2aIdentity';

function A2ARegistrySettingsView() {
  const [registryUrl, setRegistryUrl] = useState(getStoredA2ARegistryURL);
  const [urlDraft, setUrlDraft] = useState(getStoredA2ARegistryURL);
  const [isEditingUrl, setIsEditingUrl] = useState(false);

  const [ownerEmail, setOwnerEmail] = useState<string>(getStoredA2ARegistryOwnerEmail());
  const [localAgentID, setLocalAgentID] = useState<string>(getStoredLocalA2AAgentID());
  const [registryIntegration, setRegistryIntegration] = useState<Integration | null>(null);

  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const resolveSettings = async () => {
      try {
        const integrations = await listIntegrations();
        const integration = integrations.find(i => i.provider === 'a2_registry') ?? null;
        setRegistryIntegration(integration);

        const configuredOwnerEmail = integration?.config?.owner_email?.trim() || '';
        if (configuredOwnerEmail) {
          setOwnerEmail(configuredOwnerEmail);
          storeA2ARegistryOwnerEmail(configuredOwnerEmail);
        }

        const apiKey = integration?.config?.api_key?.trim() || '';
        if (!apiKey) {
          clearStoredLocalA2AAgentID();
          setLocalAgentID('');
          return;
        }

        const me = await fetchRegistrySelfAgent(registryUrl, apiKey);
        storeLocalA2AAgentID(me.id);
        setLocalAgentID(me.id);
      } catch {
        // non-fatal
      }
    };
    void resolveSettings();
  }, [registryUrl]);

  const commitUrl = () => {
    const normalized = urlDraft.trim().replace(/\/$/, '');
    setRegistryUrl(normalized);
    storeA2ARegistryURL(normalized);
    setIsEditingUrl(false);
    setError(null);
    setSuccess('Registry URL saved.');
  };

  const handleSaveRegistrySettings = async () => {
    const normalized = ownerEmail.trim();
    if (!normalized) {
      setError('Owner email is required.');
      return;
    }

    setSavingSettings(true);
    setError(null);
    setSuccess(null);
    try {
      storeA2ARegistryOwnerEmail(normalized);
      if (registryIntegration) {
        await updateIntegration(registryIntegration.id, {
          provider: 'a2_registry',
          name: registryIntegration.name || 'A2 Registry',
          mode: 'duplex',
          enabled: registryIntegration.enabled,
          config: {
            ...registryIntegration.config,
            owner_email: normalized,
          },
        });
        setSuccess('A2 Registry settings saved.');
        const integrations = await listIntegrations();
        const refreshed = integrations.find(i => i.provider === 'a2_registry') ?? null;
        setRegistryIntegration(refreshed);
      } else {
        setSuccess('Owner email saved locally. It will sync to integration after "My agent" is connected.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save A2 Registry settings');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>🌐 Registry Settings</h1>
      </div>

      <div className="page-content page-content-narrow settings-sections">
        <p className="settings-help">
          Configure the registry endpoint and owner identity used by A2A features.
        </p>

        {error && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            {error}
            <button onClick={() => setError(null)} className="error-dismiss">×</button>
          </div>
        )}

        {success && (
          <div className="success-banner" style={{ marginBottom: 16 }}>
            {success}
            <button onClick={() => setSuccess(null)} className="error-dismiss">×</button>
          </div>
        )}

        <section className="a2a-config-block">
          <div className="settings-group" style={{ marginBottom: 16 }}>
            <div className="integration-form-title-row">
              <h3 style={{ margin: 0 }}>Registry URL</h3>
            </div>

            {isEditingUrl ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <input
                  type="text"
                  value={urlDraft}
                  onChange={e => setUrlDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitUrl();
                    if (e.key === 'Escape') {
                      setUrlDraft(registryUrl);
                      setIsEditingUrl(false);
                    }
                  }}
                  style={{ flex: 1 }}
                  placeholder="http://localhost:5174"
                  autoFocus
                />
                <button type="button" className="settings-add-btn" onClick={commitUrl}>Save</button>
                <button type="button" className="settings-remove-btn" onClick={() => { setUrlDraft(registryUrl); setIsEditingUrl(false); }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <code style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 10px', color: 'var(--primary)', fontSize: '0.9em' }}>
                  {registryUrl}
                </code>
                <button type="button" className="settings-add-btn" onClick={() => { setUrlDraft(registryUrl); setIsEditingUrl(true); }}>
                  Edit
                </button>
              </div>
            )}
          </div>

          {localAgentID && (
            <div className="a2a-identity-inline">
              <span>Your connected agent ID:</span>
              <code>{localAgentID}</code>
            </div>
          )}

          <div className="settings-group" style={{ marginTop: 14, marginBottom: 0 }}>
            <div className="integration-form-title-row">
              <h3 style={{ margin: 0 }}>Owner email</h3>
            </div>
            <label className="settings-field" style={{ gap: 6 }}>
              <span>Used when registering local Docker agents into this registry.</span>
              <input
                type="email"
                value={ownerEmail}
                onChange={e => setOwnerEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <div>
              <button
                type="button"
                className="settings-save-btn"
                onClick={() => void handleSaveRegistrySettings()}
                disabled={savingSettings || !ownerEmail.trim()}
              >
                {savingSettings ? 'Saving...' : 'Save registry settings'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default A2ARegistrySettingsView;
