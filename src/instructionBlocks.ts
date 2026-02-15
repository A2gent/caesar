export type InstructionBlockType =
  | 'text'
  | 'file'
  | 'project_agents_md'
  | 'builtin_tools'
  | 'integration_skills'
  | 'external_markdown_skills'
  | 'mcp_servers';

export interface InstructionBlock {
  type: InstructionBlockType;
  value: string;
  enabled: boolean;
}

export const AGENT_INSTRUCTION_BLOCKS_SETTING_KEY = 'A2GENT_AGENT_INSTRUCTION_BLOCKS';
export const AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY = 'AAGENT_SYSTEM_PROMPT_APPEND';
export const BUILTIN_TOOLS_BLOCK_TYPE: InstructionBlockType = 'builtin_tools';
export const INTEGRATION_SKILLS_BLOCK_TYPE: InstructionBlockType = 'integration_skills';
export const EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE: InstructionBlockType = 'external_markdown_skills';
export const MCP_SERVERS_BLOCK_TYPE: InstructionBlockType = 'mcp_servers';

function normalizeBlockType(value: string): InstructionBlockType {
  if (value === 'file') {
    return 'file';
  }
  if (value === 'project_agents_md') {
    return 'project_agents_md';
  }
  if (value === BUILTIN_TOOLS_BLOCK_TYPE) {
    return BUILTIN_TOOLS_BLOCK_TYPE;
  }
  if (value === INTEGRATION_SKILLS_BLOCK_TYPE) {
    return INTEGRATION_SKILLS_BLOCK_TYPE;
  }
  if (value === EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE) {
    return EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE;
  }
  if (value === MCP_SERVERS_BLOCK_TYPE) {
    return MCP_SERVERS_BLOCK_TYPE;
  }
  return 'text';
}

export function normalizeInstructionBlocks(blocks: InstructionBlock[]): InstructionBlock[] {
  const normalized: InstructionBlock[] = [];
  for (const block of blocks) {
    const value = block.value.trim();
    const type = normalizeBlockType(block.type);
    const enabled = block.enabled !== false;
    if (
      type !== 'project_agents_md'
      && type !== BUILTIN_TOOLS_BLOCK_TYPE
      && type !== INTEGRATION_SKILLS_BLOCK_TYPE
      && type !== EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE
      && type !== MCP_SERVERS_BLOCK_TYPE
      && value === ''
    ) {
      continue;
    }
    normalized.push({
      type,
      value,
      enabled,
    });
  }
  return normalized;
}

export function parseInstructionBlocksSetting(raw: string): InstructionBlock[] {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const blocks: InstructionBlock[] = [];
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }
      const record = candidate as { type?: unknown; value?: unknown };
      if (typeof record.value !== 'string') {
        continue;
      }
      const enabled = (candidate as { enabled?: unknown }).enabled;
      blocks.push({
        type: normalizeBlockType(typeof record.type === 'string' ? record.type : 'text'),
        value: record.value,
        enabled: enabled === false ? false : true,
      });
    }

    return normalizeInstructionBlocks(blocks);
  } catch {
    return [];
  }
}

export function serializeInstructionBlocksSetting(blocks: InstructionBlock[]): string {
  const normalized = normalizeInstructionBlocks(blocks);
  if (normalized.length === 0) {
    return '';
  }
  return JSON.stringify(normalized);
}

export function buildAgentSystemPromptAppend(blocks: InstructionBlock[]): string {
  const normalized = normalizeInstructionBlocks(blocks);
  if (normalized.length === 0) {
    return '';
  }

  const sections: string[] = [];
  normalized.forEach((block, index) => {
    if (!block.enabled) {
      return;
    }
    if (
      block.type === BUILTIN_TOOLS_BLOCK_TYPE
      || block.type === INTEGRATION_SKILLS_BLOCK_TYPE
      || block.type === EXTERNAL_MARKDOWN_SKILLS_BLOCK_TYPE
      || block.type === MCP_SERVERS_BLOCK_TYPE
    ) {
      return;
    }
    if (block.type === 'text') {
      sections.push(`Instruction block ${index + 1} (text):\n${block.value}`);
      return;
    }
    if (block.type === 'file') {
      sections.push(`Instruction block ${index + 1} (file):\nLoad and follow instructions from this file path: ${block.value}`);
      return;
    }
    sections.push(`Instruction block ${index + 1} (dynamic project file):\nLoad and follow AGENTS.md instructions from the active project folder.`);
  });

  if (sections.length === 0) {
    return '';
  }

  return ['Apply these additional instructions in order:', ...sections].join('\n\n');
}
