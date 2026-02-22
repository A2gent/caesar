import React, { useMemo, useState } from 'react';
import type {
  Integration,
  IntegrationMode,
  IntegrationProvider,
  IntegrationRequest,
  IntegrationTestResponse,
} from './api';
import { IntegrationProviderIcon } from './integrationMeta';

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
  flow: 'input' | 'output' | 'bidirectional';
  modes: IntegrationMode[];
  fields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    secret?: boolean;
    required?: boolean;
    kind?: 'text' | 'select';
    options?: Array<{ value: string; label: string }>;
  }>;
}

const PROVIDERS: ProviderSpec[] = [
  {
    provider: 'telegram',
    label: 'Telegram',
    description: 'Chat with your agent from Telegram.',
    flow: 'bidirectional',
    modes: ['notify_only', 'duplex'],
    fields: [
      { key: 'bot_token', label: 'Bot token', placeholder: '123456:abc...', secret: true },
      {
        key: 'session_scope',
        label: 'Session mapping',
        kind: 'select',
        options: [
          { value: 'topic', label: 'Map each topic/thread to a session' },
          { value: 'chat', label: 'Single session per chat' },
        ],
      },
      {
        key: 'default_chat_id',
        label: 'Default chat ID (optional)',
        placeholder: '-1001234567890',
        required: false,
      },
      {
        key: 'transcribe_voice_messages',
        label: 'Voice message transcription',
        kind: 'select',
        options: [
          { value: 'true', label: 'Enabled (voice/audio -> prompt)' },
          { value: 'false', label: 'Disabled (ignore audio)' },
        ],
      },
      {
        key: 'reply_mode',
        label: 'Reply format',
        kind: 'select',
        options: [
          { value: 'text', label: 'Text only' },
          { value: 'voice', label: 'Audio only' },
          { value: 'both', label: 'Text + audio' },
        ],
      },
      {
        key: 'transcribe_language',
        label: 'Transcription language (optional)',
        kind: 'select',
        required: false,
        options: [
          { value: '', label: 'Auto-detect' },
          { value: 'en', label: 'English' },
          { value: 'ru', label: 'Russian' },
          { value: 'uk', label: 'Ukrainian' },
          { value: 'de', label: 'German' },
          { value: 'fr', label: 'French' },
          { value: 'es', label: 'Spanish' },
          { value: 'it', label: 'Italian' },
          { value: 'pt', label: 'Portuguese' },
          { value: 'pl', label: 'Polish' },
          { value: 'tr', label: 'Turkish' },
          { value: 'ja', label: 'Japanese' },
          { value: 'ko', label: 'Korean' },
          { value: 'zh', label: 'Chinese' },
        ],
      },
      {
        key: 'transcribe_translate_to_english',
        label: 'Translate transcript to English',
        kind: 'select',
        required: false,
        options: [
          { value: '', label: 'Use whisper default setting' },
          { value: 'true', label: 'Always translate to English' },
          { value: 'false', label: 'Keep original language' },
        ],
      },
      {
        key: 'web_app_base_url',
        label: 'Web app base URL (optional)',
        placeholder: 'https://your-app.example.com',
        required: false,
      },
    ],
  },
  {
    provider: 'slack',
    label: 'Slack',
    description: 'Route updates and replies to a Slack channel.',
    flow: 'bidirectional',
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
    flow: 'bidirectional',
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
    flow: 'bidirectional',
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
    flow: 'output',
    modes: ['notify_only'],
    fields: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://example.com/agent-events' },
      { key: 'auth_header', label: 'Auth header (optional)', placeholder: 'Bearer token123', required: false },
    ],
  },
  {
    provider: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Store ElevenLabs API key so agent tools can synthesize speech clips.',
    flow: 'output',
    modes: ['notify_only'],
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'sk_...', secret: true },
    ],
  },
  {
    provider: 'google_calendar',
    label: 'Google Calendar',
    description: 'Read calendars and events via OAuth tokens.',
    flow: 'input',
    modes: ['notify_only'],
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
  {
    provider: 'perplexity',
    label: 'Perplexity',
    description: 'Store Perplexity API credentials for future web research and answer generation workflows.',
    flow: 'input',
    modes: ['notify_only'],
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'pplx-...', secret: true },
      { key: 'model', label: 'Default model (optional)', placeholder: 'sonar-pro', required: false },
    ],
  },
  {
    provider: 'brave_search',
    label: 'Brave Search',
    description: 'Store Brave Search credentials so agent tools can run web search.',
    flow: 'input',
    modes: ['notify_only'],
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'BSA...', secret: true },
      {
        key: 'safesearch',
        label: 'Safe search (optional)',
        kind: 'select',
        required: false,
        options: [
          { value: '', label: 'Provider default' },
          { value: 'moderate', label: 'Moderate' },
          { value: 'strict', label: 'Strict' },
          { value: 'off', label: 'Off' },
        ],
      },
    ],
  },
  {
    provider: 'exa',
    label: 'Exa',
    description: 'Store Exa API key for AI-optimized web search.',
    flow: 'input',
    modes: ['notify_only'],
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'exa-...', secret: true },
    ],
  },
  {
    provider: 'a2_registry',
    label: 'A2 Registry',
    description: 'Connect your agent to the Square A2A network. Once enabled and authenticated, other agents can discover and contact yours.',
    flow: 'bidirectional',
    modes: ['duplex'],
    fields: [
      { key: 'api_key', label: 'API key', placeholder: 'a2r-...', secret: true },
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
  return mode === 'duplex' ? 'Input + output' : 'One-way';
}

function integrationDirectionLabel(integration: Integration): string {
  const flow = providerById(integration.provider).flow;
  if (flow === 'input') {
    return 'Input only';
  }
  if (flow === 'output') {
    return 'Output only';
  }
  return modeLabel(integration.mode);
}

function flowLabel(flow: ProviderSpec['flow']): string {
  if (flow === 'input') {
    return 'Input integrations';
  }
  if (flow === 'output') {
    return 'Output integrations';
  }
  return 'Input + output integrations';
}

function flowDescription(flow: ProviderSpec['flow']): string {
  if (flow === 'input') {
    return 'Read-only data sources the agent can query.';
  }
  if (flow === 'output') {
    return 'Destinations where the agent sends updates or generated content.';
  }
  return 'Channels where users can message the agent and receive replies.';
}

function defaultConfigForProvider(provider: IntegrationProvider): Record<string, string> {
  if (provider !== 'telegram') {
    return {};
  }
  return {
    session_scope: 'topic',
    transcribe_voice_messages: 'true',
    transcribe_translate_to_english: '',
    reply_mode: 'text',
  };
}

const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({ integrations, isSaving, onCreate, onUpdate, onDelete, onTest }) => {
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [provider, setProvider] = useState<IntegrationProvider>('telegram');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<IntegrationMode>('duplex');
  const [enabled, setEnabled] = useState(true);
  const [config, setConfig] = useState<Record<string, string>>(defaultConfigForProvider('telegram'));
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

  const providersByFlow = useMemo(() => {
    return {
      input: PROVIDERS.filter((item) => item.flow === 'input'),
      output: PROVIDERS.filter((item) => item.flow === 'output'),
      bidirectional: PROVIDERS.filter((item) => item.flow === 'bidirectional'),
    };
  }, []);

  const connectedByFlow = useMemo(() => {
    return {
      input: integrations.filter((item) => providerById(item.provider).flow === 'input'),
      output: integrations.filter((item) => providerById(item.provider).flow === 'output'),
      bidirectional: integrations.filter((item) => providerById(item.provider).flow === 'bidirectional'),
    };
  }, [integrations]);

  const setProviderWithDefaults = (next: IntegrationProvider) => {
    const nextSpec = providerById(next);
    setProvider(next);
    setMode(nextSpec.modes[0]);
    setConfig(defaultConfigForProvider(next));
  };

  const resetForm = () => {
    setEditingId(null);
    setProvider('telegram');
    setName('');
    setMode('duplex');
    setEnabled(true);
    setConfig(defaultConfigForProvider('telegram'));
    setError(null);
    setSuccess(null);
  };

  const openCreateComposer = () => {
    resetForm();
    setIsComposerOpen(true);
  };

  const closeComposer = () => {
    resetForm();
    setIsComposerOpen(false);
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
      } else {
        await onCreate(payload);
      }
      closeComposer();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save integration');
    }
  };

  const handleEdit = (integration: Integration) => {
    const editSpec = providerById(integration.provider);
    const nextMode = editSpec.modes.includes(integration.mode) ? integration.mode : editSpec.modes[0];
    setEditingId(integration.id);
    setIsComposerOpen(true);
    setProvider(integration.provider);
    setName(integration.name);
    setMode(nextMode);
    setEnabled(integration.enabled);
    setConfig({ ...defaultConfigForProvider(integration.provider), ...(integration.config || {}) });
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
        closeComposer();
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
      {!isComposerOpen ? (
        <div className="integrations-list">
          <div className="integration-list-header-row">
            <h3>Connected integrations</h3>
            <button type="button" className="settings-add-btn" onClick={openCreateComposer}>
              Add new integration
            </button>
          </div>
          <p className="settings-help">
            Manage your connected integrations. Add a new one when you need another channel or data source.
          </p>
          {error && <div className="settings-error">{error}</div>}
          {success && <div className="settings-success">{success}</div>}
          {integrations.length === 0 ? (
            <p className="settings-help">No integrations connected yet.</p>
          ) : (
            (['input', 'output', 'bidirectional'] as const).map((flow) => (
              <div key={flow} className="integration-connected-section">
                <h4>{flowLabel(flow)}</h4>
                {connectedByFlow[flow].length === 0 ? (
                  <p className="settings-help">No connected integrations in this group.</p>
                ) : (
                  connectedByFlow[flow].map((integration) => (
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
                            <IntegrationProviderIcon provider={integration.provider} label={providerById(integration.provider).label} />
                            <span>{providerById(integration.provider).label}</span>
                          </span>
                          <span>{integrationDirectionLabel(integration)}</span>
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
            ))
          )}
        </div>
      ) : (
        <div className="integration-composer">
          <div className="integration-composer-header-row">
            <h3>{editingId ? 'Edit integration' : 'Connect new integration'}</h3>
            <button type="button" className="settings-add-btn" onClick={closeComposer}>
              Back to connected integrations
            </button>
          </div>
          <p className="settings-help">
            Choose an integration type, then fill in the credentials and options.
          </p>
          <p className="settings-help">
            For agent-triggered speech, add an enabled ElevenLabs integration, then set default voice and speed in Tools under Integration-backed skills.
          </p>

          {(['input', 'output', 'bidirectional'] as const).map((flow) => (
            <div key={flow} className="integration-provider-section">
              <h3>{flowLabel(flow)}</h3>
              <p className="settings-help">{flowDescription(flow)}</p>
              <div className="integration-provider-grid">
                {providersByFlow[flow].map((item) => (
                  <button
                    key={item.provider}
                    type="button"
                    className={`integration-provider-card ${item.provider === provider ? 'active' : ''}`}
                    onClick={() => setProviderWithDefaults(item.provider)}
                  >
                    <div className="integration-provider-card-header">
                      <span className="integration-provider-label">
                        <IntegrationProviderIcon provider={item.provider} label={item.label} />
                        <span>{item.label}</span>
                      </span>
                      <span className="integration-count-badge">{connectedByProvider.get(item.provider) || 0} connected</span>
                    </div>
                    <p>{item.description}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <form className="integration-form" onSubmit={handleSubmit}>
            <div className="integration-form-title-row">
              <h3>{editingId ? `Editing: ${name || spec.label}` : `Configure: ${spec.label}`}</h3>
              {editingId && (
                <button type="button" className="settings-remove-btn" onClick={openCreateComposer}>
                  Switch to new integration
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

              {spec.modes.length > 1 && (
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
              )}

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
                  {field.kind === 'select' ? (
                    <select
                      value={config[field.key] || field.options?.[0]?.value || ''}
                      onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    >
                      {(field.options || []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.secret ? 'password' : 'text'}
                      value={config[field.key] || ''}
                      onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      autoComplete="off"
                    />
                  )}
                  {provider === 'telegram' && field.key === 'bot_token' && (
                    <div className="integration-helper-block">
                      <p className="settings-help integration-helper-text">
                        First create a Telegram bot with @BotFather (send /newbot), then copy the bot token BotFather gives you and paste it here.
                      </p>
                      <p className="settings-help integration-helper-text">
                        In @BotFather, enable group usage with /setjoingroups and disable privacy mode with /setprivacy. This integration listens to all groups/topics the bot is in.
                      </p>
                      <p className="settings-help integration-helper-text">
                        New Telegram sessions are assigned to the My Mind project. For thread-to-session mapping, add the bot to your group, create topics, and keep Session mapping set to topic.
                      </p>
                      <p className="settings-help integration-helper-text">
                        Set Default chat ID to mirror newly created Web App sessions into Telegram automatically. If topic creation fails, the message is posted in the main chat.
                      </p>
                    </div>
                  )}
                </label>
              ))}
            </div>

            {error && <div className="settings-error">{error}</div>}
            {success && <div className="settings-success">{success}</div>}

            <button type="submit" className="settings-save-btn" disabled={isSaving}>
              {isSaving ? 'Saving...' : editingId ? 'Save integration' : 'Connect integration'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default IntegrationsPanel;
