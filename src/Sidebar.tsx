import { useEffect, useState, useCallback, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  getApiBaseUrl,
  getStoredAgentEndpoints,
  listProjects,
  createProject,
  type Project,
} from './api';

interface NavItem {
  id: string;
  label: string;
  path: string;
}

interface SidebarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onAgentSelect: (baseUrl: string) => void | Promise<void>;
  onNavigate?: () => void;
  notificationCount?: number;
  refreshKey?: number;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
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
      { id: 'body', label: '📁 Body', path: '/projects/system-agent' },
      { id: 'soul', label: '🫀 Soul', path: '/projects/system-soul' },
      { id: 'thinking', label: '🤔 Thinking', path: '/thinking' },
      { id: 'jobs', label: '🗓️ Recurring jobs', path: '/agent/jobs' },
      { id: 'tools', label: '🧰 Tools', path: '/tools' },
      { id: 'skills', label: '📚 Skills', path: '/skills' },
      { id: 'mcp', label: '🧩 MCP', path: '/mcp' },
      { id: 'integrations', label: '🔌 Integrations', path: '/integrations' },
      { id: 'providers', label: '🤖 LLM providers', path: '/providers' },
      { id: 'settings', label: '⚙️ Settings', path: '/settings' },
      { id: 'sub-agents', label: '🤖 Sub-agents', path: '/sub-agents' },
      { id: 'a2a-local-agents', label: '🐳 Local agents', path: '/a2a/local-agents' },
    ],
  },
  {
    id: 'a2a',
    label: '🌐 A2 Network',
    items: [
      { id: 'a2a-registry', label: '📡 External agents', path: '/a2a' },
      { id: 'a2a-my-agent', label: '🤖 My agent', path: '/a2a/my-agent' },
    ],
  },
];

function isNavItemActive(pathname: string, itemPath: string): boolean {
  if (itemPath === '/a2a') {
    return pathname === '/a2a' || pathname.startsWith('/a2a/contact/');
  }
  if (itemPath === '/agent/jobs') {
    return pathname === '/agent/jobs' || pathname.startsWith('/agent/jobs/');
  }
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

function Sidebar({ title, onTitleChange, onAgentSelect, onNavigate, notificationCount = 0, refreshKey }: SidebarProps) {
  const location = useLocation();
  const [activeBaseUrl, setActiveBaseUrl] = useState(() => getApiBaseUrl());
  const [isSwitchingAgent, setIsSwitchingAgent] = useState(false);
  const [agentOptions, setAgentOptions] = useState(() => getStoredAgentEndpoints());
  const [titleDraft, setTitleDraft] = useState(title);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Projects state
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const reloadAgentOptions = useCallback(() => {
    setActiveBaseUrl(getApiBaseUrl());
    setAgentOptions(getStoredAgentEndpoints());
  }, []);

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

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

  const commitTitleEdit = () => {
    onTitleChange(titleDraft);
  };

  const cancelTitleEdit = () => {
    setTitleDraft(title);
    inputRef.current?.blur();
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
    return '📁';
  };

  const alternateAgents = agentOptions.filter((endpoint) => endpoint.url !== activeBaseUrl);
  const hasAlternateAgents = alternateAgents.length > 0;

  return (
    <div className="sidebar">
      <div className="sidebar-title-wrap">
        <div className="sidebar-agent-combo" ref={comboRef}>
          <div className="sidebar-agent-combo-row">
            <input
              ref={inputRef}
              className="sidebar-title-input sidebar-agent-combo-input"
              value={titleDraft}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setTitleDraft(event.target.value)}
              onBlur={commitTitleEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTitleEdit();
                  inputRef.current?.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelTitleEdit();
                }
              }}
              aria-label="Edit active agent name"
            />
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
      </div>

      <nav className="sidebar-nav">
        {/* Projects Section */}
        <div className="nav-section">
          <div className="nav-section-header">📂 Projects</div>
          <ul className="nav-list">
            {sortedProjects().map(project => (
              <li key={project.id} className="nav-item">
                <Link
                  to={`/projects/${project.id}`}
                  className={`nav-link ${location.pathname.startsWith(`/projects/${project.id}`) ? 'active' : ''}`}
                  onClick={onNavigate}
                >
                  {getProjectIcon(project)} {project.name}
                </Link>
              </li>
            ))}
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
        {navSections.map(section => (
          <div key={section.id} className="nav-section">
            <div className="nav-section-header">{section.label}</div>
            <ul className="nav-list">
              {section.items.map(item => (
                <li key={item.id} className="nav-item">
                  <Link
                    to={item.path}
                    className={`nav-link ${isNavItemActive(location.pathname, item.path) ? 'active' : ''}`}
                    onClick={onNavigate}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
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
          </div>
        ))}
      </nav>
    </div>
  );
}

export default Sidebar;
