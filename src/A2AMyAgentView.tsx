import { useCallback, useEffect, useState } from 'react';
import { createIntegration, listIntegrations, updateIntegration, type Integration } from './api';

// ---------------------------------------------------------------------------
// Mock inbound sessions from external agents
// ---------------------------------------------------------------------------

interface InboundSession {
  id: string;
  remote_agent_name: string;
  remote_agent_id: string;
  started_at: string;
  last_message_at: string;
  status: 'active' | 'completed' | 'failed';
  message_count: number;
  preview: string;
}

const MOCK_INBOUND_SESSIONS: InboundSession[] = [
  {
    id: 'ext-0001',
    remote_agent_name: 'ResearchBot',
    remote_agent_id: 'a1b2c3d4-0000-0000-0000-000000000001',
    started_at: '2026-02-21T08:14:02Z',
    last_message_at: '2026-02-21T08:19:45Z',
    status: 'completed',
    message_count: 7,
    preview: 'Summarise the last 3 commits in the brute repository and list any breaking changes.',
  },
  {
    id: 'ext-0002',
    remote_agent_name: 'SchedulerAssistant',
    remote_agent_id: 'a1b2c3d4-0000-0000-0000-000000000005',
    started_at: '2026-02-21T10:02:31Z',
    last_message_at: '2026-02-21T10:02:55Z',
    status: 'active',
    message_count: 2,
    preview: 'Can you check my calendar for next week and flag any conflicts with the 10am daily standup?',
  },
  {
    id: 'ext-0003',
    remote_agent_name: 'CodeReviewer',
    remote_agent_id: 'a1b2c3d4-0000-0000-0000-000000000002',
    started_at: '2026-02-20T16:55:10Z',
    last_message_at: '2026-02-20T17:03:22Z',
    status: 'completed',
    message_count: 12,
    preview: 'Please review the diff attached and flag any security issues or off-by-one errors.',
  },
  {
    id: 'ext-0004',
    remote_agent_name: 'DataAnalyst',
    remote_agent_id: 'a1b2c3d4-0000-0000-0000-000000000003',
    started_at: '2026-02-19T09:30:00Z',
    last_message_at: '2026-02-19T09:31:05Z',
    status: 'failed',
    message_count: 1,
    preview: 'Run a statistical summary on the attached CSV and return the top 5 anomalies.',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusDot(status: InboundSession['status']) {
  const colors: Record<InboundSession['status'], string> = {
    active: '#4caf82',
    completed: '#6f8cff',
    failed: '#f25f5c',
  };
  return (
    <span
      title={status}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[status],
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function A2AMyAgentView() {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state (used both for initial connect and edit-key mode)
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isEditingKey, setIsEditingKey] = useState(false);

  // Derived
  const isConfigured = Boolean(integration?.config?.api_key);
  const isConnected = isConfigured && Boolean(integration?.enabled);

  const loadIntegration = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listIntegrations();
      const found = list.find(i => i.provider === 'a2_registry') ?? null;
      setIntegration(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegration();
  }, [loadIntegration]);

  // Connect — creates (or updates) integration and enables it
  const handleConnect = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setError('API key is required.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (integration) {
        await updateIntegration(integration.id, {
          provider: 'a2_registry',
          name: integration.name || 'A2 Registry',
          mode: 'duplex',
          enabled: true,
          config: { ...integration.config, api_key: key },
        });
      } else {
        await createIntegration({
          provider: 'a2_registry',
          name: 'A2 Registry',
          mode: 'duplex',
          enabled: true,
          config: { api_key: key },
        });
      }
      setApiKeyInput('');
      setIsEditingKey(false);
      setSuccess('Agent connected to the A2A network.');
      await loadIntegration();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  // Toggle enabled without touching the key
  const handleToggleEnabled = async (next: boolean) => {
    if (!integration) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateIntegration(integration.id, {
        provider: 'a2_registry',
        name: integration.name,
        mode: 'duplex',
        enabled: next,
        config: integration.config,
      });
      setSuccess(next ? 'Agent is now active on the network.' : 'Agent is now offline.');
      await loadIntegration();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  // Disconnect — disable and wipe API key
  const handleDisconnect = async () => {
    if (!integration) return;
    if (!confirm('Disconnect this agent from the A2A network? The API key will be removed.')) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateIntegration(integration.id, {
        provider: 'a2_registry',
        name: integration.name,
        mode: 'duplex',
        enabled: false,
        config: { api_key: '' },
      });
      setApiKeyInput('');
      setSuccess('Disconnected from the A2A network.');
      await loadIntegration();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setSaving(false);
    }
  };

  const startEditKey = () => {
    setApiKeyInput('');
    setShowKey(false);
    setIsEditingKey(true);
    setError(null);
    setSuccess(null);
  };

  const cancelEditKey = () => {
    setApiKeyInput('');
    setShowKey(false);
    setIsEditingKey(false);
    setError(null);
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderConnectForm(isReplace: boolean) {
    return (
      <section className="settings-group" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{isReplace ? 'Replace API key' : 'Connect to A2A network'}</h3>

        {!isReplace && (
          <p className="settings-help" style={{ margin: 0 }}>
            Enter your A2 Registry API key to register this agent on the network. You can obtain a key from the Square registry once it is publicly available.
          </p>
        )}

        <label className="settings-field">
          <span>API key</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              placeholder="a2r-…"
              autoComplete="off"
              style={{ flex: 1 }}
              disabled={saving}
              onKeyDown={e => { if (e.key === 'Enter') void handleConnect(); }}
              autoFocus
            />
            <button
              type="button"
              className="settings-add-btn"
              onClick={() => setShowKey(v => !v)}
              style={{ flexShrink: 0 }}
              tabIndex={-1}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="settings-save-btn"
            onClick={() => void handleConnect()}
            disabled={saving || !apiKeyInput.trim()}
          >
            {saving ? 'Connecting…' : isReplace ? 'Save new key' : 'Connect'}
          </button>
          {isReplace && (
            <button type="button" className="settings-remove-btn" onClick={cancelEditKey} disabled={saving}>
              Cancel
            </button>
          )}
        </div>
      </section>
    );
  }

  function renderConnectedPanel() {
    const enabled = integration?.enabled ?? false;
    return (
      <section className="settings-group" style={{ marginBottom: 24 }}>
        <div className="integration-form-title-row">
          <h3 style={{ margin: 0 }}>Connection</h3>
        </div>

        {/* Status row */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: isConnected ? '#4caf82' : '#aeb7c7',
              flexShrink: 0,
              boxShadow: isConnected ? '0 0 6px #4caf8288' : 'none',
              transition: 'background 0.2s',
            }}
          />
          <span style={{ color: 'var(--text-1)', fontSize: '0.9em' }}>
            {isConnected
              ? 'Connected — agent is discoverable on the A2A network.'
              : 'API key saved — agent is offline (not discoverable).'}
          </span>
        </div>

        {/* API key row */}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{
            flex: 1,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '5px 10px',
            fontSize: '0.85em',
            color: 'var(--text-2)',
            letterSpacing: '0.1em',
          }}>
            {'•'.repeat(24)}
          </code>
          <button type="button" className="settings-add-btn" onClick={startEditKey} disabled={saving}>
            Replace key
          </button>
        </div>

        {/* Enable / disable toggle */}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: saving ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => void handleToggleEnabled(e.target.checked)}
              disabled={saving}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.9em' }}>
              {enabled ? 'Active — visible to other agents' : 'Inactive — not visible to other agents'}
            </span>
          </label>
        </div>

        {/* Disconnect */}
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="settings-remove-btn"
            onClick={() => void handleDisconnect()}
            disabled={saving}
          >
            Disconnect
          </button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>🤖 My Agent</h1>
      </div>

      <div className="page-content page-content-narrow">
        <p className="settings-help">
          Control how your agent participates in the A2A network. When connected and active, other agents registered on the Square registry can discover and contact yours.
        </p>

        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)} className="error-dismiss">×</button>
          </div>
        )}
        {success && (
          <div className="success-banner">
            {success}
            <button onClick={() => setSuccess(null)} className="error-dismiss">×</button>
          </div>
        )}

        {loading ? (
          <div className="sessions-loading">Loading…</div>
        ) : (
          <>
            {/* Not yet configured OR actively editing key */}
            {(!isConfigured || isEditingKey)
              ? renderConnectForm(isEditingKey)
              : renderConnectedPanel()
            }

            {/* Inbound sessions — only shown once connected */}
            {isConfigured && !isEditingKey && (
              <section>
                <div className="integration-form-title-row" style={{ marginBottom: 4 }}>
                  <h3 style={{ margin: 0 }}>Inbound sessions</h3>
                  <span style={{ fontSize: '0.8em', color: 'var(--text-2)', fontStyle: 'italic' }}>mock data</span>
                </div>
                <p className="settings-help" style={{ marginBottom: 14 }}>
                  Sessions initiated by other agents on the network. Full history and replay will be available once the A2A network is live.
                </p>

                <div className="mcp-server-list">
                  {MOCK_INBOUND_SESSIONS.map(session => (
                    <article key={session.id} className="integration-card mcp-server-card">
                      <div className="integration-card-headline">
                        <div className="integration-card-title-wrap">
                          <h3 style={{ display: 'flex', alignItems: 'center' }}>
                            {statusDot(session.status)}
                            {session.remote_agent_name}
                          </h3>
                          <span className="integration-mode-chip">{session.status}</span>
                          <span className="integration-mode-chip">{session.message_count} messages</span>
                        </div>
                        <span className="integration-updated">
                          {relativeTime(session.last_message_at)}
                        </span>
                      </div>

                      <p style={{ margin: '8px 0 6px', color: 'var(--text-2)', fontSize: '0.88em', lineHeight: 1.5, fontStyle: 'italic' }}>
                        "{session.preview}"
                      </p>

                      <div className="mcp-server-meta">
                        <code style={{ fontSize: '0.78em', color: 'var(--text-2)' }}>
                          agent id: {session.remote_agent_id} · session: {session.id} · started {relativeTime(session.started_at)}
                        </code>
                      </div>

                      <div className="integration-card-actions" style={{ marginTop: 8 }}>
                        <button type="button" className="settings-add-btn" disabled title="Open session (coming soon)">
                          Open session
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default A2AMyAgentView;
