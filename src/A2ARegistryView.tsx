import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listIntegrations } from './api';
import {
  clearStoredLocalA2AAgentID,
  fetchRegistrySelfAgent,
  getStoredFavoriteA2AAgents,
  getStoredA2ARegistryURL,
  getStoredLocalA2AAgentID,
  removeFavoriteA2AAgent,
  storeFavoriteA2AAgent,
  storeLocalA2AAgentID,
} from './a2aIdentity';

type AgentStatus = 'active' | 'inactive' | 'suspended';
type AgentType = 'personal' | 'business' | 'government';

interface DiscoveredAgent {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  visibility?: string;
  agent_type: AgentType;
  discoverable: boolean;
  price_per_request: number;
  currency: string;
  created_at: string;
}

interface DiscoveryResponse {
  agents: DiscoveredAgent[];
  total: number;
  page: number;
  page_size: number;
}

const MOCK_AGENTS: DiscoveredAgent[] = [
  {
    id: 'a1b2c3d4-0000-0000-0000-000000000001',
    name: 'ResearchBot',
    description: 'Specialises in deep web research, summarisation, and fact-checking. Supports multi-step research tasks with citation tracking.',
    status: 'active',
    visibility: 'public',
    agent_type: 'business',
    discoverable: true,
    price_per_request: 0.005,
    currency: 'USD',
    created_at: '2025-11-10T08:00:00Z',
  },
  {
    id: 'a1b2c3d4-0000-0000-0000-000000000002',
    name: 'CodeReviewer',
    description: 'Automated code review agent. Detects bugs, security issues, and style violations across 20+ programming languages.',
    status: 'active',
    visibility: 'public',
    agent_type: 'business',
    discoverable: true,
    price_per_request: 0.01,
    currency: 'USD',
    created_at: '2025-12-01T12:00:00Z',
  },
  {
    id: 'a1b2c3d4-0000-0000-0000-000000000003',
    name: 'DataAnalyst',
    description: 'Processes CSV/JSON datasets, runs statistical analyses, and produces charts and executive summaries.',
    status: 'inactive',
    visibility: 'public',
    agent_type: 'personal',
    discoverable: true,
    price_per_request: 0.002,
    currency: 'USD',
    created_at: '2026-01-05T09:30:00Z',
  },
  {
    id: 'a1b2c3d4-0000-0000-0000-000000000004',
    name: 'TranslatorPro',
    description: 'High-fidelity translation agent supporting 60+ languages. Preserves tone, idioms, and technical terminology.',
    status: 'active',
    visibility: 'public',
    agent_type: 'business',
    discoverable: true,
    price_per_request: 0.003,
    currency: 'USD',
    created_at: '2026-01-20T15:00:00Z',
  },
  {
    id: 'a1b2c3d4-0000-0000-0000-000000000005',
    name: 'SchedulerAssistant',
    description: 'Coordinates meetings, resolves calendar conflicts, and drafts invite emails across time zones.',
    status: 'active',
    visibility: 'public',
    agent_type: 'personal',
    discoverable: true,
    price_per_request: 0.001,
    currency: 'USD',
    created_at: '2026-02-01T11:00:00Z',
  },
];

function statusDot(status: AgentStatus) {
  const color = status === 'active' ? '#4caf82' : status === 'suspended' ? '#f25f5c' : '#aeb7c7';
  return (
    <span
      title={status}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function agentTypeLabel(type: AgentType) {
  const map: Record<AgentType, string> = {
    personal: 'Personal',
    business: 'Business',
    government: 'Government',
  };
  return map[type] ?? type;
}

function A2ARegistryView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const registryUrl = getStoredA2ARegistryURL();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<AgentType | ''>('');
  const [filterStatus, setFilterStatus] = useState<AgentStatus | ''>('');
  const [registryAPIKey, setRegistryAPIKey] = useState<string>('');
  const [localAgentID, setLocalAgentID] = useState<string>(getStoredLocalA2AAgentID());
  const [favoriteAgentIDs, setFavoriteAgentIDs] = useState<Set<string>>(() => new Set(getStoredFavoriteA2AAgents().map((item) => item.id)));

  useEffect(() => {
    const prefilled = searchParams.get('agent_id')?.trim();
    if (!prefilled) {
      return;
    }
    setSearch(prefilled);
  }, [searchParams]);

  useEffect(() => {
    const resolveSelfAgentID = async () => {
      try {
        const integrations = await listIntegrations();
        const integration = integrations.find(i => i.provider === 'a2_registry');
        const apiKey = integration?.config?.api_key?.trim() || '';
        if (!apiKey) {
          setRegistryAPIKey('');
          clearStoredLocalA2AAgentID();
          setLocalAgentID('');
          return;
        }
        setRegistryAPIKey(apiKey);
        const me = await fetchRegistrySelfAgent(registryUrl, apiKey);
        storeLocalA2AAgentID(me.id);
        setLocalAgentID(me.id);
      } catch {
        // Keep the last known value; non-fatal for listing.
      }
    };
    void resolveSelfAgentID();
  }, [registryUrl]);

  const handleListAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setUsingMock(false);

    const params = new URLSearchParams();
    if (search.trim()) params.set('name', search.trim());
    if (filterType) params.set('agent_type', filterType);
    if (filterStatus) params.set('status', filterStatus);
    params.set('page', '1');
    params.set('page_size', '20');

    const url = `${registryUrl}/agents/discover?${params}`;

    try {
      const headers: HeadersInit = registryAPIKey
        ? { Authorization: `Bearer ${registryAPIKey}` }
        : {};
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!resp.ok) {
        throw new Error(`Registry returned ${resp.status} ${resp.statusText}`);
      }
      const data = await resp.json() as DiscoveryResponse;
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not reach registry at ${registryUrl} — ${msg}`);

      const filtered = MOCK_AGENTS.filter(a => {
        if (search.trim() && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (filterType && a.agent_type !== filterType) return false;
        if (filterStatus && a.status !== filterStatus) return false;
        return true;
      });
      setResult({ agents: filtered, total: filtered.length, page: 1, page_size: 20 });
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, [registryUrl, search, filterType, filterStatus, registryAPIKey]);

  useEffect(() => {
    void handleListAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryUrl]);

  const agents = result?.agents ?? [];

  const toggleFavorite = (agent: DiscoveredAgent) => {
    if (favoriteAgentIDs.has(agent.id)) {
      removeFavoriteA2AAgent(agent.id);
      setFavoriteAgentIDs(new Set(getStoredFavoriteA2AAgents().map((item) => item.id)));
      return;
    }
    storeFavoriteA2AAgent({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      registry_url: registryUrl,
    });
    setFavoriteAgentIDs(new Set(getStoredFavoriteA2AAgents().map((item) => item.id)));
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>🌐 A2 Registry</h1>
      </div>

      <div className="page-content page-content-narrow settings-sections">
        <p className="settings-help">
          Browse and discover agents registered on the Square A2A network. Connect to a local or remote registry to list available agents and their capabilities.
        </p>

        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            className="settings-add-btn"
            onClick={() => navigate('/a2a/registry-settings')}
          >
            Open registry settings
          </button>
        </div>

        {/* Filters */}
        <section className="a2a-config-block">
          <div className="integration-form-title-row">
            <h3 style={{ margin: 0 }}>Filters</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Name</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name…"
                onKeyDown={e => { if (e.key === 'Enter') void handleListAgents(); }}
              />
            </label>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Type</span>
              <select value={filterType} onChange={e => setFilterType(e.target.value as AgentType | '')}>
                <option value="">All types</option>
                <option value="personal">Personal</option>
                <option value="business">Business</option>
                <option value="government">Government</option>
              </select>
            </label>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Status</span>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as AgentStatus | '')}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
          </div>
        </section>

        <div style={{ marginBottom: 24 }}>
          <button
            type="button"
            className="settings-add-btn"
            onClick={() => void handleListAgents()}
            disabled={loading}
            style={{ minWidth: 140 }}
          >
            {loading ? 'Connecting…' : '🔍 List agents'}
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            {error}
            <button onClick={() => setError(null)} className="error-dismiss">×</button>
          </div>
        )}

        {/* Mock data notice */}
        {usingMock && (
          <div
            className="success-banner"
            style={{ marginBottom: 16, background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            Registry is unreachable — showing <strong>mock data</strong> for design preview.
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            <div style={{ color: 'var(--text-2)', fontSize: '0.85em', marginBottom: 12 }}>
              {result.total} agent{result.total !== 1 ? 's' : ''} found
              {usingMock ? ' (mock)' : ` · page ${result.page}`}
            </div>

            {agents.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-2)' }}>
                No agents match the current filters.
              </div>
            ) : (
              <div className="a2a-agent-list">
                {agents.map(agent => (
                  <article key={agent.id} className="a2a-agent-row">
                    <div className="a2a-agent-main">
                      <div className="a2a-agent-left">
                        <h3 className="a2a-agent-name">
                          {statusDot(agent.status)}
                          {agent.name}
                        </h3>
                        <details className="a2a-agent-details">
                          <summary>Details</summary>
                          <div className="a2a-agent-chips">
                            <span className="integration-mode-chip">{agentTypeLabel(agent.agent_type)}</span>
                            <span className="integration-mode-chip">
                              {agent.discoverable ? 'visible to public' : 'hidden from public'}
                            </span>
                            {agent.price_per_request > 0 && (
                              <span className="integration-mode-chip">
                                ${agent.price_per_request.toFixed(3)}/{agent.currency}
                              </span>
                            )}
                          </div>
                          {agent.description && (
                            <p>{agent.description}</p>
                          )}
                          <div className="a2a-agent-meta">
                            <code>id: {agent.id}</code>
                            <span>Registered {new Date(agent.created_at).toLocaleDateString()}</span>
                          </div>
                        </details>
                      </div>
                      <div className="a2a-agent-actions">
                        <button
                          type="button"
                          className="settings-add-btn"
                          title={favoriteAgentIDs.has(agent.id) ? 'Remove favorite' : 'Add favorite'}
                          onClick={() => toggleFavorite(agent)}
                        >
                          {favoriteAgentIDs.has(agent.id) ? '★ Favorited' : '☆ Favorite'}
                        </button>
                        {agent.id === localAgentID ? (
                          <span
                            title="This is your connected local agent"
                            style={{
                              color: 'var(--text-2)',
                              fontSize: '0.9em',
                              whiteSpace: 'nowrap',
                              border: 'none',
                              background: 'transparent',
                              padding: 0,
                              margin: 0,
                            }}
                          >
                            🎉 Current agent
                          </span>
                        ) : (
                      <button
                        type="button"
                        className="settings-add-btn"
                        title="Contact this agent"
                        onClick={() =>
                          navigate(`/a2a/contact/${encodeURIComponent(agent.id)}`, {
                            state: { agent, forceNewSession: true },
                          })
                        }
                      >
                        Contact agent
                      </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {!result && !loading && (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-2)', fontSize: '0.9em' }}>
            Click <strong>List agents</strong> to query the registry.
          </div>
        )}
      </div>
    </div>
  );
}

export default A2ARegistryView;
