import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
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
  onNavigate?: () => void;
  notificationCount?: number;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

// System project IDs - must match backend
export const SYSTEM_PROJECT_KB_ID = 'system-kb';
export const SYSTEM_PROJECT_AGENT_ID = 'system-agent';

const navSections: NavSection[] = [
  {
    id: 'agent',
    label: '🤖 Agent',
    items: [
      { id: 'thinking', label: '🤔 Thinking', path: '/thinking' },
      { id: 'jobs', label: '🗓️ Recurring jobs', path: '/agent/jobs' },
      { id: 'tools', label: '🧰 Tools', path: '/tools' },
      { id: 'skills', label: '📚 Skills', path: '/skills' },
      { id: 'mcp', label: '🧩 MCP', path: '/mcp' },
      { id: 'integrations', label: '🔌 Integrations', path: '/integrations' },
      { id: 'providers', label: '🤖 LLM providers', path: '/providers' },
      { id: 'settings', label: '⚙️ Settings', path: '/settings' },
    ],
  },
];

function Sidebar({ title, onTitleChange, onNavigate, notificationCount = 0 }: SidebarProps) {
  const location = useLocation();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Projects state
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

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
    loadProjects();
  }, [loadProjects]);

  const commitTitleEdit = () => {
    onTitleChange(titleDraft);
    setIsEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    setTitleDraft(title);
    setIsEditingTitle(false);
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

  // Helper to get project icon based on system status
  const getProjectIcon = (project: Project) => {
    if (project.id === SYSTEM_PROJECT_KB_ID) return '🧠';
    if (project.id === SYSTEM_PROJECT_AGENT_ID) return '🤖';
    return '📁';
  };

  return (
    <div className="sidebar">
      <div className="sidebar-title-wrap">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="sidebar-title-input"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitleEdit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelTitleEdit();
              }
            }}
            aria-label="Edit app title"
          />
        ) : (
          <button
            type="button"
            className="sidebar-title-button"
            onClick={() => setIsEditingTitle(true)}
            title="Click to rename app title"
          >
            <h2 className="sidebar-title">{title}</h2>
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {/* Projects Section */}
        <div className="nav-section">
          <div className="nav-section-header">📂 Projects</div>
          <ul className="nav-list">
            {projects.map(project => (
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
                    className={`nav-link ${location.pathname.startsWith(item.path) ? 'active' : ''}`}
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
