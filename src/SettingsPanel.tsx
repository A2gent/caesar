import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { estimateInstructionPrompt, type SystemPromptSnapshot } from './api';
import InstructionBlocksEditor from './InstructionBlocksEditor';
import {
  AGENT_INSTRUCTION_BLOCKS_SETTING_KEY,
  AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY,
  BUILTIN_TOOLS_BLOCK_TYPE,
  EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE,
  INTEGRATION_SKILLS_BLOCK_TYPE,
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
}

interface CustomRow {
  id: string;
  key: string;
  value: string;
}

const CONTEXT_COMPACTION_TRIGGER_PERCENT = 'AAGENT_CONTEXT_COMPACTION_TRIGGER_PERCENT';
const CONTEXT_COMPACTION_PROMPT = 'AAGENT_CONTEXT_COMPACTION_PROMPT';
const DEFAULT_COMPACTION_TRIGGER = '80';
const DEFAULT_COMPACTION_PROMPT = 'Create a concise continuation summary preserving goals, progress, constraints, and next actions.';

function splitAgentInstructionBlocks(blocks: InstructionBlock[]): {
  builtInToolsEnabled: boolean;
  integrationSkillsEnabled: boolean;
  externalMarkdownSkillsEnabled: boolean;
  customBlocks: InstructionBlock[];
} {
  let builtInToolsEnabled = true;
  let integrationSkillsEnabled = true;
  let externalMarkdownSkillsEnabled = true;
  const customBlocks: InstructionBlock[] = [];
  for (const block of blocks) {
    if (block.type === BUILTIN_TOOLS_BLOCK_TYPE) {
      builtInToolsEnabled = block.enabled !== false;
      continue;
    }
    if (block.type === INTEGRATION_SKILLS_BLOCK_TYPE) {
      integrationSkillsEnabled = block.enabled !== false;
      continue;
    }
    if (block.type === EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE) {
      externalMarkdownSkillsEnabled = block.enabled !== false;
      continue;
    }
    customBlocks.push(block);
  }
  return { builtInToolsEnabled, integrationSkillsEnabled, externalMarkdownSkillsEnabled, customBlocks };
}

const MANAGED_KEYS = [
  ...SKILLS_MANAGED_SETTING_KEYS,
  CONTEXT_COMPACTION_TRIGGER_PERCENT,
  CONTEXT_COMPACTION_PROMPT,
  AGENT_INSTRUCTION_BLOCKS_SETTING_KEY,
  AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY,
  'SAG_VOICE_ID',
  'AAGENT_SAY_VOICE',
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

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, isSaving, onSave }) => {
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
  const [agentInstructionBlocks, setAgentInstructionBlocks] = useState<InstructionBlock[]>(
    splitAgentInstructionBlocks(parseInstructionBlocksSetting(settings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '')).customBlocks,
  );
  const [builtInToolsEnabled, setBuiltInToolsEnabled] = useState<boolean>(
    splitAgentInstructionBlocks(parseInstructionBlocksSetting(settings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '')).builtInToolsEnabled,
  );
  const [integrationSkillsEnabled, setIntegrationSkillsEnabled] = useState<boolean>(
    splitAgentInstructionBlocks(parseInstructionBlocksSetting(settings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '')).integrationSkillsEnabled,
  );
  const [externalMarkdownSkillsEnabled, setExternalMarkdownSkillsEnabled] = useState<boolean>(
    splitAgentInstructionBlocks(parseInstructionBlocksSetting(settings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '')).externalMarkdownSkillsEnabled,
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
    const splitBlocks = splitAgentInstructionBlocks(parseInstructionBlocksSetting(settings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || ''));
    setAgentInstructionBlocks(splitBlocks.customBlocks);
    setBuiltInToolsEnabled(splitBlocks.builtInToolsEnabled);
    setIntegrationSkillsEnabled(splitBlocks.integrationSkillsEnabled);
    setExternalMarkdownSkillsEnabled(splitBlocks.externalMarkdownSkillsEnabled);
  }, [settings]);

  const compactionTriggerValue = Number.parseFloat(compactionTriggerPercent);
  const compactionTriggerProgress = Number.isFinite(compactionTriggerValue)
    ? Math.max(5, Math.min(100, compactionTriggerValue))
    : Number.parseFloat(DEFAULT_COMPACTION_TRIGGER);

  const canSave = useMemo(() => {
    return !isSaving;
  }, [isSaving]);

  const estimatedBlocks = instructionEstimate?.blocks || [];
  const builtInToolsEstimatedTokens = estimatedBlocks.find((block) => block.type === BUILTIN_TOOLS_BLOCK_TYPE)?.estimated_tokens ?? 0;
  const integrationSkillsEstimatedTokens = estimatedBlocks.find((block) => block.type === INTEGRATION_SKILLS_BLOCK_TYPE)?.estimated_tokens ?? 0;
  const externalMarkdownSkillsEstimatedTokens = estimatedBlocks.find((block) => block.type === EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE)?.estimated_tokens ?? 0;

  const customEstimatedBlocks = useMemo(() => {
    return estimatedBlocks.filter((block) => (
      block.type !== BUILTIN_TOOLS_BLOCK_TYPE
      && block.type !== INTEGRATION_SKILLS_BLOCK_TYPE
      && block.type !== EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE
    ));
  }, [estimatedBlocks]);

  const customBlockEstimatedTokens = useMemo(() => {
    const perBlockTokens: Array<number | null> = [];
    let estimateIndex = 0;
    for (const block of agentInstructionBlocks) {
      const isIncludedInPrompt = block.enabled !== false && (block.type === 'project_agents_md' || block.value.trim() !== '');
      if (!isIncludedInPrompt) {
        perBlockTokens.push(0);
        continue;
      }
      perBlockTokens.push(customEstimatedBlocks[estimateIndex]?.estimated_tokens ?? 0);
      estimateIndex += 1;
    }
    return perBlockTokens;
  }, [agentInstructionBlocks, customEstimatedBlocks]);

  const customBlockEstimatedTokenLabels = useMemo(() => {
    return agentInstructionBlocks.map((block, index) => {
      const tokens = customBlockEstimatedTokens[index] ?? 0;
      const isIncludedInPrompt = block.enabled !== false && (block.type === 'project_agents_md' || block.value.trim() !== '');
      if (block.type === 'project_agents_md' && isIncludedInPrompt) {
        return getApproxEstimatedTokensLabel(tokens);
      }
      return getEstimatedTokensLabel(tokens);
    });
  }, [agentInstructionBlocks, customBlockEstimatedTokens]);

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
    const normalizedAgentBlocks = agentInstructionBlocks
      .map((block): InstructionBlock => ({
        type: (
          block.type === 'file'
            ? 'file'
            : block.type === 'project_agents_md'
              ? 'project_agents_md'
              : 'text'
        ) as InstructionBlockType,
        value: block.value.trim(),
        enabled: block.enabled !== false,
      }))
      .filter((block) => block.enabled && (block.type === 'project_agents_md' || block.value !== ''));
    const serializedAgentBlocks: InstructionBlock[] = [
      { type: BUILTIN_TOOLS_BLOCK_TYPE, value: '', enabled: builtInToolsEnabled },
      { type: INTEGRATION_SKILLS_BLOCK_TYPE, value: '', enabled: integrationSkillsEnabled },
      { type: EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE, value: '', enabled: externalMarkdownSkillsEnabled },
      ...normalizedAgentBlocks,
    ];

    return {
      ...settings,
      [AGENT_INSTRUCTION_BLOCKS_SETTING_KEY]: JSON.stringify(serializedAgentBlocks),
      [AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY]: buildAgentSystemPromptAppend(normalizedAgentBlocks),
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
  }, [settings, agentInstructionBlocks, builtInToolsEnabled, integrationSkillsEnabled, externalMarkdownSkillsEnabled]);

  const addRow = () => {
    setCustomRows((prev) => [...prev, { id: crypto.randomUUID(), key: '', value: '' }]);
  };

  const updateRow = (id: string, field: 'key' | 'value', next: string) => {
    setCustomRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: next } : row)));
  };

  const removeRow = (id: string) => {
    setCustomRows((prev) => prev.filter((row) => row.id !== id));
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
          <Link to="/skills" className="settings-add-btn">
            Open Skills
          </Link>
        </div>
        <div className="instruction-block instruction-block-singleline">
          <div className="instruction-block-singleline-main">
            <Link to="/skills" className="instruction-block-link">Built-in tools</Link>
            <span className="instruction-block-token-count">{getEstimatedTokensLabel(builtInToolsEnabled ? builtInToolsEstimatedTokens : 0)}</span>
          </div>
          <label className="instruction-block-enabled-toggle" title="Enable built-in tools guidance in system prompt">
            <input
              type="checkbox"
              checked={builtInToolsEnabled}
              onChange={(event) => setBuiltInToolsEnabled(event.target.checked)}
              disabled={isSaving}
              aria-label="Enable built-in tools block"
            />
            <span>Enabled</span>
          </label>
        </div>
        <div className="instruction-block instruction-block-singleline">
          <div className="instruction-block-singleline-main">
            <Link to="/skills" className="instruction-block-link">Integration-backed skills</Link>
            <span className="instruction-block-token-count">{getEstimatedTokensLabel(integrationSkillsEnabled ? integrationSkillsEstimatedTokens : 0)}</span>
          </div>
          <label className="instruction-block-enabled-toggle" title="Enable integration skills context in system prompt">
            <input
              type="checkbox"
              checked={integrationSkillsEnabled}
              onChange={(event) => setIntegrationSkillsEnabled(event.target.checked)}
              disabled={isSaving}
              aria-label="Enable integration-backed skills block"
            />
            <span>Enabled</span>
          </label>
        </div>
        <div className="instruction-block instruction-block-singleline">
          <div className="instruction-block-singleline-main">
            <Link to="/skills" className="instruction-block-link">External markdown skills</Link>
            <span className="instruction-block-token-count">
              {getEstimatedTokensLabel(externalMarkdownSkillsEnabled ? externalMarkdownSkillsEstimatedTokens : 0)}
            </span>
          </div>
          <label className="instruction-block-enabled-toggle" title="Enable external markdown skills context in system prompt">
            <input
              type="checkbox"
              checked={externalMarkdownSkillsEnabled}
              onChange={(event) => setExternalMarkdownSkillsEnabled(event.target.checked)}
              disabled={isSaving}
              aria-label="Enable external markdown skills block"
            />
            <span>Enabled</span>
          </label>
        </div>
        <InstructionBlocksEditor
          blocks={agentInstructionBlocks}
          onChange={setAgentInstructionBlocks}
          disabled={isSaving}
          blockEstimatedTokens={customBlockEstimatedTokens}
          blockEstimatedTokenLabels={customBlockEstimatedTokenLabels}
          textPlaceholder="Global instructions that should always apply..."
          filePlaceholder="notes/agent-rules.md"
          emptyStateText="No global instruction blocks configured."
        />
      </div>

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
