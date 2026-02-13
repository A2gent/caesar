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
  fields: Array<{ key: string; label: string; placeholder: string; secret?: boolean; required?: boolean }>;
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
      { key: 'auth_header', label: 'Auth header (optional)', placeholder: 'Bearer token123', required: false },
    ],
  },
  {
    provider: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Store ElevenLabs API key for completion audio voice loading and playback.',
    modes: ['notify_only'],
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'sk_...', secret: true },
    ],
  },
  {
    provider: 'google_calendar',
    label: 'Google Calendar',
    description: 'Let the agent query your calendars and events via OAuth tokens.',
    modes: ['duplex'],
    fields: [
      { key: 'client_id', label: 'OAuth client ID', placeholder: '1234567890-abc.apps.googleusercontent.com' },
      { key: 'client_secret', label: 'OAuth client secret', placeholder: 'GOCSPX-...', secret: true },
      { key: 'refresh_token', label: 'Refresh token', placeholder: '1//0g...', secret: true },
      { key: 'access_token', label: 'Access token (optional)', placeholder: 'ya29....', secret: true, required: false },
      { key: 'token_expiry', label: 'Token expiry (optional)', placeholder: '2026-02-13T15:04:05Z', required: false },
      { key: 'token_url', label: 'Token URL (optional)', placeholder: 'https://oauth2.googleapis.com/token', required: false },
      { key: 'calendar_id', label: 'Default calendar ID (optional)', placeholder: 'primary', required: false },
    ],
  },
];

function ProviderIcon({ provider, label }: { provider: IntegrationProvider; label: string }) {
  const commonProps = { className: 'integration-provider-icon-svg', viewBox: '0 0 24 24', 'aria-hidden': true as const };

  switch (provider) {
    case 'telegram':
      return (
        <span className="integration-provider-icon integration-provider-icon-telegram" title={label}>
          <svg {...commonProps}>
            <path d="M20.5 4.2 3.9 10.6c-1 .4-1 1.8.1 2.1l4.2 1.4 1.6 5.1c.3 1 1.6 1.1 2.1.2l2.4-3.5 3.9 2.9c.7.5 1.7.1 1.9-.8L22 5.6c.2-1.1-.7-2-1.8-1.4Z" />
          </svg>
        </span>
      );
    case 'slack':
      return (
        <span className="integration-provider-icon integration-provider-icon-slack" title={label}>
          <svg {...commonProps}>
            <rect x="3" y="9" width="7" height="4" rx="2" />
            <rect x="7" y="3" width="4" height="7" rx="2" />
            <rect x="14" y="3" width="4" height="7" rx="2" />
            <rect x="14" y="11" width="7" height="4" rx="2" />
            <rect x="13" y="14" width="4" height="7" rx="2" />
            <rect x="6" y="14" width="4" height="7" rx="2" />
          </svg>
        </span>
      );
    case 'discord':
      return (
        <span className="integration-provider-icon integration-provider-icon-discord" title={label}>
          <svg {...commonProps}>
            <path d="M7.2 6.7a15.7 15.7 0 0 1 3-1l.4.8a14 14 0 0 1 2.8 0l.4-.8a15.6 15.6 0 0 1 3 1c1.8 2.6 2.3 5.1 2.1 7.6a12 12 0 0 1-3.7 1.9l-.8-1.3c.5-.2 1-.5 1.4-.8l-.3-.2c-2.7 1.3-5.6 1.3-8.3 0l-.3.2c.4.3.9.6 1.4.8l-.8 1.3a12 12 0 0 1-3.7-1.9c-.2-2.5.3-5 2.1-7.6Z" />
            <circle cx="9.7" cy="11.7" r="1.1" fill="currentColor" />
            <circle cx="14.3" cy="11.7" r="1.1" fill="currentColor" />
          </svg>
        </span>
      );
    case 'whatsapp':
      return (
        <span className="integration-provider-icon integration-provider-icon-whatsapp" title={label}>
          <svg {...commonProps}>
            <path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.6L3 20.5l4.6-1.4A8.5 8.5 0 1 0 12 3.5Z" />
            <path
              d="M9.2 8.8c.2-.5.5-.5.8-.5h.7c.2 0 .4.1.5.3l.7 1.7c.1.2 0 .4-.1.6l-.4.6c-.1.1-.1.3 0 .4.3.6.8 1.2 1.4 1.6.1.1.3.1.4 0l.7-.4c.2-.1.4-.1.6 0l1.6.8c.2.1.3.3.3.5v.7c0 .3 0 .6-.5.8-.4.2-1.3.4-2.3 0-1.1-.4-2.2-1.2-3-2.2-.9-.9-1.4-2-1.8-2.9-.4-1.1-.2-1.9 0-2.4Z"
              fill="#1f1f1f"
            />
          </svg>
        </span>
      );
    case 'webhook':
      return (
        <span className="integration-provider-icon integration-provider-icon-webhook" title={label}>
          <svg {...commonProps}>
            <circle cx="6" cy="12" r="2.3" />
            <circle cx="18" cy="7" r="2.3" />
            <circle cx="18" cy="17" r="2.3" />
            <path d="M8.2 11.2 15.7 7.8M8.2 12.8l7.5 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </span>
      );
    case 'google_calendar':
      return (
        <span className="integration-provider-icon integration-provider-icon-google-calendar" title={label}>
          <svg {...commonProps}>
            <path d="M7 3.5v3m10-3v3M4.5 8.5h15m-14 0h13a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="9" cy="13" r="1.2" />
            <circle cx="13" cy="13" r="1.2" />
            <circle cx="17" cy="13" r="1.2" />
            <circle cx="9" cy="17" r="1.2" />
            <circle cx="13" cy="17" r="1.2" />
          </svg>
        </span>
      );
    case 'elevenlabs':
      return (
        <span className="integration-provider-icon integration-provider-icon-elevenlabs" title={label}>
          <svg {...commonProps}>
            <path d="M8 4.5a3.5 3.5 0 0 1 3.5 3.5v2h-2V8a1.5 1.5 0 0 0-3 0v8a1.5 1.5 0 0 0 3 0v-2h2v2a3.5 3.5 0 0 1-7 0V8A3.5 3.5 0 0 1 8 4.5Zm8 0a3.5 3.5 0 0 1 3.5 3.5v8a3.5 3.5 0 1 1-7 0v-2h2v2a1.5 1.5 0 1 0 3 0V8a1.5 1.5 0 0 0-3 0v2h-2V8A3.5 3.5 0 0 1 16 4.5Z" />
          </svg>
        </span>
      );
    default:
      return null;
  }
}

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
      if (field.required === false) {
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
        Connect chat channels, webhooks, and data sources like Google Calendar, then enable or remove them anytime.
      </p>
      <p className="settings-help">
        For completion audio, add an enabled ElevenLabs integration with your API key, then choose voice and speed in Settings.
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
              <span className="integration-provider-label">
                <ProviderIcon provider={item.provider} label={item.label} />
                <span>{item.label}</span>
              </span>
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
                  <span className="integration-provider-label">
                    <ProviderIcon provider={integration.provider} label={providerById(integration.provider).label} />
                    <span>{providerById(integration.provider).label}</span>
                  </span>
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
