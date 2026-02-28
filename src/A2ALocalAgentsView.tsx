import { useCallback, useEffect, useState } from 'react';
import {
  buildLocalDockerAgentImage,
  createLocalDockerAgent,
  getLocalDockerAgentLogs,
  listLocalDockerAgents,
  registerLocalDockerAgent,
  removeLocalDockerAgent,
  startLocalDockerAgent,
  stopLocalDockerAgent,
  type LocalDockerAgent,
  type RegisterLocalDockerAgentResponse,
} from './api';
import { getStoredA2ARegistryOwnerEmail, getStoredA2ARegistryURL } from './a2aIdentity';

function relativeTime(iso?: string): string {
  if (!iso) return 'unknown';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function A2ALocalAgentsView() {
  const [agents, setAgents] = useState<LocalDockerAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newPort, setNewPort] = useState('');
  const [newImage, setNewImage] = useState('a2gent-brute:latest');
  const [rebuildNoCache, setRebuildNoCache] = useState(false);

  const [registeringID, setRegisteringID] = useState<string | null>(null);
  const [lastRegisterResult, setLastRegisterResult] = useState<RegisterLocalDockerAgentResponse | null>(null);

  const [logsByID, setLogsByID] = useState<Record<string, string>>({});
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({});

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listLocalDockerAgents();
      setAgents(resp.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load local Docker agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const runAction = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setSuccess(null);
    try {
      await fn();
      await loadAgents();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      if (message.includes("pull access denied") && message.includes("a2gent-brute")) {
        setError(`${message}\nTip: Build the image first using "Build/Rebuild image".`);
        return;
      }
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [loadAgents]);

  const handleCreate = () => {
    void runAction('create', async () => {
      const hostPort = Number.parseInt(newPort, 10);
      await createLocalDockerAgent({
        name: newName.trim() || undefined,
        host_port: Number.isFinite(hostPort) ? hostPort : undefined,
        image: newImage.trim() || undefined,
      });
      setNewName('');
      setNewPort('');
      setSuccess('Local agent container started.');
    });
  };

  const handleBuildImage = () => {
    void runAction('build-image', async () => {
      const resp = await buildLocalDockerAgentImage({
        image: newImage.trim() || undefined,
        no_cache: rebuildNoCache,
      });
      setSuccess(`Built ${resp.image} from ${resp.dockerfile}.`);
    });
  };

  const handleLogs = (agent: LocalDockerAgent) => {
    const isOpen = !!openLogs[agent.id];
    setOpenLogs(prev => ({ ...prev, [agent.id]: !isOpen }));
    if (isOpen || logsByID[agent.id]) {
      return;
    }
    void runAction(`logs:${agent.id}`, async () => {
      const resp = await getLocalDockerAgentLogs(agent.id, 200);
      setLogsByID(prev => ({ ...prev, [agent.id]: resp.logs }));
    });
  };

  const handleRefreshLogs = (agent: LocalDockerAgent) => {
    void runAction(`logs:${agent.id}`, async () => {
      const resp = await getLocalDockerAgentLogs(agent.id, 200);
      setLogsByID(prev => ({ ...prev, [agent.id]: resp.logs }));
    });
  };

  const handleRegister = (agent: LocalDockerAgent) => {
    const ownerEmail = getStoredA2ARegistryOwnerEmail();
    if (!ownerEmail.trim()) {
      setError('Owner email is required. Set it in A2 Registry view, then try Register again.');
      return;
    }

    void runAction(`register:${agent.id}`, async () => {
      setRegisteringID(agent.id);
      const result = await registerLocalDockerAgent(agent.id, {
        owner_email: ownerEmail.trim(),
        registry_url: getStoredA2ARegistryURL().trim() || undefined,
        agent_name: agent.name,
        description: `Local dockerized Brute agent (${agent.name})`,
        configure_container: true,
      });
      setLastRegisterResult(result);
      setSuccess(`Registered ${result.registry_agent_name} in A2 Registry.`);
      setRegisteringID(null);
    });
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>🐳 Local Agents</h1>
      </div>

      <div className="page-content page-content-narrow settings-sections">
        <p className="settings-help">
          Manage local Dockerized Brute agents: list, start, stop, remove, inspect logs, and register them in A2 Registry.
        </p>

        {error && (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError(null)} className="error-dismiss">×</button>
          </div>
        )}

        {success && (
          <div className="success-banner">
            {success}
            <button type="button" onClick={() => setSuccess(null)} className="error-dismiss">×</button>
          </div>
        )}

        <section className="a2a-config-block local-agents-form-block">
          <div className="integration-form-title-row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Start a local agent</h3>
            <button type="button" className="settings-add-btn" onClick={() => void loadAgents()} disabled={loading || busy !== null}>
              Refresh
            </button>
          </div>

          <div className="local-agents-form-grid">
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Name (optional)</span>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="a2gent-local-..."
              />
            </label>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Host port (optional)</span>
              <input
                type="number"
                value={newPort}
                onChange={e => setNewPort(e.target.value)}
                placeholder="18080"
              />
            </label>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Image</span>
              <input
                type="text"
                value={newImage}
                onChange={e => setNewImage(e.target.value)}
                placeholder="a2gent-brute:latest"
              />
            </label>
          </div>

          <div style={{ marginTop: 10 }}>
            <button type="button" className="settings-add-btn" onClick={handleCreate} disabled={busy !== null}>
              {busy === 'create' ? 'Starting…' : 'Start container'}
            </button>
            <button
              type="button"
              className="settings-add-btn"
              onClick={handleBuildImage}
              disabled={busy !== null}
              style={{ marginLeft: 8 }}
            >
              {busy === 'build-image' ? 'Building…' : 'Build/Rebuild image'}
            </button>
            <label className="settings-help" style={{ display: 'inline-flex', marginLeft: 12, gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={rebuildNoCache}
                onChange={e => setRebuildNoCache(e.target.checked)}
                disabled={busy !== null}
              />
              no cache
            </label>
          </div>
          <p className="settings-help" style={{ marginTop: 8, marginBottom: 0 }}>
            Run build once on new machines if image pull fails.
          </p>
        </section>

        <section className="a2a-config-block">
          <div className="integration-form-title-row" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Local Dockerized Brute agents</h3>
            <span className="settings-help" style={{ margin: 0 }}>
              {agents.length} container{agents.length === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <div className="sessions-loading">Loading…</div>
          ) : agents.length === 0 ? (
            <p className="settings-help" style={{ fontStyle: 'italic' }}>
              No local Brute containers found.
            </p>
          ) : (
            <div className="a2a-agent-list">
              {agents.map(agent => {
                const actionPrefix = busy?.startsWith(`start:${agent.id}`) || busy?.startsWith(`stop:${agent.id}`) || busy?.startsWith(`remove:${agent.id}`);
                return (
                  <article key={agent.id} className="a2a-agent-row">
                    <div className="a2a-agent-main">
                      <div className="a2a-agent-left">
                        <h3 className="a2a-agent-name" style={{ marginBottom: 2 }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: agent.running ? '#4caf82' : '#aeb7c7',
                              marginRight: 6,
                            }}
                          />
                          {agent.name}
                        </h3>
                        <div className="a2a-agent-chips">
                          <span className="integration-mode-chip">{agent.state}</span>
                          <span className="integration-mode-chip">{agent.image}</span>
                          {agent.managed && <span className="integration-mode-chip">managed</span>}
                          {agent.host_port && <span className="integration-mode-chip">:{agent.host_port}</span>}
                        </div>
                        <div className="a2a-agent-meta" style={{ marginTop: 8 }}>
                          <code>{agent.id.slice(0, 12)}</code>
                          <span>updated {relativeTime(agent.created_at)}</span>
                        </div>
                      </div>

                      <div className="a2a-agent-actions local-agents-actions">
                        {agent.running ? (
                          <button
                            type="button"
                            className="local-agent-icon-btn local-agent-icon-btn-stop"
                            onClick={() => void runAction(`stop:${agent.id}`, async () => {
                              await stopLocalDockerAgent(agent.id);
                              setSuccess(`Stopped ${agent.name}.`);
                            })}
                            disabled={busy !== null}
                            title="Stop"
                            aria-label="Stop container"
                          >
                            {busy === `stop:${agent.id}` ? '…' : '■'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="local-agent-icon-btn local-agent-icon-btn-start"
                            onClick={() => void runAction(`start:${agent.id}`, async () => {
                              await startLocalDockerAgent(agent.id);
                              setSuccess(`Started ${agent.name}.`);
                            })}
                            disabled={busy !== null}
                            title="Start"
                            aria-label="Start container"
                          >
                            {busy === `start:${agent.id}` ? '…' : '▶'}
                          </button>
                        )}

                        <button
                          type="button"
                          className="local-agent-icon-btn local-agent-icon-btn-register"
                          onClick={() => handleRegister(agent)}
                          disabled={busy !== null || registeringID === agent.id}
                          title="Register"
                          aria-label="Register in A2 Registry"
                        >
                          {busy === `register:${agent.id}` ? '…' : '📡'}
                        </button>

                        <button
                          type="button"
                          className="local-agent-icon-btn local-agent-icon-btn-logs"
                          onClick={() => handleLogs(agent)}
                          disabled={busy !== null && busy !== `logs:${agent.id}`}
                          title={openLogs[agent.id] ? 'Hide logs' : 'Show logs'}
                          aria-label={openLogs[agent.id] ? 'Hide logs' : 'Show logs'}
                        >
                          {busy === `logs:${agent.id}` ? '…' : '≡'}
                        </button>

                        <button
                          type="button"
                          className="local-agent-icon-btn local-agent-icon-btn-remove"
                          onClick={() => {
                            if (!confirm(`Remove container ${agent.name}?`)) return;
                            void runAction(`remove:${agent.id}`, async () => {
                              await removeLocalDockerAgent(agent.id, true);
                              setSuccess(`Removed ${agent.name}.`);
                            });
                          }}
                          disabled={busy !== null}
                          title="Remove"
                          aria-label="Remove container"
                        >
                          {busy === `remove:${agent.id}` ? '…' : '🗑'}
                        </button>

                        {actionPrefix && <span className="settings-help">Working…</span>}
                      </div>
                    </div>

                    {openLogs[agent.id] && (
                      <div className="local-agent-logs-wrap">
                        <div className="local-agent-logs-head">
                          <strong>Logs</strong>
                          <button
                            type="button"
                            className="settings-add-btn"
                            onClick={() => handleRefreshLogs(agent)}
                            disabled={busy !== null}
                            style={{ fontSize: '0.78em', padding: '2px 8px' }}
                          >
                            {busy === `logs:${agent.id}` ? 'Refreshing…' : 'Refresh'}
                          </button>
                        </div>
                        <pre className="local-agent-logs">{logsByID[agent.id] || 'No logs yet.'}</pre>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {lastRegisterResult && (
          <section className="a2a-config-block local-agents-form-block">
            <h3 style={{ margin: '0 0 8px' }}>Latest registration result</h3>
            <div className="local-agents-register-result">
              <div><strong>Registry agent:</strong> {lastRegisterResult.registry_agent_name} ({lastRegisterResult.registry_agent_id})</div>
              <div><strong>Container API:</strong> {lastRegisterResult.container_api_url}</div>
              <div><strong>API key:</strong> <code>{lastRegisterResult.registry_api_key}</code></div>
              <div>
                <strong>Container integration:</strong>{' '}
                {lastRegisterResult.container_configured ? 'configured' : 'not configured (agent still registered)'}
              </div>
              {lastRegisterResult.container_tunnel_state && (
                <div>
                  <strong>Container tunnel:</strong> {lastRegisterResult.container_tunnel_state}
                </div>
              )}
              {lastRegisterResult.container_tunnel_note && (
                <div>
                  <strong>Note:</strong> {lastRegisterResult.container_tunnel_note}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default A2ALocalAgentsView;
