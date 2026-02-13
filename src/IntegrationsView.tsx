import { useEffect, useState } from 'react';
import IntegrationsPanel from './IntegrationsPanel';
import {
  listIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegration,
  type Integration,
  type IntegrationRequest,
} from './api';

function IntegrationsView() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIntegrations = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listIntegrations();
      setIntegrations(data);
    } catch (err) {
      console.error('Failed to load integrations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
  }, []);

  const handleCreateIntegration = async (payload: IntegrationRequest) => {
    setIsSaving(true);
    try {
      await createIntegration(payload);
      await loadIntegrations();
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateIntegration = async (integrationId: string, payload: IntegrationRequest) => {
    setIsSaving(true);
    try {
      await updateIntegration(integrationId, payload);
      await loadIntegrations();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteIntegration = async (integrationId: string) => {
    setIsSaving(true);
    try {
      await deleteIntegration(integrationId);
      await loadIntegrations();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Integrations</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content page-content-narrow">
        {isLoading ? (
          <div className="sessions-loading">Loading integrations...</div>
        ) : (
          <IntegrationsPanel
            integrations={integrations}
            isSaving={isSaving}
            onCreate={handleCreateIntegration}
            onUpdate={handleUpdateIntegration}
            onDelete={handleDeleteIntegration}
            onTest={testIntegration}
          />
        )}
      </div>
    </div>
  );
}

export default IntegrationsView;
