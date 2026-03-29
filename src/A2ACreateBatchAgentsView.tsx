import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createLocalDockerAgent,
  listProjects,
  type Project,
} from './api';
import { setAgentEmoji } from './agentVisuals';

interface BatchAgentSpec {
  name?: string;
  kind?: string;
  systemPrompt?: string;
}

function slugifyForContainerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseBatchAgentSpecs(raw: string): BatchAgentSpec[] {
  const specs: BatchAgentSpec[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const parts = line.split('|').map(part => part.trim());
    if (parts.length === 1) {
      specs.push({ kind: parts[0] });
      continue;
    }
    if (parts.length === 2) {
      specs.push({ kind: parts[0], systemPrompt: parts[1] });
      continue;
    }
    const [name, kind, ...promptParts] = parts;
    specs.push({ name, kind, systemPrompt: promptParts.join(' | ').trim() });
  }
  return specs;
}

function A2ACreateBatchAgentsView() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newEmoji, setNewEmoji] = useState('🐳');
  const [newImage, setNewImage] = useState('a2gent-brute:latest');
  const [newSessionID, setNewSessionID] = useState('');
  const [newProjectID, setNewProjectID] = useState('');
  const [newProjectMountMode, setNewProjectMountMode] = useState<'ro' | 'rw'>('ro');
  const [batchRolesSpec, setBatchRolesSpec] = useState('');
  const [batchNamePrefix, setBatchNamePrefix] = useState('a2gent-local');
  const [batchStartPort, setBatchStartPort] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await listProjects();
        if (!cancelled) {
          setProjects(data);
        }
      } catch {
        // Keep form usable even if projects fail to load
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const handleCreateBatch = () => {
    void runAction('create-batch', async () => {
      const specs = parseBatchAgentSpecs(batchRolesSpec);
      if (specs.length === 0) {
        throw new Error('Enter at least one role line for batch creation.');
      }
      const prefix = batchNamePrefix.trim() || 'a2gent-local';
      const parsedStartPort = Number.parseInt(batchStartPort, 10);
      const useSequentialPorts = Number.isFinite(parsedStartPort);
      const sessionID = newSessionID.trim() || undefined;
      const projectID = newProjectID.trim() || undefined;
      const image = newImage.trim() || undefined;

      const timestampSuffix = Date.now();

      for (let index = 0; index < specs.length; index += 1) {
        const spec = specs[index];
        const fallbackToken = slugifyForContainerName(spec.kind || '') || `agent-${index + 1}`;
        const generatedName = `${prefix}-${timestampSuffix}-${index + 1}-${fallbackToken}`;
        const created = await createLocalDockerAgent({
          name: (spec.name || '').trim() || generatedName,
          host_port: useSequentialPorts ? (parsedStartPort + index) : undefined,
          image,
          agent_kind: (spec.kind || '').trim() || undefined,
          system_prompt: (spec.systemPrompt || '').trim() || undefined,
          session_id: sessionID,
          project_id: projectID,
          project_mount_mode: projectID ? newProjectMountMode : undefined,
        });
        setAgentEmoji('local', newEmoji, created.id);
      }
      navigate('/a2a/local-agents');
    });
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Batch Create Agents</h1>
      </div>

      <div className="page-content page-content-narrow settings-sections">
        {error && (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError(null)} className="error-dismiss">×</button>
          </div>
        )}

        <section className="a2a-config-block local-agents-form-block">
          <div className="integration-form-title-row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Batch create role-based agents</h3>
          </div>
          <div className="local-agents-form-grid">
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Emoji</span>
              <input
                type="text"
                value={newEmoji}
                onChange={e => setNewEmoji(e.target.value)}
                placeholder="🐳"
                maxLength={4}
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
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Name prefix</span>
              <input
                type="text"
                value={batchNamePrefix}
                onChange={e => setBatchNamePrefix(e.target.value)}
                placeholder="a2gent-local"
              />
            </label>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Start port (optional, increments)</span>
              <input
                type="number"
                value={batchStartPort}
                onChange={e => setBatchStartPort(e.target.value)}
                placeholder="18100"
              />
            </label>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Session ID (optional)</span>
              <input
                type="text"
                value={newSessionID}
                onChange={e => setNewSessionID(e.target.value)}
                placeholder="session-uuid"
              />
            </label>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Project access (optional)</span>
              <select
                value={newProjectID}
                onChange={e => setNewProjectID(e.target.value)}
              >
                <option value="">No project mount</option>
                {projects
                  .filter(project => (project.folder || '').trim() !== '')
                  .map(project => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Project permission</span>
              <select
                value={newProjectMountMode}
                onChange={e => setNewProjectMountMode(e.target.value === 'rw' ? 'rw' : 'ro')}
                disabled={newProjectID.trim() === ''}
              >
                <option value="ro">Read-only</option>
                <option value="rw">Read-write</option>
              </select>
            </label>
            <label className="settings-field" style={{ gap: 4, gridColumn: '1 / -1' }}>
              <span>Roles spec (one per line)</span>
              <textarea
                value={batchRolesSpec}
                onChange={e => setBatchRolesSpec(e.target.value)}
                placeholder={'researcher | You focus on source-backed research.\nplanner | You create concise implementation plans.\nreviewer | You review code for correctness and regressions.'}
                rows={6}
              />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="settings-add-btn" onClick={handleCreateBatch} disabled={busy !== null}>
              {busy === 'create-batch' ? 'Starting…' : 'Start batch'}
            </button>
          </div>
          <p className="settings-help" style={{ marginTop: 8, marginBottom: 0 }}>
            Format: <code>kind</code>, or <code>kind | system prompt</code>, or <code>name | kind | system prompt</code>.
          </p>
        </section>
      </div>
    </div>
  );
}

export default A2ACreateBatchAgentsView;