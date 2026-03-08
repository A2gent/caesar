import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createIntegration,
  deleteIntegration,
  fetchHealthInfo,
  getA2ATunnelStatus,
  getA2ATunnelStatusStreamUrl,
  getParentApiBaseUrl,
  listIntegrations,
  updateIntegration,
  type Integration,
  type TunnelLogEntry,
  type TunnelState,
  type TunnelStatus,
} from './api';
import {
  clearStoredLocalA2AAgentID,
  fetchRegistrySelfAgent,
  getStoredA2ARegistryOwnerEmail,
  getStoredA2ARegistryURL,
  getStoredLocalA2AAgentID,
  storeLocalA2AAgentID,
} from './a2aIdentity';

const DEFAULT_SQUARE_GRPC_ADDR = 'a2gent.net:9001';

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

  const [localAgentID, setLocalAgentID] = useState<string>(getStoredLocalA2AAgentID());
  const [localAgentIDError, setLocalAgentIDError] = useState<string | null>(null);
  const [isContainerizedAgent, setIsContainerizedAgent] = useState(false);

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

  const loadHealthInfo = useCallback(async () => {
    const hasParentAgentMarker = getParentApiBaseUrl().trim() !== '';
    try {
      const health = await fetchHealthInfo();
      // Backward-compatible detection:
      // - new backends: `containerized`
      // - child docker safe mode: `docker_safe_mode`
      // - UI-switched subagent sessions: parent URL marker
      setIsContainerizedAgent(
        Boolean(health.containerized) ||
        Boolean(health.docker_safe_mode) ||
        hasParentAgentMarker,
      );
    } catch {
      // Fallback when health endpoint is older/unreachable.
      setIsContainerizedAgent(hasParentAgentMarker);
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
    void loadHealthInfo();
    void loadTunnelStatus();
    startSSE();
    return () => stopSSE();
  }, [loadHealthInfo, loadIntegration, loadTunnelStatus, startSSE, stopSSE]);

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

  // ---- Handlers ----

  const handleConnect = async () => {
    const key = apiKeyInput.trim();
    const transport = transportInput;
    const grpcAddr = grpcAddrInput.trim() || (integration?.config?.square_grpc_addr ?? DEFAULT_SQUARE_GRPC_ADDR);
    const wsUrl = wsUrlInput.trim() || (integration?.config?.square_ws_url ?? '');
    if (!key) { setError('API key is required.'); return; }
    if (transport === 'grpc' && !grpcAddr) { setError('Square gRPC address is required (e.g. a2gent.net:9001).'); return; }
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
        owner_email: (integration?.config?.owner_email ?? '').trim() || getStoredA2ARegistryOwnerEmail(),
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

  const startEditKey = () => {
    setApiKeyInput('');
    setGrpcAddrInput(integration?.config?.square_grpc_addr ?? DEFAULT_SQUARE_GRPC_ADDR);
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

        {!isContainerizedAgent && (
          <div className="a2a-security-warning">
            <strong>Security warning:</strong> This agent may be running directly on your host (not in Docker). Publishing it to A2A can expose host-level tools and files to remote control if compromised.
            <span>
              Recommended: use <Link to="/a2a/local-agents">Local agents</Link> (Dockerized) and connect those containers to the registry instead.
            </span>
          </div>
        )}

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
              placeholder={DEFAULT_SQUARE_GRPC_ADDR}
              autoComplete="off"
              disabled={saving}
              onKeyDown={e => { if (e.key === 'Enter') void handleConnect(); }}
            />
            <span className="settings-help" style={{ margin: 0 }}>
              The host:port of Square&apos;s gRPC tunnel server (e.g. <code>{DEFAULT_SQUARE_GRPC_ADDR}</code>).
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

        {!isContainerizedAgent && (
          <div className="a2a-security-warning">
            <strong>Security warning:</strong> This endpoint is publicly reachable through the A2A network. If this agent is not isolated in Docker, a compromise can impact your host machine.
            <span>
              Recommended: run and publish only <Link to="/a2a/local-agents">Dockerized Local agents</Link> for safer isolation.
            </span>
          </div>
        )}

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
            <button onClick={() => setSuccess(null)} className="success-dismiss">×</button>
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default A2AMyAgentView;
