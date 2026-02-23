import { useEffect, useMemo, useState } from 'react';
import {
  createMCPServer,
  deleteMCPServer,
  listMCPServers,
  testMCPServer,
  updateMCPServer,
  type MCPServer,
  type MCPServerRequest,
  type MCPServerTestResponse,
} from './api';
import { EmptyState, EmptyStateTitle } from './EmptyState';

function parseNonEmptyLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function parseArgsLines(value: string): string[] {
  const out: string[] = [];
  for (const line of parseNonEmptyLines(value)) {
    const parts = line
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item !== '');
    if (parts.length === 0) {
      continue;
    }
    out.push(...parts);
  }
  return out;
}

function parseKeyValueLines(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of parseNonEmptyLines(value)) {
    const idx = line.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    if (!key) {
      continue;
    }
    out[key] = line.slice(idx + 1).trim();
  }
  return out;
}

function toKeyValueText(values?: Record<string, string>): string {
  if (!values || Object.keys(values).length === 0) {
    return '';
  }
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function toLinesText(values?: string[]): string {
  if (!values || values.length === 0) {
    return '';
  }
  return values.join('\n');
}

const DEFAULT_TIMEOUT_SECONDS = 60;

function MCPServersView() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [cwd, setCwd] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(DEFAULT_TIMEOUT_SECONDS);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResultsByServerId, setTestResultsByServerId] = useState<Record<string, MCPServerTestResponse>>({});

  const sortedServers = useMemo(
    () => [...servers].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [servers],
  );

  const loadServers = async () => {
    setLoading(true);
    try {
      const data = await listMCPServers();
      setServers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadServers();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCommand('');
    setArgsText('');
    setEnvText('');
    setCwd('');
    setTimeoutSeconds(DEFAULT_TIMEOUT_SECONDS);
  };

  const validateForm = (): string | null => {
    if (!name.trim()) {
      return 'Name is required.';
    }
    if (timeoutSeconds < 1 || timeoutSeconds > 120) {
      return 'Timeout must be between 1 and 120 seconds.';
    }
    if (!command.trim()) {
      return 'Command is required for local MCP servers.';
    }
    return null;
  };

  const buildPayload = (): MCPServerRequest => {
    return {
      name: name.trim(),
      transport: 'stdio',
      enabled: true,
      timeout_seconds: timeoutSeconds,
      command: command.trim(),
      args: parseArgsLines(argsText),
      env: parseKeyValueLines(envText),
      cwd: cwd.trim(),
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const validation = validateForm();
    if (validation) {
      setError(validation);
      return;
    }

    const payload = buildPayload();
    setSaving(true);
    try {
      if (editingId) {
        await updateMCPServer(editingId, payload);
        setSuccess('MCP server updated.');
      } else {
        const created = await createMCPServer(payload);
        const result = await testMCPServer(created.id);
        setTestResultsByServerId((prev) => ({ ...prev, [created.id]: result }));
        if (result.success) {
          setSuccess('MCP server added and tested.');
        } else {
          setError(result.message || 'MCP server added but test failed');
        }
      }
      resetForm();
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save MCP server');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (server: MCPServer) => {
    setEditingId(server.id);
    setName(server.name);
    setCommand(server.command || '');
    setArgsText(toLinesText(server.args));
    setEnvText(toKeyValueText(server.env));
    setCwd(server.cwd || '');
    setTimeoutSeconds(server.timeout_seconds || DEFAULT_TIMEOUT_SECONDS);
    setError(null);
    setSuccess(null);
  };

  const handleDelete = async (server: MCPServer) => {
    if (!confirm(`Remove MCP server \"${server.name}\"?`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await deleteMCPServer(server.id);
      if (editingId === server.id) {
        resetForm();
      }
      setTestResultsByServerId((prev) => {
        if (!prev[server.id]) {
          return prev;
        }
        const next = { ...prev };
        delete next[server.id];
        return next;
      });
      setSuccess('MCP server removed.');
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete MCP server');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (server: MCPServer) => {
    setError(null);
    setSuccess(null);
    setTestingId(server.id);
    try {
      const result = await testMCPServer(server.id);
      setTestResultsByServerId((prev) => ({ ...prev, [server.id]: result }));
      await loadServers();
      if (result.success) {
        setSuccess(result.message || 'MCP server test succeeded.');
      } else {
        setError(result.message || 'MCP server test failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MCP server test failed');
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleEnabled = async (server: MCPServer, nextEnabled: boolean) => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const payload: MCPServerRequest = {
        name: server.name,
        transport: 'stdio',
        enabled: nextEnabled,
        timeout_seconds: server.timeout_seconds || DEFAULT_TIMEOUT_SECONDS,
        command: server.command || '',
        args: server.args || [],
        env: server.env || {},
        cwd: server.cwd || '',
      };
      await updateMCPServer(server.id, payload);
      setSuccess(`MCP server ${nextEnabled ? 'enabled' : 'disabled'}.`);
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update MCP server state');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>MCP Servers</h1>
      </div>

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

      <div className="page-content page-content-narrow settings-sections">
        <p className="settings-help">
          Configure local MCP server commands, run connectivity/tool discovery tests, inspect logs, and estimate token footprint.
        </p>

        <form className="integration-form" onSubmit={handleSubmit}>
          <div className="integration-form-title-row">
            <h3>{editingId ? 'Edit MCP server' : 'Add MCP server'}</h3>
            {editingId && (
              <button type="button" className="settings-remove-btn" onClick={resetForm}>
                Cancel edit
              </button>
            )}
          </div>

          <div className="settings-group">
            <label className="settings-field">
              <span>Name</span>
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Context7" />
            </label>

            <label className="settings-field">
              <span>Test timeout (seconds)</span>
              <input
                className="mcp-timeout-input"
                type="number"
                min={1}
                max={120}
                value={timeoutSeconds}
                onChange={(event) => setTimeoutSeconds(Number.parseInt(event.target.value || '0', 10))}
              />
            </label>

            <label className="settings-field">
              <span>Command</span>
              <input type="text" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" />
            </label>

            <label className="settings-field">
              <span>Args (one per line)</span>
              <textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={4} placeholder="-y&#10;@upstash/context7-mcp@latest" />
            </label>

            <label className="settings-field">
              <span>Working directory (optional)</span>
              <input type="text" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/Users/artjom/git/a2gent" />
            </label>

            <label className="settings-field">
              <span>Environment vars (KEY=VALUE per line)</span>
              <textarea value={envText} onChange={(event) => setEnvText(event.target.value)} rows={4} placeholder="EXAMPLE_KEY=value" />
            </label>
          </div>

          <div className="mcp-form-actions">
            <button type="submit" className="settings-add-btn" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save MCP server' : 'Add MCP server'}
            </button>
          </div>
        </form>

        {loading ? (
          <div className="sessions-loading">Loading MCP servers...</div>
        ) : (
          <div className="mcp-server-list">
            {sortedServers.length === 0 ? (
              <EmptyState className="mcp-empty-state">
                <EmptyStateTitle>No MCP servers configured yet.</EmptyStateTitle>
              </EmptyState>
            ) : (
              sortedServers.map((server) => {
                const result = testResultsByServerId[server.id];
                return (
                  <article key={server.id} className="integration-card mcp-server-card">
                    <div className="integration-card-headline">
                      <div className="integration-card-title-wrap">
                        <h3>{server.name}</h3>
                        <span className="integration-mode-chip">local command</span>
                        {typeof server.last_estimated_tokens === 'number' ? <span className="integration-mode-chip">tokens: {server.last_estimated_tokens}</span> : null}
                        {typeof server.last_tool_count === 'number' ? <span className="integration-mode-chip">tools: {server.last_tool_count}</span> : null}
                      </div>
                      <span className="integration-updated">Updated {new Date(server.updated_at).toLocaleString()}</span>
                    </div>

                    <div className="mcp-server-meta">
                      <code>{[server.command || '', ...(server.args || [])].join(' ').trim()}</code>
                    </div>

                    <label className="mcp-card-toggle">
                      <input type="checkbox" checked={server.enabled} disabled={saving} onChange={(event) => handleToggleEnabled(server, event.target.checked)} />
                      <span>Enabled</span>
                    </label>

                    {server.last_test_at ? (
                      <div className="mcp-last-test-line">
                        Last test: {new Date(server.last_test_at).toLocaleString()}
                        {server.last_test_success === true ? ' (success)' : server.last_test_success === false ? ' (failed)' : ''}
                      </div>
                    ) : null}

                    <div className="integration-card-actions">
                      <button type="button" className="settings-add-btn" onClick={() => handleTest(server)} disabled={testingId === server.id || saving}>
                        {testingId === server.id ? 'Testing...' : 'Test'}
                      </button>
                      <button type="button" className="settings-add-btn" onClick={() => handleEdit(server)} disabled={saving}>
                        Edit
                      </button>
                      <button type="button" className="settings-remove-btn" onClick={() => handleDelete(server)} disabled={saving}>
                        Remove
                      </button>
                    </div>

                    {result ? (
                      <section className="mcp-test-result">
                        <h3>Test result</h3>
                        <p>{result.message}</p>
                        <div className="mcp-token-summary">
                          <span>Total estimated tokens: {result.estimated_tokens}</span>
                          <span>Metadata: {result.estimated_metadata_tokens}</span>
                          <span>Tools: {result.estimated_tools_tokens}</span>
                          <span>Tools exposed: {result.tool_count}</span>
                          <span>Duration: {result.duration_ms} ms</span>
                        </div>

                        <details open>
                          <summary>Exposed tools</summary>
                          <pre>{JSON.stringify(result.tools || [], null, 2)}</pre>
                        </details>

                        <details>
                          <summary>Server info and capabilities</summary>
                          <pre>{JSON.stringify({ server_info: result.server_info || {}, capabilities: result.capabilities || {} }, null, 2)}</pre>
                        </details>

                        <details open>
                          <summary>Captured logs</summary>
                          <pre>{(result.logs || []).join('\n') || 'No logs captured.'}</pre>
                        </details>
                      </section>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MCPServersView;
