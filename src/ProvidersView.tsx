import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listProviders, setActiveProvider, type LLMProviderType, type ProviderConfig } from './api';

function ProvidersView() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleSetActive = async (providerType: LLMProviderType) => {
    try {
      setIsSaving(true);
      setError(null);
      const updated = await setActiveProvider(providerType);
      setProviders(updated);
    } catch (err) {
      console.error('Failed to set active provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to set active provider');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="sessions-loading">Loading providers...</div>;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>LLM Providers</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content page-content-narrow provider-list-view">
        {providers.map((provider) => (
          <div key={provider.type} className={`provider-list-item ${provider.is_active ? 'active' : ''}`}>
            <div className="provider-list-main">
              <h3>{provider.display_name}</h3>
              <div className="provider-list-meta">
                <span className={`status-badge ${provider.configured ? 'status-completed' : 'status-paused'}`}>
                  {provider.configured ? 'Configured' : 'Not configured'}
                </span>
                {provider.is_active ? <span className="status-badge status-running">Active</span> : null}
                {provider.model ? <span className="session-provider-chip">{provider.model}</span> : null}
              </div>
            </div>

            <div className="provider-list-actions">
              <Link to={`/providers/${provider.type}`} className="settings-add-btn">
                Edit
              </Link>
              <button
                type="button"
                className="settings-save-btn"
                disabled={isSaving || provider.is_active}
                onClick={() => handleSetActive(provider.type)}
              >
                Set active
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProvidersView;
