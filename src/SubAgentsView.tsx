import { useEffect, useMemo, useState } from 'react';
import {
  createSubAgent,
  deleteSubAgent,
  estimateSubAgentInstructionPrompt,
  listSubAgents,
  listProviders,
  listProviderModels,
  listToolDefinitions,
  updateSubAgent,
  type SubAgent,
  type ProviderConfig,
  type SystemPromptSnapshot,
  type ToolDefinitionInfo,
} from './api';
import { EmptyState, EmptyStateTitle } from './EmptyState';
import InstructionBlocksEditor from './InstructionBlocksEditor';
import {
  BUILTIN_TOOLS_BLOCK_TYPE,
  EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE,
  INTEGRATION_SKILLS_BLOCK_TYPE,
  MCP_SERVERS_BLOCK_TYPE,
  parseInstructionBlocksSetting,
  serializeInstructionBlocksSetting,
  type InstructionBlock,
  type InstructionBlockType,
} from './instructionBlocks';
import { toolIconForName } from './toolIcons';

const MANAGED_INSTRUCTION_BLOCK_TYPES: InstructionBlockType[] = [
  BUILTIN_TOOLS_BLOCK_TYPE,
  INTEGRATION_SKILLS_BLOCK_TYPE,
  EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE,
  MCP_SERVERS_BLOCK_TYPE,
];

function isManagedInstructionBlockType(type: InstructionBlockType): boolean {
  return MANAGED_INSTRUCTION_BLOCK_TYPES.includes(type);
}

function ensureSubAgentManagedBlocks(blocks: InstructionBlock[]): InstructionBlock[] {
  const normalizedBlocks: InstructionBlock[] = [];
  const seenManagedTypes = new Set<InstructionBlockType>();
  for (const block of blocks) {
    if (isManagedInstructionBlockType(block.type)) {
      if (seenManagedTypes.has(block.type)) {
        continue;
      }
      seenManagedTypes.add(block.type);
      normalizedBlocks.push({ ...block, value: '' });
      continue;
    }
    normalizedBlocks.push(block);
  }

  // Auto-add missing managed types — only builtin_tools enabled by default
  for (const type of MANAGED_INSTRUCTION_BLOCK_TYPES) {
    if (seenManagedTypes.has(type)) {
      continue;
    }
    normalizedBlocks.push({
      type,
      value: '',
      enabled: type === BUILTIN_TOOLS_BLOCK_TYPE,
    });
  }
  return normalizedBlocks;
}

function defaultSubAgentInstructionBlocks(): InstructionBlock[] {
  return ensureSubAgentManagedBlocks([
    { type: BUILTIN_TOOLS_BLOCK_TYPE, value: '', enabled: true },
  ]);
}

function getEstimatedTokensLabel(tokens: number | null | undefined): string {
  return `${tokens ?? 0} tokens`;
}

function SubAgentsView() {
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [toolDefs, setToolDefs] = useState<ToolDefinitionInfo[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set());
  const [allToolsMode, setAllToolsMode] = useState(true);
  const [instructionBlocks, setInstructionBlocks] = useState<InstructionBlock[]>(defaultSubAgentInstructionBlocks());

  const [instructionEstimate, setInstructionEstimate] = useState<SystemPromptSnapshot | null>(null);
  const [instructionEstimateError, setInstructionEstimateError] = useState<string | null>(null);
  const [isEstimatingInstructions, setIsEstimatingInstructions] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const sortedAgents = useMemo(
    () => [...subAgents].sort((a, b) => a.name.localeCompare(b.name)),
    [subAgents],
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const [agents, provs, tools] = await Promise.all([
        listSubAgents(),
        listProviders(),
        listToolDefinitions(),
      ]);
      setSubAgents(agents);
      setProviders(provs);
      setToolDefs(tools);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Fetch models when provider changes
  useEffect(() => {
    if (!provider) {
      setModels([]);
      setLoadingModels(false);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    void (async () => {
      try {
        const m = await listProviderModels(provider);
        if (!cancelled) setModels(m);
      } catch {
        if (!cancelled) setModels([]);
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => { cancelled = true; };
  }, [provider]);

  // Debounced instruction estimation
  useEffect(() => {
    if (!isFormOpen) {
      return;
    }
    const timeoutId = window.setTimeout(async () => {
      setIsEstimatingInstructions(true);
      setInstructionEstimateError(null);
      try {
        const serialized = serializeInstructionBlocksSetting(
          instructionBlocks
            .filter((block) => isManagedInstructionBlockType(block.type) || block.value.trim() !== ''),
        ) || '[]';
        const toolsList = allToolsMode ? [] : Array.from(enabledTools);
        const response = await estimateSubAgentInstructionPrompt(
          editingId,
          serialized,
          name || 'Draft Sub-Agent',
          toolsList,
        );
        setInstructionEstimate(response.snapshot);
      } catch (err) {
        setInstructionEstimateError(err instanceof Error ? err.message : 'Failed to estimate instruction tokens');
      } finally {
        setIsEstimatingInstructions(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isFormOpen, instructionBlocks, name, editingId, allToolsMode, enabledTools]);

  // Compute per-block token estimates
  const estimatedBlocks = instructionEstimate?.blocks || [];
  const instructionBlockEstimatedTokens = useMemo(() => {
    const estimateQueue = [...estimatedBlocks];
    return instructionBlocks.map((block) => {
      const nextType = block.type;
      const estimateIndex = estimateQueue.findIndex((estimate) => estimate.type === nextType);
      if (estimateIndex < 0) {
        return 0;
      }
      const [estimate] = estimateQueue.splice(estimateIndex, 1);
      return estimate?.estimated_tokens ?? 0;
    });
  }, [instructionBlocks, estimatedBlocks]);

  const instructionBlockEstimatedTokenLabels = useMemo(() => {
    return instructionBlocks.map((_block, index) => {
      const tokens = instructionBlockEstimatedTokens[index] ?? 0;
      return getEstimatedTokensLabel(tokens);
    });
  }, [instructionBlocks, instructionBlockEstimatedTokens]);

  const enabledInstructionTotalTokens = useMemo(() => {
    if (!instructionEstimate) {
      return null;
    }
    const baseTokens = instructionEstimate.base_estimated_tokens ?? 0;
    const enabledBlockTokens = estimatedBlocks.reduce((sum, block) => {
      if (block.enabled === false) {
        return sum;
      }
      return sum + (block.estimated_tokens ?? 0);
    }, 0);
    return baseTokens + enabledBlockTokens;
  }, [instructionEstimate, estimatedBlocks]);

  const resetForm = () => {
    setName('');
    setProvider('');
    setModel('');
    setEnabledTools(new Set());
    setAllToolsMode(true);
    setInstructionBlocks(defaultSubAgentInstructionBlocks());
    setInstructionEstimate(null);
    setInstructionEstimateError(null);
    setEditingId(null);
    setIsFormOpen(false);
  };

  const openCreateForm = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const startEditing = (sa: SubAgent) => {
    setEditingId(sa.id);
    setName(sa.name);
    setProvider(sa.provider);
    setModel(sa.model);
    if (sa.enabled_tools.length === 0) {
      setAllToolsMode(true);
      setEnabledTools(new Set());
    } else {
      setAllToolsMode(false);
      setEnabledTools(new Set(sa.enabled_tools));
    }
    // Parse instruction blocks from saved data
    const parsed = parseInstructionBlocksSetting(sa.instruction_blocks || '');
    setInstructionBlocks(ensureSubAgentManagedBlocks(parsed.length > 0 ? parsed : defaultSubAgentInstructionBlocks()));
    setInstructionEstimate(null);
    setInstructionEstimateError(null);
    setIsFormOpen(true);
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const serializedBlocks = serializeInstructionBlocksSetting(
        instructionBlocks
          .filter((block) => isManagedInstructionBlockType(block.type) || block.value.trim() !== ''),
      ) || '[]';

      const payload = {
        name: name.trim(),
        provider,
        model,
        enabled_tools: allToolsMode ? [] : Array.from(enabledTools),
        instruction_blocks: serializedBlocks,
      };

      if (editingId) {
        const updated = await updateSubAgent(editingId, payload);
        setSubAgents(prev => prev.map(a => a.id === updated.id ? updated : a));
        setSuccess('Sub-agent updated.');
      } else {
        const created = await createSubAgent(payload);
        setSubAgents(prev => [...prev, created]);
        setSuccess('Sub-agent created.');
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sub-agent');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sa: SubAgent) => {
    if (!confirm(`Remove sub-agent "${sa.name}"?`)) return;
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await deleteSubAgent(sa.id);
      setSubAgents(prev => prev.filter(a => a.id !== sa.id));
      if (editingId === sa.id) resetForm();
      setSuccess('Sub-agent removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sub-agent');
    } finally {
      setSaving(false);
    }
  };

  const toggleTool = (toolName: string) => {
    setEnabledTools(prev => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return next;
    });
  };

  const activeProviders = useMemo(
    () => providers.filter(p => p.is_active || p.display_name),
    [providers],
  );

  const providerDisplayName = (type: string) => {
    const found = providers.find(p => p.type === type);
    return found?.display_name || type || '(default)';
  };

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Sub-agents</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">&times;</button>
        </div>
      )}

      {success && (
        <div className="success-banner">
          {success}
          <button onClick={() => setSuccess(null)} className="error-dismiss">&times;</button>
        </div>
      )}

      <div className="page-content page-content-narrow settings-sections">
        <p className="settings-help">
          Create reusable agent configurations with specific LLM providers and tools.
          Sub-agents can be selected when starting sessions, or called by the main agent to delegate tasks.
        </p>

        {loading ? (
          <div className="sessions-loading">Loading sub-agents...</div>
        ) : isFormOpen ? (
          <form className="integration-form" onSubmit={handleSubmit}>
            <div className="integration-form-title-row">
              <h3>{editingId ? 'Edit sub-agent' : 'Create sub-agent'}</h3>
              <button type="button" className="settings-remove-btn" onClick={resetForm}>
                Cancel
              </button>
            </div>

            <div className="settings-group">
              <label className="settings-field">
                <span>Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Research Agent, Code Reviewer"
                />
              </label>

              <label className="settings-field">
                <span>LLM Provider</span>
                <select
                  value={provider}
                  onChange={e => { setProvider(e.target.value); setModel(''); }}
                >
                  <option value="">(Use default provider)</option>
                  {activeProviders.map(p => (
                    <option key={p.type} value={p.type}>
                      {p.display_name || p.type}
                    </option>
                  ))}
                </select>
              </label>

              {provider && (
                <label className="settings-field">
                  <span>Model</span>
                  {loadingModels ? (
                    <input type="text" value="" disabled placeholder="Loading models..." />
                  ) : models.length > 0 ? (
                    <select
                      value={models.includes(model) ? model : ''}
                      onChange={e => setModel(e.target.value)}
                    >
                      <option value="">(Provider default)</option>
                      {models.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      placeholder="Enter model identifier"
                    />
                  )}
                </label>
              )}

              <label className="settings-field integration-toggle">
                <span>All tools (no restrictions)</span>
                <input
                  type="checkbox"
                  checked={allToolsMode}
                  onChange={e => {
                    setAllToolsMode(e.target.checked);
                    if (e.target.checked) setEnabledTools(new Set());
                  }}
                />
              </label>
            </div>

            {!allToolsMode && (
              <div className="settings-group">
                <div className="settings-field">
                  <span>Enabled tools{enabledTools.size > 0 ? ` (${enabledTools.size} selected)` : ''}</span>
                  <div className="subagent-tools-grid">
                    {toolDefs.map(tool => (
                      <label key={tool.name} className="subagent-tool-item">
                        <input
                          type="checkbox"
                          checked={enabledTools.has(tool.name)}
                          onChange={() => toggleTool(tool.name)}
                        />
                        <span>{toolIconForName(tool.name)}</span>
                        <span>{tool.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="settings-group">
              <div className="settings-panel-title-row">
                <h3>Agent instructions</h3>
                <span className="instruction-total-tokens">
                  {isEstimatingInstructions
                    ? 'Calculating...'
                    : enabledInstructionTotalTokens !== null
                      ? getEstimatedTokensLabel(enabledInstructionTotalTokens)
                      : 'No estimate'}
                </span>
              </div>
              {instructionEstimateError ? <p className="settings-error">{instructionEstimateError}</p> : null}
              <p className="settings-help">
                Compose instruction blocks for this sub-agent&apos;s system prompt. By default, only built-in tool guidance is included.
              </p>
              <InstructionBlocksEditor
                blocks={instructionBlocks}
                onChange={setInstructionBlocks}
                disabled={saving}
                blockEstimatedTokens={instructionBlockEstimatedTokens}
                blockEstimatedTokenLabels={instructionBlockEstimatedTokenLabels}
                textPlaceholder="Custom instructions for this sub-agent..."
                filePlaceholder="path/to/instructions.md"
                emptyStateText="No instruction blocks configured."
                managedBlocks={{
                  [BUILTIN_TOOLS_BLOCK_TYPE]: {
                    label: 'Built-in tools',
                    linkTo: '/tools',
                    enabledTitle: 'Enable built-in tools guidance in system prompt',
                    enabledAriaLabel: 'Enable built-in tools block',
                  },
                  [INTEGRATION_SKILLS_BLOCK_TYPE]: {
                    label: 'Integration-backed skills',
                    linkTo: '/tools',
                    enabledTitle: 'Enable integration skills context in system prompt',
                    enabledAriaLabel: 'Enable integration-backed skills block',
                  },
                  [EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE]: {
                    label: 'External markdown skills',
                    linkTo: '/skills',
                    enabledTitle: 'Enable external markdown skills context in system prompt',
                    enabledAriaLabel: 'Enable external markdown skills block',
                  },
                  [MCP_SERVERS_BLOCK_TYPE]: {
                    label: 'MCP servers',
                    linkTo: '/mcp',
                    enabledTitle: 'Enable MCP servers context in system prompt',
                    enabledAriaLabel: 'Enable MCP servers block',
                  },
                }}
              />
            </div>

            <button type="submit" className="settings-add-btn" disabled={saving || !name.trim()}>
              {saving ? 'Saving...' : editingId ? 'Save sub-agent' : 'Create sub-agent'}
            </button>
          </form>
        ) : (
          <div className="mcp-server-list">
            <div className="integration-list-header-row">
              <h3>Configured sub-agents</h3>
              <button type="button" className="settings-add-btn" onClick={openCreateForm}>
                Create sub-agent
              </button>
            </div>

            {sortedAgents.length === 0 ? (
              <EmptyState className="mcp-empty-state">
                <EmptyStateTitle>No sub-agents configured yet.</EmptyStateTitle>
              </EmptyState>
            ) : (
              sortedAgents.map(sa => (
                <article key={sa.id} className="integration-card mcp-server-card">
                  <div className="integration-card-headline">
                    <div className="integration-card-title-wrap">
                      <h3>{sa.name}</h3>
                      <span className="integration-mode-chip">
                        {providerDisplayName(sa.provider)}
                      </span>
                      {sa.model && (
                        <span className="integration-mode-chip">{sa.model}</span>
                      )}
                      <span className="integration-mode-chip">
                        tools: {sa.enabled_tools.length === 0 ? 'all' : sa.enabled_tools.length}
                      </span>
                    </div>
                    <span className="integration-updated">
                      Updated {new Date(sa.updated_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="integration-card-actions">
                    <button type="button" className="settings-add-btn" onClick={() => startEditing(sa)} disabled={saving}>
                      Edit
                    </button>
                    <button type="button" className="settings-remove-btn" onClick={() => handleDelete(sa)} disabled={saving}>
                      Remove
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SubAgentsView;
