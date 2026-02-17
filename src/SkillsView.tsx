import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  browseSkillDirectories,
  discoverSkills,
  getSettings,
  installRegistrySkill,
  type MindTreeEntry,
  type RegistrySkill,
  searchRegistrySkills,
  type SkillFile,
  updateSettings,
} from './api';
import { buildOpenInMyMindUrl } from './myMindNavigation';
import { SKILLS_FOLDER_KEY } from './skills';

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

function SkillsView() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [connectedFolder, setConnectedFolder] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<MindTreeEntry[]>([]);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);

  const [discoveredSkills, setDiscoveredSkills] = useState<SkillFile[]>([]);
  const [isDiscoveringSkills, setIsDiscoveringSkills] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RegistrySkill[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [installingSkills, setInstallingSkills] = useState<Set<string>>(new Set());

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const loaded = await getSettings();
      setSettings(loaded);
      setConnectedFolder((loaded[SKILLS_FOLDER_KEY] || '').trim());
    } catch (loadError) {
      console.error('Failed to load skills settings:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load skills settings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

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

  const openPicker = async () => {
    setIsPickerOpen(true);
    await loadBrowse(connectedFolder || browsePath);
  };

  useEffect(() => {
    const folder = connectedFolder.trim();
    if (folder === '') {
      setDiscoveredSkills([]);
      return;
    }

    let isActive = true;
    const runDiscovery = async () => {
      setIsDiscoveringSkills(true);
      try {
        const response = await discoverSkills(folder);
        if (!isActive) {
          return;
        }
        setDiscoveredSkills(response.skills);
      } catch (discoverError) {
        if (!isActive) {
          return;
        }
        setDiscoveredSkills([]);
        setError(discoverError instanceof Error ? discoverError.message : 'Failed to discover markdown skills');
      } finally {
        if (isActive) {
          setIsDiscoveringSkills(false);
        }
      }
    };

    void runDiscovery();
    return () => {
      isActive = false;
    };
  }, [connectedFolder]);

  const saveSkillsSettings = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    const payload: Record<string, string> = { ...settings };
    const folder = connectedFolder.trim();

    if (folder === '') {
      delete payload[SKILLS_FOLDER_KEY];
    } else {
      payload[SKILLS_FOLDER_KEY] = folder;
    }

    try {
      const saved = await updateSettings(payload);
      setSettings(saved);
      setSuccess('Skills settings saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save skills settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSearch = async () => {
    if (searchQuery.trim() === '') {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);
    try {
      const response = await searchRegistrySkills(searchQuery.trim());
      setSearchResults(response.skills);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Failed to search skills');
    } finally {
      setIsSearching(false);
    }
  };

  const handleInstall = async (skill: RegistrySkill) => {
    if (!connectedFolder) {
      setError('Please configure skills folder first');
      return;
    }

    setInstallingSkills(prev => new Set(prev).add(skill.id));
    setError(null);
    setSuccess(null);

    try {
      const response = await installRegistrySkill(skill.id);
      setSuccess(response.message);
      
      // Refresh discovered skills after installation
      if (connectedFolder) {
        const refreshed = await discoverSkills(connectedFolder);
        setDiscoveredSkills(refreshed.skills);
      }
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : 'Failed to install skill');
    } finally {
      setInstallingSkills(prev => {
        const next = new Set(prev);
        next.delete(skill.id);
        return next;
      });
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Skills</h1>
      </div>

      {error ? (
        <div className="error-banner">
          {error}
          <button type="button" className="error-dismiss" onClick={() => setError(null)}>×</button>
        </div>
      ) : null}
      {success ? (
        <div className="success-banner">
          {success}
          <button type="button" className="error-dismiss" onClick={() => setSuccess(null)}>×</button>
        </div>
      ) : null}

      <div className="page-content page-content-narrow settings-sections">
        {isLoading ? (
          <div className="sessions-loading">Loading skills...</div>
        ) : (
          <>
            <div className="settings-panel">
              <h2>External markdown skills</h2>
              <p className="settings-help">
                Connect a folder that contains skill Markdown files (`.md`, `.markdown`). These files are discovered and exposed as external skills.
              </p>
              <div className="settings-group">
                <label className="settings-field">
                  <span>Connected folder</span>
                  <input
                    type="text"
                    value={connectedFolder}
                    onChange={(event) => setConnectedFolder(event.target.value)}
                    placeholder="/absolute/path/to/skills"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="settings-actions">
                <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                  Browse folders
                </button>
                <button
                  type="button"
                  className="settings-remove-btn"
                  onClick={() => setConnectedFolder('')}
                  disabled={connectedFolder.trim() === ''}
                >
                  Disconnect folder
                </button>
              </div>
              <div className="settings-help">
                {connectedFolder.trim() === '' ? 'No folder connected.' : `Connected: ${connectedFolder}`}
              </div>

              <div className="skills-discovery-list">
                <h3>Discovered markdown skills</h3>
                {isDiscoveringSkills ? <div className="sessions-loading">Scanning folder...</div> : null}
                {!isDiscoveringSkills && discoveredSkills.length === 0 ? (
                  <p className="settings-help">No markdown skills found in the connected folder.</p>
                ) : null}
                {!isDiscoveringSkills && discoveredSkills.length > 0 ? (
                  <div className="skills-external-grid">
                    {discoveredSkills.map((skill) => (
                      <div key={skill.path} className="skill-card skill-card-external">
                        <div className="skill-card-title-row">
                          <h3>{skill.name}</h3>
                          <span className="skill-badge skill-badge-external">Folder</span>
                        </div>
                        {skill.description && (
                          <p className="skill-card-description">{skill.description}</p>
                        )}
                        <div className="skill-card-meta">
                          <Link
                            to={buildOpenInMyMindUrl(skill.path)}
                            className="skill-card-meta-link"
                            title={`Open ${skill.path} in My Mind`}
                          >
                            {skill.relative_path}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="skills-registry-section">
                <h3>🌐 Install from Clawhub.ai</h3>
                <p className="settings-help">
                  Search and install skills from the community registry
                </p>

                <div className="skills-search-box">
                  <input
                    type="text"
                    className="skills-search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleSearch();
                      }
                    }}
                    placeholder="Search skills (e.g., pdf, python, testing)..."
                    disabled={!connectedFolder}
                  />
                  <button
                    type="button"
                    className="skills-search-btn"
                    onClick={() => void handleSearch()}
                    disabled={!connectedFolder || isSearching || searchQuery.trim() === ''}
                  >
                    {isSearching ? 'Searching...' : '🔍 Search'}
                  </button>
                </div>

                {!connectedFolder && (
                  <p className="settings-help" style={{ color: '#ff9966' }}>
                    Configure skills folder above to enable skill installation
                  </p>
                )}

                {searchResults.length > 0 && (
                  <div className="skills-registry-results">
                    <h4>Search Results ({searchResults.length})</h4>
                    <div className="skills-registry-grid">
                      {searchResults.map((skill) => (
                        <div key={skill.id} className="skill-card skill-card-registry">
                          <div className="skill-card-title-row">
                            <h3>{skill.name}</h3>
                            <span className="skill-badge skill-badge-registry">Registry</span>
                          </div>
                          <p className="skill-card-description">{skill.description}</p>
                          <div className="skill-card-meta-row">
                            <span className="skill-meta-item">
                              👤 {skill.author}
                            </span>
                            <span className="skill-meta-item">
                              ⭐ {skill.rating.toFixed(1)}
                            </span>
                            <span className="skill-meta-item">
                              ⬇️ {skill.downloads.toLocaleString()}
                            </span>
                            <span className="skill-meta-item">
                              v{skill.version}
                            </span>
                          </div>
                          {skill.tags && skill.tags.length > 0 && (
                            <div className="skill-tags">
                              {skill.tags.map((tag) => (
                                <span key={tag} className="skill-tag">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            className="skill-install-btn"
                            onClick={() => void handleInstall(skill)}
                            disabled={installingSkills.has(skill.id)}
                          >
                            {installingSkills.has(skill.id) ? 'Installing...' : '📥 Install'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isSearching && (
                  <div className="sessions-loading">Searching clawhub.ai...</div>
                )}

                {!isSearching && searchQuery.trim() !== '' && searchResults.length === 0 && (
                  <p className="settings-help">No skills found for "{searchQuery}"</p>
                )}
              </div>
            </div>

            <div className="settings-panel">
              <button type="button" className="settings-save-btn" onClick={() => void saveSkillsSettings()} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save skills'}
              </button>
            </div>
          </>
        )}
      </div>

      {isPickerOpen ? (
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose Skills folder">
          <div className="mind-picker-dialog">
            <h2>Choose skills folder</h2>
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
                onClick={() => {
                  setConnectedFolder(browsePath);
                  setIsPickerOpen(false);
                }}
                disabled={isLoadingBrowse || browsePath.trim() === ''}
              >
                Use this folder
              </button>
              <button type="button" className="settings-remove-btn" onClick={() => setIsPickerOpen(false)}>
                Cancel
              </button>
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SkillsView;
