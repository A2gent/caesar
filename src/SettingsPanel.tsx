import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { browseSkillDirectories, estimateInstructionPrompt, type MindTreeEntry, type SystemPromptSnapshot } from './api';
import InstructionBlocksEditor from './InstructionBlocksEditor';
import {
  AGENT_INSTRUCTION_BLOCKS_SETTING_KEY,
  AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY,
  BUILTIN_TOOLS_BLOCK_TYPE,
  EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE,
  INTEGRATION_SKILLS_BLOCK_TYPE,
  MCP_SERVERS_BLOCK_TYPE,
  buildAgentSystemPromptAppend,
  parseInstructionBlocksSetting,
  type InstructionBlock,
  type InstructionBlockType,
} from './instructionBlocks';
import { SKILLS_MANAGED_SETTING_KEYS } from './skills';

interface SettingsPanelProps {
  settings: Record<string, string>;
  isSaving: boolean;
  onSave: (settings: Record<string, string>) => Promise<void>;
  defaultSystemPrompt?: string;
  defaultSystemPromptWithoutBuiltInTools?: string;
}

interface CustomRow {
  id: string;
  key: string;
  value: string;
}

const CONTEXT_COMPACTION_TRIGGER_PERCENT = 'AAGENT_CONTEXT_COMPACTION_TRIGGER_PERCENT';
const CONTEXT_COMPACTION_PROMPT = 'AAGENT_CONTEXT_COMPACTION_PROMPT';
const LLM_RETRIES = 'AAGENT_LLM_RETRIES';
const SESSIONS_FOLDER = 'AAGENT_SESSIONS_FOLDER';
const REPEAT_INITIAL_PROMPT = 'AAGENT_REPEAT_INITIAL_PROMPT';
const DEFAULT_COMPACTION_TRIGGER = '80';
const DEFAULT_COMPACTION_PROMPT = 'Create a concise continuation summary preserving goals, progress, constraints, and next actions.';
const DEFAULT_LLM_RETRIES = '3';

const MANAGED_INSTRUCTION_BLOCK_TYPES: InstructionBlockType[] = [
  BUILTIN_TOOLS_BLOCK_TYPE,
  INTEGRATION_SKILLS_BLOCK_TYPE,
  EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE,
  MCP_SERVERS_BLOCK_TYPE,
];

function isManagedInstructionBlockType(type: InstructionBlockType): boolean {
  return MANAGED_INSTRUCTION_BLOCK_TYPES.includes(type);
}

function normalizeInstructionBlockForSettings(block: InstructionBlock): InstructionBlock {
  return {
    type: (
      block.type === 'file'
        ? 'file'
        : block.type === 'project_agents_md'
          ? 'project_agents_md'
          : block.type === BUILTIN_TOOLS_BLOCK_TYPE
            ? BUILTIN_TOOLS_BLOCK_TYPE
            : block.type === INTEGRATION_SKILLS_BLOCK_TYPE
              ? INTEGRATION_SKILLS_BLOCK_TYPE
              : block.type === EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE
                ? EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE
                : block.type === MCP_SERVERS_BLOCK_TYPE
                  ? MCP_SERVERS_BLOCK_TYPE
                : 'text'
    ) as InstructionBlockType,
    value: block.value.trim(),
    enabled: block.enabled !== false,
  };
}

function ensureManagedInstructionBlocks(blocks: InstructionBlock[]): InstructionBlock[] {
  const normalizedBlocks: InstructionBlock[] = [];
  const seenManagedTypes = new Set<InstructionBlockType>();
  for (const block of blocks) {
    const normalized = normalizeInstructionBlockForSettings(block);
    if (isManagedInstructionBlockType(normalized.type)) {
      if (seenManagedTypes.has(normalized.type)) {
        continue;
      }
      seenManagedTypes.add(normalized.type);
      normalizedBlocks.push({ ...normalized, value: '' });
      continue;
    }
    normalizedBlocks.push(normalized);
  }

  for (const type of MANAGED_INSTRUCTION_BLOCK_TYPES) {
    if (seenManagedTypes.has(type)) {
      continue;
    }
    normalizedBlocks.push({ type, value: '', enabled: true });
  }
  return normalizedBlocks;
}

const AGENT_NAME_SETTING_KEY = 'AAGENT_NAME';

const MANAGED_KEYS = [
  ...SKILLS_MANAGED_SETTING_KEYS,
  CONTEXT_COMPACTION_TRIGGER_PERCENT,
  CONTEXT_COMPACTION_PROMPT,
  LLM_RETRIES,
  SESSIONS_FOLDER,
  REPEAT_INITIAL_PROMPT,
  AGENT_INSTRUCTION_BLOCKS_SETTING_KEY,
  AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY,
  'SAG_VOICE_ID',
  'AAGENT_SAY_VOICE',
  AGENT_NAME_SETTING_KEY,
] as const;

const HIDDEN_CUSTOM_KEYS = new Set<string>([...MANAGED_KEYS]);
const REMOVED_ENV_KEYS = new Set<string>([
  'KIMI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
]);

function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return upper.includes('KEY') || upper.includes('TOKEN') || upper.includes('SECRET') || upper.includes('PASSWORD');
}

function shouldShowCustomKey(key: string): boolean {
  return !HIDDEN_CUSTOM_KEYS.has(key) && !REMOVED_ENV_KEYS.has(key);
}

function normalizeCompactionTriggerPercent(value: string): string {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) {
    return DEFAULT_COMPACTION_TRIGGER;
  }

  const clamped = Math.max(5, Math.min(100, parsed));
  const snapped = Math.round(clamped / 5) * 5;
  return String(Math.max(5, Math.min(100, snapped)));
}

function getEstimatedTokensLabel(tokens: number | null | undefined): string {
  return `${tokens ?? 0} tokens`;
}

function getApproxEstimatedTokensLabel(tokens: number | null | undefined): string {
  return `~${tokens ?? 0} tokens`;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  isSaving,
  onSave,
  defaultSystemPrompt = '',
  defaultSystemPromptWithoutBuiltInTools = '',
}) => {
  const [customRows, setCustomRows] = useState<CustomRow[]>(() => {
    const rows: CustomRow[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (shouldShowCustomKey(key)) {
        rows.push({ id: crypto.randomUUID(), key, value });
      }
    }
    return rows;
  });

  const [compactionTriggerPercent, setCompactionTriggerPercent] = useState(
    normalizeCompactionTriggerPercent(settings[CONTEXT_COMPACTION_TRIGGER_PERCENT] || DEFAULT_COMPACTION_TRIGGER),
  );
  const [compactionPrompt, setCompactionPrompt] = useState(settings[CONTEXT_COMPACTION_PROMPT] || DEFAULT_COMPACTION_PROMPT);
  const [llmRetries, setLlmRetries] = useState(settings[LLM_RETRIES] || DEFAULT_LLM_RETRIES);
  const [sessionsFolder, setSessionsFolder] = useState(settings[SESSIONS_FOLDER] || '');
  const [repeatInitialPrompt, setRepeatInitialPrompt] = useState(settings[REPEAT_INITIAL_PROMPT] !== 'false');
  const [isSessionsFolderPickerOpen, setIsSessionsFolderPickerOpen] = useState(false);
  const [sessionsFolderBrowsePath, setSessionsFolderBrowsePath] = useState('');
  const [sessionsFolderBrowseEntries, setSessionsFolderBrowseEntries] = useState<MindTreeEntry[]>([]);
  const [isSessionsFolderBrowseLoading, setIsSessionsFolderBrowseLoading] = useState(false);
  const [agentInstructionBlocks, setAgentInstructionBlocks] = useState<InstructionBlock[]>(
    ensureManagedInstructionBlocks(parseInstructionBlocksSetting(settings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '')),
  );

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [instructionEstimate, setInstructionEstimate] = useState<SystemPromptSnapshot | null>(null);
  const [instructionEstimateError, setInstructionEstimateError] = useState<string | null>(null);
  const [isEstimatingInstructions, setIsEstimatingInstructions] = useState(false);

  useEffect(() => {
    const rows: CustomRow[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (shouldShowCustomKey(key)) {
        rows.push({ id: crypto.randomUUID(), key, value });
      }
    }
    setCustomRows(rows);

    setCompactionTriggerPercent(normalizeCompactionTriggerPercent(settings[CONTEXT_COMPACTION_TRIGGER_PERCENT] || DEFAULT_COMPACTION_TRIGGER));
    setCompactionPrompt(settings[CONTEXT_COMPACTION_PROMPT] || DEFAULT_COMPACTION_PROMPT);
    setLlmRetries(settings[LLM_RETRIES] || DEFAULT_LLM_RETRIES);
    setSessionsFolder(settings[SESSIONS_FOLDER] || '');
    setAgentInstructionBlocks(ensureManagedInstructionBlocks(parseInstructionBlocksSetting(settings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '')));
  }, [settings]);

  const compactionTriggerValue = Number.parseFloat(compactionTriggerPercent);
  const compactionTriggerProgress = Number.isFinite(compactionTriggerValue)
    ? Math.max(5, Math.min(100, compactionTriggerValue))
    : Number.parseFloat(DEFAULT_COMPACTION_TRIGGER);

  const canSave = useMemo(() => {
    return !isSaving;
  }, [isSaving]);

  const estimatedBlocks = instructionEstimate?.blocks || [];
  const instructionBlockEstimatedTokens = useMemo(() => {
    const estimateQueue = [...estimatedBlocks];
    return agentInstructionBlocks.map((block) => {
      const nextType = normalizeInstructionBlockForSettings(block).type;
      const estimateIndex = estimateQueue.findIndex((estimate) => estimate.type === nextType);
      if (estimateIndex < 0) {
        return 0;
      }
      const [estimate] = estimateQueue.splice(estimateIndex, 1);
      return estimate?.estimated_tokens ?? 0;
    });
  }, [agentInstructionBlocks, estimatedBlocks]);

  const instructionBlockEstimatedTokenLabels = useMemo(() => {
    return agentInstructionBlocks.map((block, index) => {
      const tokens = instructionBlockEstimatedTokens[index] ?? 0;
      const isIncludedInPrompt = block.enabled !== false
        && (isManagedInstructionBlockType(block.type) || block.type === 'project_agents_md' || block.value.trim() !== '');
      if (block.type === 'project_agents_md' && isIncludedInPrompt) {
        return getApproxEstimatedTokensLabel(tokens);
      }
      return getEstimatedTokensLabel(tokens);
    });
  }, [agentInstructionBlocks, instructionBlockEstimatedTokens]);

  const builtInToolsBlock = useMemo(
    () => agentInstructionBlocks.find((block) => block.type === BUILTIN_TOOLS_BLOCK_TYPE),
    [agentInstructionBlocks],
  );
  const builtInToolsEnabled = builtInToolsBlock?.enabled !== false;
  const builtInToolsBlockTokens = useMemo(() => {
    const index = agentInstructionBlocks.findIndex((block) => block.type === BUILTIN_TOOLS_BLOCK_TYPE);
    if (index < 0) {
      return 0;
    }
    return instructionBlockEstimatedTokens[index] ?? 0;
  }, [agentInstructionBlocks, instructionBlockEstimatedTokens]);
  const activeBuiltInPrompt = builtInToolsEnabled ? defaultSystemPrompt : defaultSystemPromptWithoutBuiltInTools;
  const alternateBuiltInPrompt = builtInToolsEnabled ? defaultSystemPromptWithoutBuiltInTools : defaultSystemPrompt;

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

  const buildInstructionSettingsDraft = (): Record<string, string> => {
    const serializedAgentBlocks = ensureManagedInstructionBlocks(
      agentInstructionBlocks
        .map((block) => normalizeInstructionBlockForSettings(block))
        .filter((block) => isManagedInstructionBlockType(block.type) || (block.enabled && (block.type === 'project_agents_md' || block.value !== ''))),
    );

    return {
      ...settings,
      [AGENT_INSTRUCTION_BLOCKS_SETTING_KEY]: JSON.stringify(serializedAgentBlocks),
      [AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY]: buildAgentSystemPromptAppend(serializedAgentBlocks),
    };
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      setIsEstimatingInstructions(true);
      setInstructionEstimateError(null);
      try {
        const draftSettings = buildInstructionSettingsDraft();
        const response = await estimateInstructionPrompt(draftSettings);
        setInstructionEstimate(response.snapshot);
      } catch (error) {
        setInstructionEstimateError(error instanceof Error ? error.message : 'Failed to estimate instruction tokens');
      } finally {
        setIsEstimatingInstructions(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [settings, agentInstructionBlocks]);

  const addRow = () => {
    setCustomRows((prev) => [...prev, { id: crypto.randomUUID(), key: '', value: '' }]);
  };

  const updateRow = (id: string, field: 'key' | 'value', next: string) => {
    setCustomRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: next } : row)));
  };

  const removeRow = (id: string) => {
    setCustomRows((prev) => prev.filter((row) => row.id !== id));
  };

  const loadSessionsFolderBrowse = async (path: string) => {
    setIsSessionsFolderBrowseLoading(true);
    try {
      const response = await browseSkillDirectories(path);
      setSessionsFolderBrowsePath(response.path);
      setSessionsFolderBrowseEntries(response.entries);
    } catch {
      // silently ignore browse errors
    } finally {
      setIsSessionsFolderBrowseLoading(false);
    }
  };

  const openSessionsFolderPicker = async () => {
    setIsSessionsFolderPickerOpen(true);
    await loadSessionsFolderBrowse(sessionsFolder || '');
  };

  const getParentPath = (path: string): string => {
    const trimmed = path.replace(/[\\/]+$/, '');
    if (trimmed === '' || trimmed === '/') return '/';
    const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    if (separatorIndex <= 0) return '/';
    return trimmed.slice(0, separatorIndex);
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(null);

    const payload: Record<string, string> = {};
    for (const key of SKILLS_MANAGED_SETTING_KEYS) {
      const value = settings[key];
      if (value === undefined || value.trim() === '') {
        continue;
      }
      payload[key] = value;
    }

    const compactionTrigger = Number.parseFloat(normalizeCompactionTriggerPercent(compactionTriggerPercent));
    if (!Number.isFinite(compactionTrigger) || compactionTrigger <= 0 || compactionTrigger > 100) {
      setSaveError('Context compaction trigger must be a number between 0 and 100.');
      return;
    }
    payload[CONTEXT_COMPACTION_TRIGGER_PERCENT] = String(compactionTrigger);

    const trimmedCompactionPrompt = compactionPrompt.trim();
    if (trimmedCompactionPrompt === '') {
      setSaveError('Context compaction prompt is required.');
      return;
    }
    payload[CONTEXT_COMPACTION_PROMPT] = trimmedCompactionPrompt;

    const retriesValue = Number.parseInt(llmRetries.trim(), 10);
    if (!Number.isFinite(retriesValue) || retriesValue < 0 || retriesValue > 10) {
      setSaveError('LLM retries must be a number between 0 and 10.');
      return;
    }
    payload[LLM_RETRIES] = String(retriesValue);

    const trimmedSessionsFolder = sessionsFolder.trim();
    if (trimmedSessionsFolder !== '') {
      payload[SESSIONS_FOLDER] = trimmedSessionsFolder;
    }

    const trimmedRepeatInitialPrompt = repeatInitialPrompt;
    payload[REPEAT_INITIAL_PROMPT] = trimmedRepeatInitialPrompt ? 'true' : 'false';

    const draftSettings = buildInstructionSettingsDraft();
    payload[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] = draftSettings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '';
    payload[AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY] = draftSettings[AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY] || '';

    for (const row of customRows) {
      const key = row.key.trim();
      if (!key || REMOVED_ENV_KEYS.has(key)) {
        continue;
      }
      payload[key] = row.value.trim();
    }

    try {
      await onSave(payload);
      setSaveSuccess('Settings saved and synced to backend.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save settings');
    }
  };

  return (
    <>
      <div className="settings-panel">
        <div className="settings-panel-title-row">
          <h2>Agent instructions</h2>
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
          Compose reusable instruction blocks for the agent system prompt. Thinking runs inherit these and can add extra blocks.
        </p>
        <div className="settings-actions">
          <Link to="/tools" className="settings-add-btn">
            Open Tools
          </Link>
        </div>
        <InstructionBlocksEditor
          blocks={agentInstructionBlocks}
          onChange={setAgentInstructionBlocks}
          disabled={isSaving}
          blockEstimatedTokens={instructionBlockEstimatedTokens}
          blockEstimatedTokenLabels={instructionBlockEstimatedTokenLabels}
          textPlaceholder="Global instructions that should always apply..."
          filePlaceholder="notes/agent-rules.md"
          emptyStateText="No instruction blocks configured."
          showOpenInMyMind
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
        {defaultSystemPrompt || defaultSystemPromptWithoutBuiltInTools ? (
          <details className="builtin-system-prompt">
            <summary>
              Built-in tools prompt text ({builtInToolsBlockTokens} tokens, {builtInToolsEnabled ? 'enabled variant active' : 'disabled variant active'})
            </summary>
            <p className="settings-help">
              This is the hard-coded base prompt variant. It is only used when <code>AAGENT_SYSTEM_PROMPT</code> is not set.
            </p>
            <div className="builtin-system-prompt-panels">
              <div className="builtin-system-prompt-panel">
                <h3>Active variant</h3>
                <pre>{activeBuiltInPrompt}</pre>
              </div>
              <div className="builtin-system-prompt-panel">
                <h3>Other variant</h3>
                <pre>{alternateBuiltInPrompt}</pre>
              </div>
            </div>
          </details>
        ) : null}
      </div>

      <div className="settings-panel">
        <h2>LLM Reliability</h2>
        <p className="settings-help">
          Configure retry behavior when LLM providers fail due to network issues or temporary errors.
        </p>
        <div className="settings-group">
          <label className="settings-field">
            <span>Retries per provider</span>
            <input
              type="number"
              min="0"
              max="10"
              value={llmRetries}
              onChange={(e) => setLlmRetries(e.target.value)}
              style={{ width: '80px' }}
            />
            <span className="settings-field-hint">
              Number of retry attempts before switching to next provider in fallback chain (0-10)
            </span>
          </label>
        </div>
      </div>

      <div className="settings-panel">
        <h2>Session logs</h2>
        <p className="settings-help">
          Save every session as a JSONL file. Each session gets its own file named{' '}
          <code>&lt;session-id&gt;.jsonl</code>. New messages and tool-call results are
          appended as they happen. Leave blank to disable.
        </p>
        <div className="settings-group">
          <label className="settings-field">
            <span>Sessions folder</span>
            <div className="tool-folder-picker-row">
              <input
                type="text"
                value={sessionsFolder}
                onChange={(e) => setSessionsFolder(e.target.value)}
                placeholder="~/.local/share/aagent/sessions (default)"
                autoComplete="off"
              />
              <button type="button" className="settings-add-btn" onClick={() => void openSessionsFolderPicker()}>
                Browse
              </button>
            </div>
            <span className="settings-field-hint">
              Folder where per-session JSONL log files are stored. Defaults to the <code>sessions/</code> subfolder next to the SQLite database (<code>~/.local/share/aagent/sessions</code>).
            </span>
          </label>
        </div>
      </div>

      {isSessionsFolderPickerOpen ? (
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose sessions folder">
          <div className="mind-picker-dialog">
            <h2>Choose sessions folder</h2>
            <div className="mind-picker-path">{sessionsFolderBrowsePath || 'Loading...'}</div>
            <div className="mind-picker-actions">
              <button
                type="button"
                className="settings-add-btn"
                onClick={() => void loadSessionsFolderBrowse(getParentPath(sessionsFolderBrowsePath))}
                disabled={isSessionsFolderBrowseLoading || sessionsFolderBrowsePath === '' || getParentPath(sessionsFolderBrowsePath) === sessionsFolderBrowsePath}
              >
                Up
              </button>
              <button
                type="button"
                className="settings-save-btn"
                onClick={() => {
                  setSessionsFolder(sessionsFolderBrowsePath);
                  setIsSessionsFolderPickerOpen(false);
                }}
                disabled={isSessionsFolderBrowseLoading || sessionsFolderBrowsePath.trim() === ''}
              >
                Use this folder
              </button>
              <button type="button" className="settings-remove-btn" onClick={() => setIsSessionsFolderPickerOpen(false)}>
                Cancel
              </button>
            </div>
            <div className="mind-picker-list">
              {!isSessionsFolderBrowseLoading && sessionsFolderBrowseEntries.length === 0 ? (
                <div className="sessions-empty">No sub-folders found.</div>
              ) : null}
              {sessionsFolderBrowseEntries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className="mind-picker-item"
                  onClick={() => void loadSessionsFolderBrowse(entry.path)}
                >
                  📁 {entry.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="settings-panel">
        <h2>Context compaction</h2>
        <p className="settings-help">
          Automatically compact conversation context when usage is high, then continue from a fresh context window.
        </p>
        <div className="settings-group">
          <label className="settings-field">
            <span>Trigger at context usage (%)</span>
            <div className="compaction-slider-wrap">
              <input
                className="compaction-slider"
                type="range"
                min="5"
                max="100"
                step="5"
                value={compactionTriggerPercent}
                style={{ '--compaction-slider-progress': `${compactionTriggerProgress}%` } as React.CSSProperties}
                onChange={(e) => setCompactionTriggerPercent(normalizeCompactionTriggerPercent(e.target.value))}
              />
              <div
                className="compaction-slider-value"
                style={{ '--compaction-slider-progress': `${compactionTriggerProgress}%` } as React.CSSProperties}
              >
                {Math.round(compactionTriggerProgress)}%
              </div>
            </div>
          </label>
          <label className="settings-field">
            <span>Compaction prompt</span>
            <textarea
              className="compaction-prompt"
              value={compactionPrompt}
              onChange={(e) => setCompactionPrompt(e.target.value)}
              placeholder="How the model should summarize before resetting context"
              rows={6}
            />
          </label>
        </div>
      </div>

      <div className="settings-panel">
        <h2>User prompt</h2>
        <p className="settings-help">
          Configure behavior for user prompts.
        </p>
        <div className="settings-group">
          <label className="settings-field settings-field-checkbox">
            <input
              type="checkbox"
              checked={repeatInitialPrompt}
              onChange={(e) => setRepeatInitialPrompt(e.target.checked)}
            />
            <span>Repeat initial prompt</span>
            <span className="settings-field-hint">
              When enabled and the initial prompt is under 600 characters, repeat the query at the start of each new session. Research shows this improves model behavior.
              {' '}
              <a href="https://arxiv.org/pdf/2512.14982" target="_blank" rel="noopener noreferrer">
                Why this matters
              </a>
            </span>
          </label>
        </div>
      </div>

      <div className="settings-panel">
        <h2>Environment variables</h2>
        <p className="settings-help">
          Values are stored in backend SQLite and synced into backend environment variables for agent/tool commands.
        </p>

        <div className="settings-custom-header">
          <h3>Environment variables</h3>
          <button type="button" onClick={addRow} className="settings-add-btn">Add</button>
        </div>

        <div className="settings-custom-list">
          {customRows.map((row) => (
            <div key={row.id} className="settings-custom-row">
              <input
                type="text"
                value={row.key}
                onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                placeholder="ENV_VAR_NAME"
                autoComplete="off"
              />
              <input
                type={isSecretKey(row.key) ? 'password' : 'text'}
                value={row.value}
                onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                placeholder="value"
                autoComplete="off"
              />
              <button type="button" onClick={() => removeRow(row.id)} className="settings-remove-btn">Remove</button>
            </div>
          ))}
        </div>

        {saveError && <div className="settings-error">{saveError}</div>}
        {saveSuccess && <div className="settings-success">{saveSuccess}</div>}

        <button type="button" onClick={handleSave} className="settings-save-btn" disabled={!canSave}>
          {isSaving ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </>
  );
};

export default SettingsPanel;
