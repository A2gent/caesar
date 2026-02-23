import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createIntegration,
  deleteIntegration,
  getA2ATunnelStatus,
  getA2ATunnelStatusStreamUrl,
  getSettings,
  listA2AInboundSessions,
  listIntegrations,
  listProjects,
  updateIntegration,
  updateSettings,
  type Integration,
  type Project,
  type Session,
  type TunnelLogEntry,
  type TunnelState,
  type TunnelStatus,
} from './api';
import {
  clearStoredLocalA2AAgentID,
  fetchRegistrySelfAgent,
  getStoredA2ARegistryURL,
  getStoredLocalA2AAgentID,
  storeLocalA2AAgentID,
} from './a2aIdentity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusDot(status: string) {
  const colors: Record<string, string> = {
    running: '#4caf82',
    completed: '#6f8cff',
    failed: '#f25f5c',
    queued: '#aeb7c7',
    paused: '#f0b429',
    input_required: '#f0b429',
  };
  return (
    <span
      title={status}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[status] ?? '#aeb7c7',
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function tunnelStateDot(state: TunnelState) {
  const color =
    state === 'connected' ? '#4caf82' :
    state === 'connecting' ? '#f0b429' :
    '#aeb7c7';
  const shadow = state === 'connected' ? '0 0 6px #4caf8288' : 'none';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        boxShadow: shadow,
        flexShrink: 0,
        transition: 'background 0.2s',
      }}
    />
  );
}

function tunnelStateLabel(state: TunnelState): string {
  if (state === 'connected') return 'Connected — agent is live on the A2A network.';
  if (state === 'connecting') return 'Connecting to Square…';
  return 'Disconnected — agent is not reachable via A2A.';
}

function formatLogTime24(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function logLevelClass(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('error') || normalized.includes('fail')) return 'a2a-log-line-error';
  if (normalized.includes('warn') || normalized.includes('disconnect')) return 'a2a-log-line-warn';
  if (normalized.includes('connect') || normalized.includes('started') || normalized.includes('ready')) return 'a2a-log-line-ok';
  return 'a2a-log-line-info';
}

// ---------------------------------------------------------------------------
// Connection log panel
// ---------------------------------------------------------------------------

function ConnectionLog({ entries, logRef }: { entries: TunnelLogEntry[]; logRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={logRef} className="a2a-log-panel">
      {entries.length === 0 ? (
        <span className="a2a-log-empty">No log entries yet.</span>
      ) : (
        entries.map((e, i) => (
          <div key={i} className={`a2a-log-line ${logLevelClass(e.message)}`}>
            <span className="a2a-log-time">
              {formatLogTime24(e.time)}
            </span>
            <span className="a2a-log-message">{e.message}</span>
          </div>
        ))
      )}
    </div>
  );
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

  // Form state
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [grpcAddrInput, setGrpcAddrInput] = useState('');
  const [wsUrlInput, setWsUrlInput] = useState('');
  const [transportInput, setTransportInput] = useState<'grpc' | 'websocket'>('grpc');
  const [showKey, setShowKey] = useState(false);
  const [isEditingKey, setIsEditingKey] = useState(false);

  // Tunnel status
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [logEntries, setLogEntries] = useState<TunnelLogEntry[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Projects + inbound project setting
  const [projects, setProjects] = useState<Project[]>([]);
  const [inboundProjectID, setInboundProjectID] = useState<string>('');
  const [savingProject, setSavingProject] = useState(false);

  // Inbound sessions
  const [inboundSessions, setInboundSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [localAgentID, setLocalAgentID] = useState<string>(getStoredLocalA2AAgentID());
  const [localAgentIDError, setLocalAgentIDError] = useState<string | null>(null);

  // Derived
  const isConfigured = Boolean(integration?.config?.api_key);

  // ---- Load integration ----
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

  // ---- Load projects + inbound project setting ----
  const loadProjectsAndSettings = useCallback(async () => {
    try {
      const [projs, settings] = await Promise.all([listProjects(), getSettings()]);
      setProjects(projs);
      setInboundProjectID(settings['A2A_INBOUND_PROJECT_ID'] ?? '');
    } catch {
      // non-fatal
    }
  }, []);

  // ---- Load inbound sessions ----
  const loadInboundSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const sessions = await listA2AInboundSessions();
      // Sort newest first
      sessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setInboundSessions(sessions);
    } catch {
      // non-fatal
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // ---- Tunnel status (initial fetch) ----
  const loadTunnelStatus = useCallback(async () => {
    try {
      const status = await getA2ATunnelStatus();
      setTunnelStatus(status);
      setLogEntries(status.log ?? []);
    } catch {
      // non-fatal — tunnel may not be configured yet
    }
  }, []);

  // ---- SSE log stream ----
  const startSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
    }
    const es = new EventSource(getA2ATunnelStatusStreamUrl());
    sseRef.current = es;

    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data) as TunnelLogEntry;
        setLogEntries(prev => {
          const next = [...prev, entry];
          return next.slice(-200); // keep last 200
        });
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      // SSE will reconnect automatically
    };
  }, []);

  const stopSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  // ---- Auto-scroll log ----
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logEntries]);

  // ---- Initial load ----
  useEffect(() => {
    void loadIntegration();
    void loadProjectsAndSettings();
    void loadTunnelStatus();
    void loadInboundSessions();
    startSSE();
    return () => stopSSE();
  }, [loadIntegration, loadProjectsAndSettings, loadTunnelStatus, loadInboundSessions, startSSE, stopSSE]);

  useEffect(() => {
    const resolveAgentIDFromRegistry = async () => {
      const apiKey = integration?.config?.api_key?.trim() || '';
      if (!apiKey) {
        clearStoredLocalA2AAgentID();
        setLocalAgentID('');
        setLocalAgentIDError(null);
        return;
      }
      const registryURL = getStoredA2ARegistryURL();
      try {
        const me = await fetchRegistrySelfAgent(registryURL, apiKey);
        storeLocalA2AAgentID(me.id);
        setLocalAgentID(me.id);
        setLocalAgentIDError(null);
      } catch (err) {
        clearStoredLocalA2AAgentID();
        setLocalAgentID('');
        const message = err instanceof Error ? err.message : String(err);
        setLocalAgentIDError(`Could not resolve agent ID from registry (${message}).`);
      }
    };
    void resolveAgentIDFromRegistry();
  }, [integration?.config?.api_key]);

  // Poll tunnel status every 5s to update the state dot
  useEffect(() => {
    const id = setInterval(() => void loadTunnelStatus(), 5000);
    return () => clearInterval(id);
  }, [loadTunnelStatus]);

  // Refresh inbound sessions every 15s
  useEffect(() => {
    const id = setInterval(() => void loadInboundSessions(), 15_000);
    return () => clearInterval(id);
  }, [loadInboundSessions]);

  // ---- Handlers ----

  const handleConnect = async () => {
    const key = apiKeyInput.trim();
    const transport = transportInput;
    const grpcAddr = grpcAddrInput.trim() || (integration?.config?.square_grpc_addr ?? '');
    const wsUrl = wsUrlInput.trim() || (integration?.config?.square_ws_url ?? '');
    if (!key) { setError('API key is required.'); return; }
    if (transport === 'grpc' && !grpcAddr) { setError('Square gRPC address is required (e.g. localhost:50051).'); return; }
    if (transport === 'websocket' && !wsUrl) { setError('Square WebSocket URL is required (e.g. ws://localhost:9000/tunnel/ws).'); return; }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const config = {
        ...(integration?.config ?? {}),
        api_key: key,
        transport,
        square_grpc_addr: grpcAddr,
        square_ws_url: wsUrl,
      };
      if (integration) {
        await updateIntegration(integration.id, {
          provider: 'a2_registry', name: integration.name || 'A2 Registry',
          mode: 'duplex', enabled: true, config,
        });
      } else {
        await createIntegration({
          provider: 'a2_registry', name: 'A2 Registry',
          mode: 'duplex', enabled: true, config,
        });
      }
      setApiKeyInput('');
      setGrpcAddrInput('');
      setWsUrlInput('');
      setIsEditingKey(false);
      try {
        const me = await fetchRegistrySelfAgent(getStoredA2ARegistryURL(), key);
        storeLocalA2AAgentID(me.id);
        setLocalAgentID(me.id);
        setLocalAgentIDError(null);
      } catch {
        clearStoredLocalA2AAgentID();
        setLocalAgentID('');
        setLocalAgentIDError('Connected, but could not fetch your agent ID from registry.');
      }
      setSuccess('Agent connected to the A2A network.');
      await loadIntegration();
      void loadTunnelStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (next: boolean) => {
    if (!integration) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateIntegration(integration.id, {
        provider: 'a2_registry', name: integration.name, mode: 'duplex',
        enabled: next, config: integration.config,
      });
      setSuccess(next ? 'Agent is now active on the network.' : 'Agent is now offline.');
      await loadIntegration();
      void loadTunnelStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!integration) return;
    if (!confirm('Disconnect this agent from the A2A network? The API key will be removed.')) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteIntegration(integration.id);
      setApiKeyInput('');
      setGrpcAddrInput('');
      setWsUrlInput('');
      clearStoredLocalA2AAgentID();
      setLocalAgentID('');
      setLocalAgentIDError(null);
      setSuccess('Disconnected from the A2A network.');
      await loadIntegration();
      void loadTunnelStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInboundProject = async (projectID: string) => {
    setSavingProject(true);
    try {
      const current = await getSettings();
      await updateSettings({ ...current, A2A_INBOUND_PROJECT_ID: projectID });
      setInboundProjectID(projectID);
    } catch {
      // non-fatal
    } finally {
      setSavingProject(false);
    }
  };

  const startEditKey = () => {
    setApiKeyInput('');
    setGrpcAddrInput(integration?.config?.square_grpc_addr ?? '');
    setWsUrlInput(integration?.config?.square_ws_url ?? '');
    setTransportInput((integration?.config?.transport as 'grpc' | 'websocket') || 'grpc');
    setShowKey(false);
    setIsEditingKey(true);
    setError(null);
    setSuccess(null);
  };

  const cancelEditKey = () => {
    setApiKeyInput('');
    setGrpcAddrInput('');
    setWsUrlInput('');
    setShowKey(false);
    setIsEditingKey(false);
    setError(null);
  };

  // ---- Render helpers ----

  function renderConnectForm(isReplace: boolean) {
    return (
      <section className="settings-group a2a-config-block" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{isReplace ? 'Replace credentials' : 'Connect to A2A network'}</h3>

        {!isReplace && (
          <p className="settings-help" style={{ margin: 0 }}>
            Enter your A2 Registry API key and choose the tunnel channel used to connect to Square.
          </p>
        )}

        <label className="settings-field">
          <span>Tunnel transport</span>
          <select
            value={transportInput}
            onChange={e => setTransportInput(e.target.value as 'grpc' | 'websocket')}
            disabled={saving}
          >
            <option value="grpc">gRPC</option>
            <option value="websocket">WebSocket</option>
          </select>
        </label>

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
            <button type="button" className="settings-add-btn" onClick={() => setShowKey(v => !v)} style={{ flexShrink: 0 }} tabIndex={-1}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        {transportInput === 'grpc' ? (
          <label className="settings-field">
            <span>Square gRPC address</span>
            <input
              type="text"
              value={grpcAddrInput}
              onChange={e => setGrpcAddrInput(e.target.value)}
              placeholder="localhost:50051"
              autoComplete="off"
              disabled={saving}
              onKeyDown={e => { if (e.key === 'Enter') void handleConnect(); }}
            />
            <span className="settings-help" style={{ margin: 0 }}>
              The host:port of Square&apos;s gRPC tunnel server (e.g. <code>square.example.com:50051</code>).
            </span>
          </label>
        ) : (
          <label className="settings-field">
            <span>Square WebSocket URL</span>
            <input
              type="text"
              value={wsUrlInput}
              onChange={e => setWsUrlInput(e.target.value)}
              placeholder="ws://localhost:9000/tunnel/ws"
              autoComplete="off"
              disabled={saving}
              onKeyDown={e => { if (e.key === 'Enter') void handleConnect(); }}
            />
            <span className="settings-help" style={{ margin: 0 }}>
              Full WebSocket tunnel endpoint (e.g. <code>wss://square.example.com/tunnel/ws</code>).
            </span>
          </label>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="settings-save-btn" onClick={() => void handleConnect()} disabled={saving || !apiKeyInput.trim()}>
            {saving ? 'Connecting…' : isReplace ? 'Save' : 'Connect'}
          </button>
          {isReplace && (
            <button type="button" className="settings-remove-btn" onClick={cancelEditKey} disabled={saving}>Cancel</button>
          )}
        </div>
      </section>
    );
  }

  function renderConnectedPanel() {
    const enabled = integration?.enabled ?? false;
    const state = tunnelStatus?.state ?? 'disconnected';
    const transport = (integration?.config?.transport as 'grpc' | 'websocket') || 'grpc';
    const addr = transport === 'websocket'
      ? (integration?.config?.square_ws_url ?? '—')
      : (integration?.config?.square_grpc_addr ?? '—');
    return (
      <section className="settings-group a2a-config-block" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Connection</h3>

        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
          {tunnelStateDot(state)}
          <span style={{ color: 'var(--text-1)', fontSize: '0.9em' }}>
            {tunnelStateLabel(state)}
          </span>
        </div>

        {/* Tunnel endpoint */}
        <div style={{ fontSize: '0.82em', color: 'var(--text-2)' }}>
          {transport === 'websocket' ? 'WebSocket' : 'gRPC'}: <code>{addr}</code>
          {tunnelStatus?.connected_at && (
            <span style={{ marginLeft: 12 }}>
              · connected {relativeTime(tunnelStatus.connected_at)}
            </span>
          )}
        </div>

        {/* API key placeholder */}
        <code style={{
          display: 'block',
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

        {/* Enable toggle */}
        <label className="settings-field integration-toggle" style={{ cursor: saving ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
          <span>Public — visible to other agents on the network</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => void handleToggleEnabled(e.target.checked)}
            disabled={saving}
          />
        </label>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="settings-add-btn" onClick={startEditKey} disabled={saving}>Replace credentials</button>
          <button type="button" className="settings-remove-btn" onClick={() => void handleDisconnect()} disabled={saving}>Disconnect</button>
        </div>

        {localAgentID && (
          <div className="a2a-identity-inline">
            <span>Connected as:</span>
            <code>{localAgentID}</code>
            <Link className="settings-add-btn a2a-inline-link-btn" to={`/a2a?agent_id=${encodeURIComponent(localAgentID)}`}>
              View in registry
            </Link>
          </div>
        )}
        {!localAgentID && localAgentIDError && (
          <p className="settings-help" style={{ margin: 0 }}>
            {localAgentIDError}
          </p>
        )}
      </section>
    );
  }

  function renderConnectionLog() {
    return (
      <section className="settings-group a2a-config-block" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 8px' }}>Connection log</h3>
        <ConnectionLog entries={logEntries} logRef={logRef} />
      </section>
    );
  }

  function renderInboundProjectPicker() {
    return (
      <section className="settings-group a2a-config-block" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 4px' }}>Base project for inbound sessions</h3>
        <p className="settings-help" style={{ marginBottom: 10 }}>
          Inbound A2A requests will be assigned to this project. Leave empty for no project.
        </p>
        <label className="settings-field" style={{ gap: 6 }}>
          <span>Project</span>
          <select
            value={inboundProjectID}
            onChange={e => {
              setInboundProjectID(e.target.value);
              void handleSaveInboundProject(e.target.value);
            }}
            disabled={savingProject}
          >
            <option value="">— No project —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {savingProject && <span style={{ fontSize: '0.82em', color: 'var(--text-2)' }}>Saving…</span>}
      </section>
    );
  }

  function renderInboundSessions() {
    return (
      <section className="a2a-config-block">
        <div className="integration-form-title-row" style={{ marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Inbound sessions</h3>
          <button
            type="button"
            className="settings-add-btn"
            style={{ fontSize: '0.78em', padding: '2px 8px' }}
            onClick={() => void loadInboundSessions()}
            disabled={sessionsLoading}
          >
            {sessionsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p className="settings-help" style={{ marginBottom: 14 }}>
          Sessions created from inbound A2A requests.
        </p>

        {sessionsLoading && inboundSessions.length === 0 ? (
          <div className="sessions-loading">Loading…</div>
        ) : inboundSessions.length === 0 ? (
          <p className="settings-help" style={{ fontStyle: 'italic' }}>No inbound sessions yet.</p>
        ) : (
          <div className="mcp-server-list">
            {inboundSessions.map(sess => (
              <article key={sess.id} className="integration-card mcp-server-card">
                <div className="integration-card-headline">
                  <div className="integration-card-title-wrap">
                    <h3 style={{ display: 'flex', alignItems: 'center' }}>
                      {statusDot(sess.status)}
                      {sess.a2a_source_agent_name || 'Unknown agent'}
                    </h3>
                    <span className="integration-mode-chip">{sess.status}</span>
                  </div>
                  <span className="integration-updated">{relativeTime(sess.updated_at)}</span>
                </div>

                {sess.title && (
                  <p style={{ margin: '6px 0 4px', color: 'var(--text-2)', fontSize: '0.88em', lineHeight: 1.5, fontStyle: 'italic' }}>
                    "{sess.title}"
                  </p>
                )}

                <div className="mcp-server-meta">
                  <code style={{ fontSize: '0.78em', color: 'var(--text-2)' }}>
                    {sess.a2a_source_agent_id && <>agent: {sess.a2a_source_agent_id} · </>}
                    session: {sess.id} · started {relativeTime(sess.created_at)}
                  </code>
                </div>

                <div className="integration-card-actions" style={{ marginTop: 8 }}>
                  <a
                    href={`/chat/${sess.id}`}
                    className="settings-add-btn"
                    style={{ textDecoration: 'none', display: 'inline-block' }}
                    onClick={e => {
                      e.preventDefault();
                      // Navigate via React Router if available, otherwise direct
                      window.location.href = `/chat/${sess.id}`;
                    }}
                  >
                    Open session
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  // ---- Main render ----

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>🤖 My Agent</h1>
      </div>

      <div className="page-content page-content-narrow settings-sections">
        <p className="settings-help">
          Control how your agent participates in the A2A network. When connected and active, other agents on the Square registry can discover and contact yours.
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
            {(!isConfigured || isEditingKey)
              ? renderConnectForm(isEditingKey)
              : renderConnectedPanel()
            }

            {isConfigured && !isEditingKey && (
              <>
                {renderConnectionLog()}
                {renderInboundProjectPicker()}
                {renderInboundSessions()}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default A2AMyAgentView;
