import React, { useMemo, useState } from 'react';
import type {
  Integration,
  IntegrationMode,
  IntegrationProvider,
  IntegrationRequest,
  IntegrationTestResponse,
} from './api';

interface IntegrationsPanelProps {
  integrations: Integration[];
  isSaving: boolean;
  onCreate: (payload: IntegrationRequest) => Promise<void>;
  onUpdate: (id: string, payload: IntegrationRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTest: (id: string) => Promise<IntegrationTestResponse>;
}

interface ProviderSpec {
  provider: IntegrationProvider;
  label: string;
  description: string;
  modes: IntegrationMode[];
  fields: Array<{ key: string; label: string; placeholder: string; secret?: boolean }>;
}

const PROVIDERS: ProviderSpec[] = [
  {
    provider: 'telegram',
    label: 'Telegram',
    description: 'Chat with your agent from Telegram.',
    modes: ['notify_only', 'duplex'],
    fields: [
      { key: 'bot_token', label: 'Bot token', placeholder: '123456:abc...', secret: true },
      { key: 'chat_id', label: 'Chat ID', placeholder: '-1001234567890' },
    ],
  },
  {
    provider: 'slack',
    label: 'Slack',
    description: 'Route updates and replies to a Slack channel.',
    modes: ['notify_only', 'duplex'],
    fields: [
      { key: 'bot_token', label: 'Bot token', placeholder: 'xoxb-...', secret: true },
      { key: 'channel_id', label: 'Channel ID', placeholder: 'C0123456789' },
    ],
  },
  {
    provider: 'discord',
    label: 'Discord',
    description: 'Use Discord channels for agent notifications and chats.',
    modes: ['notify_only', 'duplex'],
    fields: [
      { key: 'bot_token', label: 'Bot token', placeholder: 'discord token', secret: true },
      { key: 'channel_id', label: 'Channel ID', placeholder: '123456789012345678' },
    ],
  },
  {
    provider: 'whatsapp',
    label: 'WhatsApp',
    description: 'Connect WhatsApp for direct agent conversations.',
    modes: ['notify_only', 'duplex'],
    fields: [
      { key: 'access_token', label: 'Access token', placeholder: 'Meta Graph API token', secret: true },
      { key: 'phone_number_id', label: 'Phone number ID', placeholder: '123456789012345' },
      { key: 'recipient', label: 'Recipient number', placeholder: '+15551234567' },
    ],
  },
  {
    provider: 'webhook',
    label: 'Webhook',
    description: 'Send agent updates to your own endpoint.',
    modes: ['notify_only'],
    fields: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://example.com/agent-events' },
      { key: 'auth_header', label: 'Auth header (optional)', placeholder: 'Bearer token123' },
    ],
  },
];

function providerById(provider: IntegrationProvider): ProviderSpec {
  const spec = PROVIDERS.find((p) => p.provider === provider);
  if (!spec) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return spec;
}

function modeLabel(mode: IntegrationMode): string {
  return mode === 'duplex' ? 'Duplex chat' : 'Notify only';
}

const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({ integrations, isSaving, onCreate, onUpdate, onDelete, onTest }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [provider, setProvider] = useState<IntegrationProvider>('telegram');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<IntegrationMode>('duplex');
  const [enabled, setEnabled] = useState(true);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const spec = useMemo(() => providerById(provider), [provider]);

  const connectedByProvider = useMemo(() => {
    const counts = new Map<IntegrationProvider, number>();
    for (const item of integrations) {
      counts.set(item.provider, (counts.get(item.provider) || 0) + 1);
    }
    return counts;
  }, [integrations]);

  const setProviderWithDefaults = (next: IntegrationProvider) => {
    const nextSpec = providerById(next);
    setProvider(next);
    setMode(nextSpec.modes[0]);
    setConfig({});
  };

  const resetForm = () => {
    setEditingId(null);
    setProvider('telegram');
    setName('');
    setMode('duplex');
    setEnabled(true);
    setConfig({});
    setError(null);
    setSuccess(null);
  };

  const validateForm = (): string | null => {
    for (const field of spec.fields) {
      if (field.key === 'auth_header') {
        continue;
      }
      if (!(config[field.key] || '').trim()) {
        return `${field.label} is required.`;
      }
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload: IntegrationRequest = {
      provider,
      name: name.trim(),
      mode,
      enabled,
      config,
    };

    try {
      if (editingId) {
        await onUpdate(editingId, payload);
        setSuccess('Integration updated.');
      } else {
        await onCreate(payload);
        setSuccess('Integration connected.');
      }
      resetForm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save integration');
    }
  };

  const handleEdit = (integration: Integration) => {
    setEditingId(integration.id);
    setProvider(integration.provider);
    setName(integration.name);
    setMode(integration.mode);
    setEnabled(integration.enabled);
    setConfig(integration.config || {});
    setError(null);
    setSuccess(null);
  };

  const handleDelete = async (integration: Integration) => {
    if (!confirm(`Remove ${integration.name}?`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await onDelete(integration.id);
      if (editingId === integration.id) {
        resetForm();
      }
      setSuccess('Integration removed.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to remove integration');
    }
  };

  const handleTest = async (integration: Integration) => {
    setError(null);
    setSuccess(null);
    try {
      const result = await onTest(integration.id);
      setSuccess(result.message || 'Integration test succeeded.');
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Integration test failed');
    }
  };

  const handleModeChange = (nextMode: IntegrationMode) => {
    setMode(nextMode);
  };

  return (
    <div className="integrations-panel">
      <p className="settings-help">
        Connect chat channels and webhooks, then enable or remove them anytime. Email is intentionally excluded for now.
      </p>

      <div className="integration-provider-grid">
        {PROVIDERS.map((item) => (
          <button
            key={item.provider}
            type="button"
            className={`integration-provider-card ${item.provider === provider ? 'active' : ''}`}
            onClick={() => setProviderWithDefaults(item.provider)}
          >
            <div className="integration-provider-card-header">
              <span>{item.label}</span>
              <span className="integration-count-badge">{connectedByProvider.get(item.provider) || 0} connected</span>
            </div>
            <p>{item.description}</p>
          </button>
        ))}
      </div>

      <form className="integration-form" onSubmit={handleSubmit}>
        <div className="integration-form-title-row">
          <h3>{editingId ? 'Edit integration' : 'Connect new integration'}</h3>
          {editingId && (
            <button type="button" className="settings-remove-btn" onClick={resetForm}>
              Cancel edit
            </button>
          )}
        </div>

        <div className="settings-group">
          <label className="settings-field">
            <span>Integration name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${spec.label} primary`}
              autoComplete="off"
            />
          </label>

          <label className="settings-field">
            <span>Mode</span>
            <select value={mode} onChange={(e) => handleModeChange(e.target.value as IntegrationMode)}>
              {spec.modes.map((modeOption) => (
                <option key={modeOption} value={modeOption}>
                  {modeLabel(modeOption)}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field integration-toggle">
            <span>Enabled</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </label>
        </div>

        <div className="settings-group">
          {spec.fields.map((field) => (
            <label className="settings-field" key={field.key}>
              <span>{field.label}</span>
              <input
                type={field.secret ? 'password' : 'text'}
                value={config[field.key] || ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                autoComplete="off"
              />
            </label>
          ))}
        </div>

        {error && <div className="settings-error">{error}</div>}
        {success && <div className="settings-success">{success}</div>}

        <button type="submit" className="settings-save-btn" disabled={isSaving}>
          {isSaving ? 'Saving...' : editingId ? 'Save integration' : 'Connect integration'}
        </button>
      </form>

      <div className="integrations-list">
        <h3>Connected integrations</h3>
        {integrations.length === 0 ? (
          <p className="settings-help">No integrations connected yet.</p>
        ) : (
          integrations.map((integration) => (
            <div className="integration-row" key={integration.id}>
              <div className="integration-row-main">
                <div className="integration-row-title">
                  <strong>{integration.name}</strong>
                  <span className={`integration-status ${integration.enabled ? 'enabled' : 'disabled'}`}>
                    {integration.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="integration-row-meta">
                  <span>{providerById(integration.provider).label}</span>
                  <span>{modeLabel(integration.mode)}</span>
                  <span>Updated {new Date(integration.updated_at).toLocaleString()}</span>
                </div>
              </div>

              <div className="integration-row-actions">
                <button type="button" className="settings-add-btn" onClick={() => handleTest(integration)}>
                  Test
                </button>
                <button type="button" className="settings-add-btn" onClick={() => handleEdit(integration)}>
                  Edit
                </button>
                <button type="button" className="settings-remove-btn" onClick={() => handleDelete(integration)}>
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default IntegrationsPanel;
