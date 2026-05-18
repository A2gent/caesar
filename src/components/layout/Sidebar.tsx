import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  getApiBaseUrl,
  getParentApiBaseUrl,
  getStoredAgentEndpoints,
  getSession,
  getProjectGitStatus,
  listSessions,
  listProjects,
  createProject,
  type Project,
  type Session,
} from '../../api';
import { withAgentEmoji } from '../../lib/agentVisuals';
import { AgentAvatar } from '../common/AgentAvatar';
import {
  emitStartAvatarVoiceSessionEvent,
  emitStartMeetingRecordingEvent,
} from '../../lib/voiceInputEvents';

interface NavItem {
  id: string;
  label: string;
  path: string;
}

interface SidebarProps {
  title: string;
  onAgentSelect: (baseUrl: string) => void | Promise<void>;
  onReturnToParentAgent?: () => void | Promise<void>;
  onNavigate?: () => void;
  notificationCount?: number;
  refreshKey?: number;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

type ProjectSubNavId = 'sessions' | 'explorer' | 'tasks' | 'meetings' | 'changes' | 'branch-changes' | 'history' | 'settings';

interface ProjectSubNavItem {
  id: ProjectSubNavId;
  label: string;
}

interface ProjectGitNavStatus {
  hasGit: boolean;
  branchChangesAvailable: boolean;
}

// System project IDs - must match backend
export const SYSTEM_PROJECT_KB_ID = 'system-kb';
export const SYSTEM_PROJECT_AGENT_ID = 'system-agent';
export const SYSTEM_PROJECT_SOUL_ID = 'system-soul';

const navSections: NavSection[] = [
  {
    id: 'agent',
    label: '🤖 Agent',
    items: [
       { id: 'settings', label: '⚙️ Settings', path: '/settings' },
      { id: 'body', label: '📁 Body', path: '/projects/system-agent' },
      { id: 'soul', label: '🫀 Soul', path: '/projects/system-soul' },
      { id: 'thinking', label: '🤔 Thinking', path: '/thinking' },
      { id: 'jobs', label: '🔄 Recurring Jobs', path: '/agent/jobs' },
      { id: 'tools', label: '🧰 Tools', path: '/tools' },
      { id: 'skills', label: '📚 Skills', path: '/skills' },
      { id: 'mcp', label: '🧩 MCP', path: '/mcp' },
      { id: 'integrations', label: '🔌 Integrations', path: '/integrations' },
      { id: 'providers', label: '🤖 LLM providers', path: '/providers' },
    ],
  },
  {
    id: 'agents',
    label: '🤖 Agents',
    items: [
      { id: 'sub-agents', label: '🤖 Sub-agents', path: '/sub-agents' },
      { id: 'workflows', label: '🔀 Workflows', path: '/workflows' },
      { id: 'a2a-local-agents', label: '🐳 Local agents', path: '/a2a/local-agents' },
      { id: 'a2a-registry', label: '📡 External agents', path: '/a2a' },
    ],
  },
  {
    id: 'a2a',
    label: '🌐 A2 Network',
    items: [
      { id: 'a2a-registry-settings', label: '⚙️ Registry settings', path: '/a2a/registry-settings' },
      { id: 'a2a-my-agent', label: '🤖 My agent', path: '/a2a/my-agent' },
    ],
  },
];

const projectSubNavItems: ProjectSubNavItem[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'changes', label: 'Changes' },
  { id: 'branch-changes', label: 'Branch Changes' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

const knowledgeBaseSubNavItems: ProjectSubNavItem[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'changes', label: 'Changes' },
  { id: 'branch-changes', label: 'Branch Changes' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

function getVisibleNavSections(hideLocalAgents: boolean): NavSection[] {
  if (!hideLocalAgents) {
    return navSections;
  }

  return navSections
    .map((section) => {
      if (section.id !== 'agents') {
        return section;
      }
      return {
        ...section,
        items: section.items.filter((item) => item.path !== '/a2a/local-agents'),
      };
    })
    .filter((section) => section.items.length > 0);
}

function isNavItemActive(pathname: string, itemPath: string): boolean {
  if (itemPath === '/a2a') {
    return pathname === '/a2a' || pathname.startsWith('/a2a/contact/');
  }
  if (itemPath === '/agent/jobs') {
    return pathname === '/agent/jobs' || pathname.startsWith('/agent/jobs/');
  }
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

function getSectionForPath(pathname: string, sections: NavSection[]): string | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (isNavItemActive(pathname, item.path)) {
        return section.id;
      }
    }
    // notifications live in the agent section
    if (section.id === 'agent' && pathname === '/notifications') {
      return 'agent';
    }
  }
  return null;
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getProjectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match?.[1] ? safeDecodePathSegment(match[1]) : null;
}

function getProjectIdFromNavPath(path: string): string | null {
  const match = path.match(/^\/projects\/([^/]+)$/);
  return match?.[1] ? safeDecodePathSegment(match[1]) : null;
}

function getChatSessionIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  return match?.[1] ? safeDecodePathSegment(match[1]) : null;
}

function buildProjectSubNavPath(projectId: string, itemId: ProjectSubNavId): string {
  return `/projects/${encodeURIComponent(projectId)}/${itemId}`;
}

function buildChatSessionPath(sessionId: string): string {
  return `/chat/${encodeURIComponent(sessionId)}`;
}

function getProjectSubNavItems(projectId: string, gitStatus?: ProjectGitNavStatus): ProjectSubNavItem[] {
  const items = projectId === SYSTEM_PROJECT_KB_ID ? knowledgeBaseSubNavItems : projectSubNavItems;
  if (!gitStatus?.hasGit) {
    return items.filter((item) => item.id !== 'changes' && item.id !== 'branch-changes' && item.id !== 'history');
  }
  if (!gitStatus.branchChangesAvailable) {
    return items.filter((item) => item.id !== 'branch-changes');
  }
  return items;
}

function normalizeProjectSubNavId(value: string | undefined): ProjectSubNavId {
  const item = [...knowledgeBaseSubNavItems].find((candidate) => candidate.id === value);
  return item?.id || 'explorer';
}

function getActiveProjectSubNavId(pathname: string, projectId: string, activeProjectIdFromSession: string | null): ProjectSubNavId | null {
  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/([^/]+))?/);
  if (projectMatch?.[1] && safeDecodePathSegment(projectMatch[1]) === projectId) {
    return normalizeProjectSubNavId(projectMatch[2] ? safeDecodePathSegment(projectMatch[2]) : undefined);
  }

  if (activeProjectIdFromSession === projectId && getChatSessionIdFromPath(pathname)) {
    return 'sessions';
  }

  return null;
}

function formatSidebarSessionTitle(session: Session): string {
  return session.title || `Session ${session.id.slice(0, 8)}`;
}

function formatSidebarSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Sidebar({
  title,
  onAgentSelect,
  onReturnToParentAgent,
  onNavigate,
  notificationCount = 0,
  refreshKey,
}: SidebarProps) {
  const location = useLocation();
  const [activeBaseUrl, setActiveBaseUrl] = useState(() => getApiBaseUrl());
  const [parentBaseUrl, setParentBaseUrl] = useState(() => getParentApiBaseUrl());
  const [isSwitchingAgent, setIsSwitchingAgent] = useState(false);
  const [agentOptions, setAgentOptions] = useState(() => getStoredAgentEndpoints());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);

  // Collapsible nav sections — default collapsed, auto-expand active section
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const active = getSectionForPath(location.pathname, navSections);
    return active ? new Set([active]) : new Set<string>();
  });

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Auto-expand section when navigating to a route inside it
  useEffect(() => {
    const active = getSectionForPath(location.pathname, navSections);
    if (active) {
      setExpandedSections(prev => {
        if (prev.has(active)) return prev;
        const next = new Set(prev);
        next.add(active);
        return next;
      });
    }
  }, [location.pathname]);

  // Projects state
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [activeProjectIdFromSession, setActiveProjectIdFromSession] = useState<string | null>(null);
  const [projectGitStatusById, setProjectGitStatusById] = useState<Record<string, ProjectGitNavStatus>>({});
  const [projectGitStatusRefreshTick, setProjectGitStatusRefreshTick] = useState(0);
  const [recentProjectSessions, setRecentProjectSessions] = useState<Session[]>([]);
  const activeProjectIdFromRoute = getProjectIdFromPath(location.pathname);
  const activeProjectId = activeProjectIdFromRoute || activeProjectIdFromSession;
  const activeChatSessionId = getChatSessionIdFromPath(location.pathname);

  const reloadAgentOptions = useCallback(() => {
    setActiveBaseUrl(getApiBaseUrl());
    setParentBaseUrl(getParentApiBaseUrl());
    setAgentOptions(getStoredAgentEndpoints());
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) {
      return;
    }
    const handleOutside = (event: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isDropdownOpen]);

  // Load projects
  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }, []);

  useEffect(() => {
    reloadAgentOptions();
  }, [reloadAgentOptions, refreshKey]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects, refreshKey]);

  useEffect(() => {
    const handleProjectGitStatusChanged = () => {
      setProjectGitStatusRefreshTick((value) => value + 1);
    };
    window.addEventListener('a2gent:project-git-status-changed', handleProjectGitStatusChanged);
    return () => {
      window.removeEventListener('a2gent:project-git-status-changed', handleProjectGitStatusChanged);
    };
  }, []);

  useEffect(() => {
    const projectMatch = location.pathname.match(/^\/projects\/([^/]+)/);
    if (projectMatch?.[1]) {
      setActiveProjectIdFromSession(null);
      return;
    }

    const chatMatch = location.pathname.match(/^\/chat\/([^/]+)/);
    if (!chatMatch?.[1]) {
      setActiveProjectIdFromSession(null);
      return;
    }

    const sessionId = safeDecodePathSegment(chatMatch[1]);
    let cancelled = false;

    const loadSessionProject = async () => {
      try {
        const session = await getSession(sessionId);
        if (!cancelled) {
          setActiveProjectIdFromSession(session.project_id || null);
        }
      } catch (err) {
        console.error('Failed to resolve active project from session:', err);
        if (!cancelled) {
          setActiveProjectIdFromSession(null);
        }
      }
    };

    void loadSessionProject();

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!activeProjectId) {
      setRecentProjectSessions([]);
      return;
    }

    let cancelled = false;

    const loadRecentProjectSessions = async () => {
      try {
        const data = await listSessions();
        if (cancelled) return;

        const recent = data
          .filter((session) => {
            const isProjectSession = session.project_id === activeProjectId;
            const isParentSession = !(session.parent_id || '').trim();
            return isProjectSession && isParentSession;
          })
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(0, 5);
        setRecentProjectSessions(recent);
      } catch (err) {
        console.error('Failed to load recent project sessions:', err);
        if (!cancelled) {
          setRecentProjectSessions([]);
        }
      }
    };

    void loadRecentProjectSessions();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, location.pathname, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    const loadProjectGitStatuses = async () => {
      const folderProjects = projects.filter((project) => (project.folder || '').trim() !== '');
      if (folderProjects.length === 0) {
        setProjectGitStatusById({});
        return;
      }

      const entries = await Promise.all(
        folderProjects.map(async (project): Promise<[string, ProjectGitNavStatus]> => {
          try {
            const status = await getProjectGitStatus(project.id);
            return [
              project.id,
              {
                hasGit: Boolean(status.has_git),
                branchChangesAvailable: Boolean(status.branch_changes_available),
              },
            ];
          } catch (err) {
            console.error(`Failed to load git status for project ${project.id}:`, err);
            return [project.id, { hasGit: false, branchChangesAvailable: false }];
          }
        }),
      );

      if (cancelled) return;
      setProjectGitStatusById(Object.fromEntries(entries));
    };

    void loadProjectGitStatuses();

    return () => {
      cancelled = true;
    };
  }, [projects, projectGitStatusRefreshTick]);

  const handleAgentChange = async (nextUrl: string) => {
    if (nextUrl === '' || nextUrl === activeBaseUrl || isSwitchingAgent) {
      return;
    }

    setIsSwitchingAgent(true);
    try {
      await onAgentSelect(nextUrl);
    } finally {
      setIsSwitchingAgent(false);
      setIsDropdownOpen(false);
      reloadAgentOptions();
    }
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;

    setIsCreatingProject(true);
    try {
      await createProject({ name });
      setNewProjectName('');
      setIsCreateProjectOpen(false);
      await loadProjects();
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setIsCreatingProject(false);
    }
  };

  // Sort projects: KB first, then user projects (Body/Soul are shown in Agent section)
  const sortedProjects = useCallback(() => {
    const kbProject = projects.find(p => p.id === SYSTEM_PROJECT_KB_ID);
    const userProjects = projects.filter(
      p => p.id !== SYSTEM_PROJECT_KB_ID && p.id !== SYSTEM_PROJECT_AGENT_ID && p.id !== SYSTEM_PROJECT_SOUL_ID
    );

    const result: Project[] = [];
    if (kbProject) result.push(kbProject);
    result.push(...userProjects);

    return result;
  }, [projects]);

  // Helper to get project icon based on system status
  const getProjectIcon = (project: Project) => {
    if (project.id === SYSTEM_PROJECT_KB_ID) return '🧠';
    if (project.id === SYSTEM_PROJECT_AGENT_ID) return '🤖';
    if (project.id === SYSTEM_PROJECT_SOUL_ID) return '🫀';
    return (
      <span className="nav-project-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7.5a2.5 2.5 0 0 1 2.5-2.5h4l2 2H18.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
          <path d="M3 9.5h18" />
        </svg>
      </span>
    );
  };

  const alternateAgents = agentOptions.filter((endpoint) => endpoint.url !== activeBaseUrl);
  const hasAlternateAgents = alternateAgents.length > 0;
  const canReturnToParentAgent = parentBaseUrl !== '' && parentBaseUrl !== activeBaseUrl;
  const visibleNavSections = getVisibleNavSections(canReturnToParentAgent);

  const handleReturnToParent = async () => {
    if (!onReturnToParentAgent || !canReturnToParentAgent || isSwitchingAgent) {
      return;
    }

    setIsSwitchingAgent(true);
    try {
      await onReturnToParentAgent();
    } finally {
      setIsSwitchingAgent(false);
      setIsDropdownOpen(false);
      reloadAgentOptions();
    }
  };

  const renderProjectSubNav = (projectId: string, projectName: string) => {
    if (activeProjectId !== projectId) {
      return null;
    }

    const activeSubNavId = getActiveProjectSubNavId(location.pathname, projectId, activeProjectIdFromSession) || 'explorer';
    const items = getProjectSubNavItems(projectId, projectGitStatusById[projectId]);

    return (
      <ul className="nav-submenu project-subnav-list" aria-label={`${projectName} project views`}>
        {items.map((item) => {
          const isSessionsItem = item.id === 'sessions';
          const isItemActive = activeSubNavId === item.id;
          return (
            <li key={item.id} className="nav-subitem">
              <Link
                to={buildProjectSubNavPath(projectId, item.id)}
                className={`nav-link nav-subnav-link ${isItemActive ? 'active' : ''}`}
                onClick={onNavigate}
              >
                {item.label}
              </Link>
              {isSessionsItem && recentProjectSessions.length > 0 ? (
                <ul className="nav-recent-sessions-list" aria-label="Recent sessions">
                  {recentProjectSessions.map((session) => {
                    const sessionTitle = formatSidebarSessionTitle(session);
                    const sessionTime = formatSidebarSessionTime(session.updated_at);
                    const isActiveSession = activeChatSessionId === session.id;
                    return (
                      <li key={session.id} className="nav-recent-session-item">
                        <Link
                          to={buildChatSessionPath(session.id)}
                          className={`nav-recent-session-link ${isActiveSession ? 'active' : ''}`}
                          title={sessionTitle}
                          onClick={onNavigate}
                        >
                          <span className={`session-status-dot status-${session.status}`} aria-hidden="true" />
                          <span className="nav-recent-session-title">{sessionTitle}</span>
                          {sessionTime ? <span className="nav-recent-session-time">{sessionTime}</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="sidebar">
      {/* Agent Avatar — always visible, reacts to mic/TTS */}
      <button
        type="button"
        className="sidebar-avatar-wrap sidebar-avatar-trigger"
        onClick={emitStartAvatarVoiceSessionEvent}
        onContextMenu={(event) => {
          event.preventDefault();
          emitStartMeetingRecordingEvent();
        }}
        title="Left click: start voice session. Right click: start meeting recording."
        aria-label="Start voice session; right click starts meeting recording"
      >
        <AgentAvatar size={96} />
      </button>

      <div className="sidebar-title-wrap">
        <div className="sidebar-agent-combo" ref={comboRef}>
          <div className="sidebar-agent-combo-row">
            <div
              className="sidebar-title-display sidebar-agent-combo-input"
              aria-label="Active agent"
              title={withAgentEmoji(title, 'main')}
            >
              {withAgentEmoji(title, 'main')}
            </div>
            <button
              type="button"
              className="sidebar-agent-combo-toggle"
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              disabled={isSwitchingAgent || !hasAlternateAgents}
              aria-expanded={isDropdownOpen}
              aria-label="Show saved agents"
              title="Show saved agents"
            >
              ▾
            </button>
          </div>
          {isDropdownOpen && hasAlternateAgents ? (
            <ul className="sidebar-agent-combo-dropdown" role="listbox">
              {alternateAgents.map((endpoint) => (
                <li key={endpoint.url} className="sidebar-agent-combo-option">
                  <button
                    type="button"
                    className="sidebar-agent-combo-option-btn"
                    onClick={() => void handleAgentChange(endpoint.url)}
                    title={endpoint.url}
                  >
                    {endpoint.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {canReturnToParentAgent && onReturnToParentAgent ? (
          <button
            type="button"
            className="sidebar-return-parent-btn"
            onClick={() => void handleReturnToParent()}
            disabled={isSwitchingAgent}
            title={`Return to ${parentBaseUrl}`}
          >
            ↩ Back to parent agent
          </button>
        ) : null}
      </div>

      <nav className="sidebar-nav">
        {/* Projects Section */}
        <div className="nav-section">
          <div className="nav-section-header">📂 Projects</div>
          <ul className="nav-list">
            {sortedProjects().map(project => {
              const isActiveProject = activeProjectId === project.id;
              return (
                <li key={project.id} className={`nav-item nav-project-item ${isActiveProject ? 'nav-project-item--active' : ''}`}>
                  <Link
                    to={buildProjectSubNavPath(project.id, 'explorer')}
                    className={`nav-link nav-project-link ${isActiveProject ? 'active' : ''}`}
                    onClick={onNavigate}
                  >
                    {getProjectIcon(project)} {project.name}
                  </Link>
                  {renderProjectSubNav(project.id, project.name)}
                </li>
              );
            })}
          </ul>

          {/* Add Project Button */}
          <button
            type="button"
            className="sidebar-add-project-btn"
            onClick={() => setIsCreateProjectOpen(prev => !prev)}
            aria-expanded={isCreateProjectOpen}
          >
            <span className="sidebar-add-project-line" />
            <span className="sidebar-add-project-label">Add project</span>
            <span className="sidebar-add-project-line" />
          </button>

          {/* Create Project Form */}
          {isCreateProjectOpen && (
            <div className="sidebar-create-project-form">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className="sidebar-project-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleCreateProject();
                  } else if (e.key === 'Escape') {
                    setIsCreateProjectOpen(false);
                    setNewProjectName('');
                  }
                }}
              />
              <button
                type="button"
                className="sidebar-project-create-btn"
                onClick={() => void handleCreateProject()}
                disabled={isCreatingProject || !newProjectName.trim()}
              >
                {isCreatingProject ? 'Creating...' : 'Create'}
              </button>
            </div>
          )}
        </div>

        {/* Agent/Settings Sections */}
        {visibleNavSections.map(section => {
          const isExpanded = expandedSections.has(section.id);
          return (
            <div key={section.id} className={`nav-section${isExpanded ? ' nav-section--expanded' : ''}`}>
              <button
                type="button"
                className="nav-section-header nav-section-toggle"
                onClick={() => toggleSection(section.id)}
                aria-expanded={isExpanded}
              >
                <span className="nav-section-toggle-label">{section.label}</span>
                <span className={`nav-section-chevron${isExpanded ? ' nav-section-chevron--open' : ''}`}>›</span>
              </button>
              {isExpanded && (
                <ul className="nav-list">
                  {section.items.map(item => {
                    const itemProjectId = getProjectIdFromNavPath(item.path);
                    const isActiveProjectItem = Boolean(itemProjectId && activeProjectId === itemProjectId);
                    return (
                      <li key={item.id} className={`nav-item ${isActiveProjectItem ? 'nav-project-item nav-project-item--active' : ''}`}>
                        <Link
                          to={itemProjectId ? buildProjectSubNavPath(itemProjectId, 'explorer') : item.path}
                          className={`nav-link ${isActiveProjectItem ? 'nav-project-link ' : ''}${isNavItemActive(location.pathname, item.path) || isActiveProjectItem ? 'active' : ''}`}
                          onClick={onNavigate}
                        >
                          {item.label}
                        </Link>
                        {itemProjectId ? renderProjectSubNav(itemProjectId, item.label) : null}
                      </li>
                    );
                  })}
                  {/* Notifications in Agent section */}
                  {section.id === 'agent' && (
                    <li className="nav-item">
                      <Link
                        to="/notifications"
                        className={`nav-link ${location.pathname === '/notifications' ? 'active' : ''}`}
                        onClick={onNavigate}
                      >
                        🔔 Notifications {notificationCount ? `(${notificationCount})` : '(0)'}
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

export default Sidebar;
