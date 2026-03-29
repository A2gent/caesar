import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  buildLocalDockerAgentImage,
  createLocalDockerAgent,
  listProjects,
  type Project,
} from './api';
import { setAgentEmoji } from './agentVisuals';

function A2ACreateLocalAgentView() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('🐳');
  const [newPort, setNewPort] = useState('');
  const [newImage, setNewImage] = useState('a2gent-brute:latest');
  const [newAgentKind, setNewAgentKind] = useState('');
  const [newSystemPrompt, setNewSystemPrompt] = useState('');
  const [newSessionID, setNewSessionID] = useState('');
  const [newProjectID, setNewProjectID] = useState('');
  const [newProjectMountMode, setNewProjectMountMode] = useState<'ro' | 'rw'>('ro');
  const [rebuildNoCache, setRebuildNoCache] = useState(false);
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
    setSuccess(null);
    try {
      await fn();
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
  };

  const handleCreate = () => {
    void runAction('create', async () => {
      const hostPort = Number.parseInt(newPort, 10);
      const created = await createLocalDockerAgent({
        name: newName.trim() || undefined,
        host_port: Number.isFinite(hostPort) ? hostPort : undefined,
        image: newImage.trim() || undefined,
        agent_kind: newAgentKind.trim() || undefined,
        system_prompt: newSystemPrompt.trim() || undefined,
        session_id: newSessionID.trim() || undefined,
        project_id: newProjectID.trim() || undefined,
        project_mount_mode: newProjectID.trim() ? newProjectMountMode : undefined,
      });
      setAgentEmoji('local', newEmoji, created.id);
      navigate('/a2a/local-agents');
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

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Create Local Agent</h1>
      </div>
      <div className="page-content page-content-narrow settings-sections">
        {error && (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError(null)} className="error-dismiss">×</button>
          </div>
        )}
        {success && (
          <div className="success-banner">
            {success}
            <button type="button" onClick={() => setSuccess(null)} className="success-dismiss">×</button>
          </div>
        )}

        <section className="a2a-config-block local-agents-form-block">
          <div className="integration-form-title-row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Start a local agent</h3>
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
            <label className="settings-field" style={{ gap: 4 }}>
              <span>Agent kind / role (optional)</span>
              <input
                type="text"
                value={newAgentKind}
                onChange={e => setNewAgentKind(e.target.value)}
                placeholder="researcher, planner, reviewer..."
              />
            </label>
            <label className="settings-field" style={{ gap: 4, gridColumn: '1 / -1' }}>
              <span>Initial system prompt (optional)</span>
              <textarea
                value={newSystemPrompt}
                onChange={e => setNewSystemPrompt(e.target.value)}
                placeholder="You are a focused code reviewer. Prioritize correctness risks and actionable findings."
                rows={4}
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
      </div>
    </div>
  );
}

export default A2ACreateLocalAgentView;
