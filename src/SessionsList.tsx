import { useState, useEffect, useCallback, type DragEvent } from 'react';
import ChatInput from './ChatInput';
import {
  browseSkillDirectories,
  createProject,
  createSession,
  deleteProject,
  deleteSession,
  listProjects,
  listProviders,
  listSessions,
  updateProject,
  updateSessionProject,
  type LLMProviderType,
  type MindTreeEntry,
  type Project,
  type ProviderConfig,
  type Session,
} from './api';
import { THINKING_PROJECT_ID } from './thinking';

const LAST_PROVIDER_STORAGE_KEY = 'a2gent.sessions.lastProvider';
const LAST_PROJECT_STORAGE_KEY = 'a2gent.sessions.lastProject';

interface SessionsListProps {
  onSelectSession: (sessionId: string, initialMessage?: string) => void;
}

function getParentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  if (trimmed === '' || trimmed === '/') {
    return '/';
  }

  const windowsRootMatch = /^[a-zA-Z]:$/.exec(trimmed);
  if (windowsRootMatch) {
    return `${trimmed}\\`;
  }

  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (separatorIndex < 0) {
    return trimmed;
  }

  if (separatorIndex === 0) {
    return '/';
  }

  return trimmed.slice(0, separatorIndex);
}

function SessionsList({ onSelectSession }: SessionsListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType | ''>('');
  const [hasLoadedProviders, setHasLoadedProviders] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [hasLoadedProjects, setHasLoadedProjects] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectFolders, setNewProjectFolders] = useState('');
  const [draggingSessionID, setDraggingSessionID] = useState<string | null>(null);
  const [dragOverSectionKey, setDragOverSectionKey] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [projectFolderDraft, setProjectFolderDraft] = useState<string[]>([]);
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<MindTreeEntry[]>([]);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listSessions();
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setHasLoadedProjects(true);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const data = await listProviders();
        setProviders(data);
        let storedProvider: LLMProviderType | '' = '';
        try {
          storedProvider = (localStorage.getItem(LAST_PROVIDER_STORAGE_KEY) as LLMProviderType | null) || '';
        } catch {
          storedProvider = '';
        }
        if (storedProvider && data.some((provider) => provider.type === storedProvider)) {
          setSelectedProvider(storedProvider);
          return;
        }
        const active = data.find((provider) => provider.is_active);
        if (active) {
          setSelectedProvider(active.type);
          return;
        }
        if (data.length > 0) {
          setSelectedProvider(data[0].type);
        }
      } catch (err) {
        console.error('Failed to load providers:', err);
      } finally {
        setHasLoadedProviders(true);
      }
    };
    loadProviders();
  }, []);

  useEffect(() => {
    if (!hasLoadedProviders) {
      return;
    }
    try {
      if (selectedProvider) {
        localStorage.setItem(LAST_PROVIDER_STORAGE_KEY, selectedProvider);
      } else {
        localStorage.removeItem(LAST_PROVIDER_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [hasLoadedProviders, selectedProvider]);

  useEffect(() => {
    try {
      const storedProjectId = localStorage.getItem(LAST_PROJECT_STORAGE_KEY) || '';
      if (storedProjectId) {
        setSelectedProjectId(storedProjectId);
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedProjects) {
      return;
    }
    if (!projects.some((project) => project.id === selectedProjectId) && selectedProjectId !== '') {
      setSelectedProjectId('');
    }
  }, [hasLoadedProjects, projects, selectedProjectId]);

  useEffect(() => {
    try {
      if (selectedProjectId) {
        localStorage.setItem(LAST_PROJECT_STORAGE_KEY, selectedProjectId);
      } else {
        localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [selectedProjectId]);

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Delete this session?')) return;
    
    try {
      await deleteSession(sessionId);
      await loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  };

  const handleStartSession = async (message: string) => {
    setIsCreatingSession(true);
    setError(null);

    try {
      const created = await createSession({
        agent_id: 'build',
        provider: selectedProvider || undefined,
        project_id: selectedProjectId || undefined,
      });
      onSelectSession(created.id, message);
    } catch (err) {
      console.error('Failed to create session from sessions list:', err);
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleAssignProject = async (sessionId: string, projectId?: string) => {
    try {
      await updateSessionProject(sessionId, projectId);
      await loadSessions();
    } catch (err) {
      console.error('Failed to update session project:', err);
      setError(err instanceof Error ? err.message : 'Failed to update session project');
    }
  };

  const handleSessionDragStart = (event: DragEvent<HTMLElement>, sessionId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sessionId);
    setDraggingSessionID(sessionId);
  };

  const handleSessionDragEnd = () => {
    setDraggingSessionID(null);
    setDragOverSectionKey(null);
  };

  const handleSectionDragOver = (event: DragEvent<HTMLElement>, sectionKey: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!draggingSessionID) {
      return;
    }
    setDragOverSectionKey(sectionKey);
  };

  const handleSectionDragLeave = (sectionKey: string) => {
    if (dragOverSectionKey === sectionKey) {
      setDragOverSectionKey(null);
    }
  };

  const handleSectionDrop = async (event: DragEvent<HTMLElement>, projectId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    const draggedSessionID = event.dataTransfer.getData('text/plain') || draggingSessionID;
    if (!draggedSessionID) {
      return;
    }

    const draggedSession = sessions.find((session) => session.id === draggedSessionID);
    const currentProjectID = draggedSession?.project_id;
    const normalizedTargetProjectID = projectId ?? '';
    if ((currentProjectID ?? '') === normalizedTargetProjectID) {
      setDragOverSectionKey(null);
      return;
    }

    await handleAssignProject(draggedSessionID, projectId);
    setDraggingSessionID(null);
    setDragOverSectionKey(null);
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) {
      setError('Project name is required');
      return;
    }

    const folders = newProjectFolders
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    try {
      await createProject({ name, folders });
      setNewProjectName('');
      setNewProjectFolders('');
      await loadProjects();
    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err instanceof Error ? err.message : 'Failed to create project');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Delete this project? Sessions will remain but become ungrouped.')) return;

    try {
      await deleteProject(projectId);
      await Promise.all([loadProjects(), loadSessions()]);
      if (selectedProjectId === projectId) {
        setSelectedProjectId('');
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  const loadBrowse = async (path: string) => {
    setIsLoadingBrowse(true);
    setError(null);
    try {
      const response = await browseSkillDirectories(path);
      setBrowsePath(response.path);
      setBrowseEntries(response.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to browse directories');
    } finally {
      setIsLoadingBrowse(false);
    }
  };

  const openProjectFolderPicker = async (project: Project) => {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
    setProjectFolderDraft(project.folders ?? []);
    setIsProjectPickerOpen(true);
    await loadBrowse((project.folders && project.folders[0]) || browsePath);
  };

  const handleAddDraftFolder = (folder: string) => {
    const normalized = folder.trim();
    if (normalized === '') {
      return;
    }
    setProjectFolderDraft((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
  };

  const handleSaveProjectFolders = async () => {
    if (!editingProjectId) {
      return;
    }
    try {
      await updateProject(editingProjectId, { folders: projectFolderDraft });
      setIsProjectPickerOpen(false);
      setEditingProjectId(null);
      setEditingProjectName('');
      await loadProjects();
    } catch (err) {
      console.error('Failed to update project folders:', err);
      setError(err instanceof Error ? err.message : 'Failed to update project folders');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatSessionTitle = (session: Session) => {
    if (session.title) {
      return session.title;
    }
    return `Session ${session.id.substring(0, 8)}`;
  };

  const formatStatusLabel = (status: string) => {
    const normalized = status.trim();
    if (normalized.length === 0) {
      return 'Unknown';
    }
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const formatTokenCount = (tokens: number) => {
    return `${new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(tokens)} tok`;
  };

  const formatDurationSeconds = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  if (loading) {
    return <div className="sessions-loading">Loading sessions...</div>;
  }

  const sessionsByProject = sessions.reduce<Record<string, Session[]>>((acc, session) => {
    const key = session.project_id || '__ungrouped__';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(session);
    return acc;
  }, {});

  const ungroupedSessions = sessionsByProject.__ungrouped__ ?? [];
  const sortedProjects = [...projects].sort((a, b) => {
    const aIsThinking = a.id === THINKING_PROJECT_ID;
    const bIsThinking = b.id === THINKING_PROJECT_ID;
    if (aIsThinking && !bIsThinking) {
      return 1;
    }
    if (!aIsThinking && bIsThinking) {
      return -1;
    }
    return a.name.localeCompare(b.name);
  });

  const isSectionCollapsed = (sectionKey: string) => collapsedSections[sectionKey] === true;
  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const renderSessionCard = (session: Session) => (
    <div
      key={session.id}
      className="session-card"
      onClick={() => {
        if (draggingSessionID) {
          return;
        }
        onSelectSession(session.id);
      }}
      draggable
      onDragStart={(event) => handleSessionDragStart(event, session.id)}
      onDragEnd={handleSessionDragEnd}
    >
      <div className="session-card-row">
        <div className="session-name-wrap">
          <span
            className={`session-status-dot status-${session.status}`}
            title={`Status: ${formatStatusLabel(session.status)}`}
            aria-label={`Status: ${formatStatusLabel(session.status)}`}
          />
          <h3 className="session-name">{formatSessionTitle(session)}</h3>
        </div>
        <div className="session-row-right">
          <div className="session-meta">
            {session.provider ? <span className="session-provider-chip">{session.provider}</span> : null}
            <span
              className="session-token-count"
              title={`Ran for ${formatDurationSeconds(session.run_duration_seconds ?? 0)}`}
            >
              {formatTokenCount(session.total_tokens ?? 0)}
            </span>
            <span className="session-date">{formatDate(session.updated_at)}</span>
          </div>
          <div className="session-actions">
            <button
              className="session-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteSession(session.id);
              }}
              title="Delete session"
              aria-label={`Delete ${formatSessionTitle(session)}`}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page-shell sessions-page-shell">
      <div className="page-header">
        <h1>Sessions</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content sessions-projects-panel">
        <div className="sessions-projects-row">
          <input
            type="text"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New project name"
            className="sessions-project-input"
            aria-label="New project name"
          />
          <input
            type="text"
            value={newProjectFolders}
            onChange={(event) => setNewProjectFolders(event.target.value)}
            placeholder="Folders (comma-separated, optional)"
            className="sessions-project-input sessions-project-folders"
            aria-label="Project folders"
          />
          <button className="create-session-btn" onClick={handleCreateProject}>
            Create project
          </button>
        </div>
      </div>

      <div className="sessions-layout">
        <div className="page-content sessions-list-container">
          {sessions.length === 0 && projects.length === 0 ? (
            <div className="sessions-empty">
              <p>No sessions yet.</p>
              <p>Start speaking or typing below to create one.</p>
            </div>
          ) : (
            <div className="sessions-grouped-list">
              <section
                className={`sessions-group-section${dragOverSectionKey === '__ungrouped__' ? ' drag-over' : ''}`}
                onDragOver={(event) => handleSectionDragOver(event, '__ungrouped__')}
                onDragLeave={() => handleSectionDragLeave('__ungrouped__')}
                onDrop={(event) => {
                  void handleSectionDrop(event, undefined);
                }}
              >
                <div className="sessions-group-header">
                  <button
                    className="sessions-collapse-btn"
                    onClick={() => toggleSection('__ungrouped__')}
                    title={isSectionCollapsed('__ungrouped__') ? 'Expand section' : 'Collapse section'}
                    aria-label={isSectionCollapsed('__ungrouped__') ? 'Expand ungrouped sessions' : 'Collapse ungrouped sessions'}
                  >
                    {isSectionCollapsed('__ungrouped__') ? '▸' : '▾'}
                  </button>
                  <h2 className="sessions-group-title">Ungrouped sessions</h2>
                  <span className="sessions-group-count">{ungroupedSessions.length} session{ungroupedSessions.length === 1 ? '' : 's'}</span>
                </div>
                {!isSectionCollapsed('__ungrouped__') ? (
                  <div
                    className="sessions-list"
                    onDragOver={(event) => handleSectionDragOver(event, '__ungrouped__')}
                    onDragLeave={() => handleSectionDragLeave('__ungrouped__')}
                    onDrop={(event) => {
                      void handleSectionDrop(event, undefined);
                    }}
                  >
                    {ungroupedSessions.map((session) => renderSessionCard(session))}
                  </div>
                ) : null}
              </section>

              {sortedProjects.map((project) => {
                const sectionKey = `project:${project.id}`;
                const sectionSessions = sessionsByProject[project.id] ?? [];
                const count = sectionSessions.length;
                const isCollapsed = isSectionCollapsed(sectionKey);
                const showEmptyDropzone = Boolean(draggingSessionID && count === 0 && !isCollapsed);
                return (
                  <section
                    key={project.id}
                    className={`sessions-group-section${dragOverSectionKey === sectionKey ? ' drag-over' : ''}`}
                    onDragOver={(event) => handleSectionDragOver(event, sectionKey)}
                    onDragLeave={() => handleSectionDragLeave(sectionKey)}
                    onDrop={(event) => {
                      void handleSectionDrop(event, project.id);
                    }}
                  >
                    <div className="sessions-group-header">
                      <button
                        className="sessions-collapse-btn"
                        onClick={() => toggleSection(sectionKey)}
                        title={isCollapsed ? 'Expand section' : 'Collapse section'}
                        aria-label={isCollapsed ? `Expand ${project.name}` : `Collapse ${project.name}`}
                      >
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                      <h2 className="sessions-group-title">{project.name}</h2>
                      <span className="sessions-group-count">{count} session{count === 1 ? '' : 's'}</span>
                      <button
                        className="project-folders-btn"
                        onClick={() => void openProjectFolderPicker(project)}
                        title={`Manage folders for ${project.name}`}
                        aria-label={`Manage folders for ${project.name}`}
                      >
                        Folders
                      </button>
                      <button
                        className="project-chip-delete"
                        onClick={() => handleDeleteProject(project.id)}
                        title={`Delete project ${project.name}`}
                        aria-label={`Delete project ${project.name}`}
                      >
                        ×
                      </button>
                    </div>
                    {!isCollapsed ? (
                      <div
                        className="sessions-list"
                        onDragOver={(event) => handleSectionDragOver(event, sectionKey)}
                        onDragLeave={() => handleSectionDragLeave(sectionKey)}
                        onDrop={(event) => {
                          void handleSectionDrop(event, project.id);
                        }}
                      >
                        {sectionSessions.map((session) => renderSessionCard(session))}
                        {showEmptyDropzone ? <div className="session-project-dropzone">Drop a session here</div> : null}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="sessions-composer">
          <div className="page-content sessions-composer-inner">
            <ChatInput
              onSend={handleStartSession}
              disabled={isCreatingSession}
              autoFocus
              actionControls={(
                <div className="sessions-new-chat-controls">
                  <label className="chat-provider-select">
                    <select
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      title="Project"
                      aria-label="Project"
                    >
                      <option value="">No project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {providers.length > 0 ? (
                    <label className="chat-provider-select">
                      <select
                        value={selectedProvider}
                        onChange={(e) => setSelectedProvider(e.target.value as LLMProviderType)}
                        title="Provider"
                        aria-label="Provider"
                      >
                        {providers.map((provider) => (
                          <option key={provider.type} value={provider.type}>
                            {provider.display_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              )}
            />
          </div>
        </div>
      </div>

      {isProjectPickerOpen ? (
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose project folders">
          <div className="mind-picker-dialog">
            <h2>Choose folders for {editingProjectName || 'project'}</h2>
            <div className="mind-picker-path">{browsePath || 'Loading...'}</div>
            <div className="mind-picker-actions">
              <button
                type="button"
                className="settings-add-btn"
                onClick={() => void loadBrowse(getParentPath(browsePath))}
                disabled={isLoadingBrowse || browsePath.trim() === '' || getParentPath(browsePath) === browsePath}
              >
                Up
              </button>
              <button
                type="button"
                className="settings-save-btn"
                onClick={() => handleAddDraftFolder(browsePath)}
                disabled={isLoadingBrowse || browsePath.trim() === ''}
              >
                Use this folder
              </button>
              <button type="button" className="settings-remove-btn" onClick={() => setIsProjectPickerOpen(false)}>
                Cancel
              </button>
            </div>

            <div className="project-folder-draft-list">
              {projectFolderDraft.length === 0 ? <div className="sessions-empty">No folders selected.</div> : null}
              {projectFolderDraft.map((folder) => (
                <div key={folder} className="project-folder-draft-item">
                  <code>{folder}</code>
                  <button
                    type="button"
                    className="project-chip-delete"
                    onClick={() => setProjectFolderDraft((prev) => prev.filter((value) => value !== folder))}
                    aria-label={`Remove ${folder}`}
                    title={`Remove ${folder}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="mind-picker-list">
              {!isLoadingBrowse && browseEntries.length === 0 ? <div className="sessions-empty">No folders found.</div> : null}
              {browseEntries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className="mind-picker-item"
                  onClick={() => void loadBrowse(entry.path)}
                >
                  📁 {entry.name}
                </button>
              ))}
            </div>

            <div className="mind-picker-actions project-folder-save-row">
              <button type="button" className="settings-save-btn" onClick={() => void handleSaveProjectFolders()}>
                Save folders
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SessionsList;
