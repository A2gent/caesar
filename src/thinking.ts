import { parseInstructionBlocksSetting, type InstructionBlock, type InstructionBlockType } from './instructionBlocks';

export const THINKING_JOB_ID_SETTING_KEY = 'A2GENT_THINKING_JOB_ID';
export const THINKING_PROJECT_ID = 'project-thinking';
export const THINKING_SOURCE_SETTING_KEY = 'A2GENT_THINKING_SOURCE';
export const THINKING_SCHEDULE_TEXT_SETTING_KEY = 'A2GENT_THINKING_SCHEDULE_TEXT';
export const THINKING_FREQUENCY_MINUTES_SETTING_KEY = 'A2GENT_THINKING_FREQUENCY_MINUTES';
export const THINKING_FREQUENCY_HOURS_SETTING_KEY = 'A2GENT_THINKING_FREQUENCY_HOURS';
export const THINKING_TEXT_SETTING_KEY = 'A2GENT_THINKING_TEXT';
export const THINKING_FILE_PATH_SETTING_KEY = 'A2GENT_THINKING_FILE_PATH';
export const THINKING_INSTRUCTION_BLOCKS_SETTING_KEY = 'A2GENT_THINKING_INSTRUCTION_BLOCKS';

export type ThinkingInstructionsSource = 'text' | 'file';

export function toThinkingSchedule(minutes: number): string {
  if (minutes <= 1) {
    return 'every minute';
  }
  return `every ${minutes} minutes`;
}

function normalizeLegacySource(value: string): InstructionBlockType {
  return value.trim().toLowerCase() === 'file' ? 'file' : 'text';
}

export function resolveThinkingInstructionBlocks(settings: Record<string, string>): InstructionBlock[] {
  const fromBlocksSetting = parseInstructionBlocksSetting(settings[THINKING_INSTRUCTION_BLOCKS_SETTING_KEY] || '');
  if (fromBlocksSetting.length > 0) {
    return fromBlocksSetting;
  }

  const source = normalizeLegacySource(settings[THINKING_SOURCE_SETTING_KEY] || 'text');
  const text = (settings[THINKING_TEXT_SETTING_KEY] || '').trim();
  const filePath = (settings[THINKING_FILE_PATH_SETTING_KEY] || '').trim();

  if (source === 'file' && filePath !== '') {
    return [{ type: 'file', value: filePath, enabled: true }];
  }
  if (source === 'text' && text !== '') {
    return [{ type: 'text', value: text, enabled: true }];
  }

  if (filePath !== '') {
    return [{ type: 'file', value: filePath, enabled: true }];
  }
  if (text !== '') {
    return [{ type: 'text', value: text, enabled: true }];
  }

  return [];
}

export function hasThinkingFileInstructions(settings: Record<string, string>): boolean {
  return resolveThinkingInstructionBlocks(settings).some((block) => block.type === 'file' && block.value.trim() !== '');
}

export function buildThinkingTaskPrompt(blocks: InstructionBlock[]): string {
  const normalized = blocks
    .map((block) => ({
      type: block.type === 'file' ? 'file' : block.type === 'project_agents_md' ? 'project_agents_md' : 'text',
      value: block.value.trim(),
      enabled: block.enabled !== false,
    }))
    .filter((block) => block.enabled && (block.type === 'project_agents_md' || block.value !== ''));

  const lines = ['Run the Thinking routine.'];

  if (normalized.length === 0) {
    lines.push('Review the current project state, execute the most valuable next step, and summarize outcomes.');
    return lines.join('\n');
  }

  lines.push('Follow the instruction blocks in order:');
  normalized.forEach((block, index) => {
    if (block.type === 'text') {
      lines.push(`Block ${index + 1} (text):`);
      lines.push(block.value);
      return;
    }
    if (block.type === 'file') {
      lines.push(`Block ${index + 1} (file):`);
      lines.push(`Load and follow instructions from this file path: ${block.value}`);
      return;
    }
    lines.push(`Block ${index + 1} (dynamic project file):`);
    lines.push('Load and follow AGENTS.md instructions from the active project folder(s).');
  });

  return lines.join('\n\n');
}
