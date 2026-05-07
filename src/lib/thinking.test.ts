import {
  THINKING_FILE_PATH_SETTING_KEY,
  THINKING_INSTRUCTION_BLOCKS_SETTING_KEY,
  THINKING_SOURCE_SETTING_KEY,
  THINKING_TEXT_SETTING_KEY,
  buildThinkingTaskPrompt,
  hasThinkingFileInstructions,
  resolveThinkingInstructionBlocks,
  toThinkingSchedule,
} from './thinking';

describe('thinking', () => {
  it('formats schedule text', () => {
    expect(toThinkingSchedule(1)).toBe('every minute');
    expect(toThinkingSchedule(0)).toBe('every minute');
    expect(toThinkingSchedule(5)).toBe('every 5 minutes');
  });

  it('prefers explicit instruction block setting over legacy fields', () => {
    const settings = {
      [THINKING_INSTRUCTION_BLOCKS_SETTING_KEY]: '[{"type":"file","value":"/tmp/rules.md","enabled":true}]',
      [THINKING_SOURCE_SETTING_KEY]: 'text',
      [THINKING_TEXT_SETTING_KEY]: 'legacy text',
    };

    expect(resolveThinkingInstructionBlocks(settings)).toEqual([
      { type: 'file', value: '/tmp/rules.md', enabled: true },
    ]);
  });

  it('falls back to legacy source selection and heuristics', () => {
    expect(resolveThinkingInstructionBlocks({
      [THINKING_SOURCE_SETTING_KEY]: 'file',
      [THINKING_FILE_PATH_SETTING_KEY]: ' /tmp/think.md ',
      [THINKING_TEXT_SETTING_KEY]: 'note',
    })).toEqual([{ type: 'file', value: '/tmp/think.md', enabled: true }]);

    expect(resolveThinkingInstructionBlocks({
      [THINKING_SOURCE_SETTING_KEY]: 'text',
      [THINKING_TEXT_SETTING_KEY]: '  think hard  ',
    })).toEqual([{ type: 'text', value: 'think hard', enabled: true }]);

    expect(resolveThinkingInstructionBlocks({
      [THINKING_FILE_PATH_SETTING_KEY]: '/tmp/fallback.md',
    })).toEqual([{ type: 'file', value: '/tmp/fallback.md', enabled: true }]);
  });

  it('detects file instructions and builds prompt conditionally', () => {
    expect(hasThinkingFileInstructions({
      [THINKING_FILE_PATH_SETTING_KEY]: ' /tmp/think.md ',
    })).toBe(true);

    expect(hasThinkingFileInstructions({
      [THINKING_TEXT_SETTING_KEY]: 'hello',
    })).toBe(false);

    const promptWithBlocks = buildThinkingTaskPrompt([
      { type: 'text', value: 'Do X', enabled: true },
    ]);
    expect(promptWithBlocks).toContain('Apply the Thinking-specific system instruction blocks configured in Thinking settings.');

    const promptWithoutBlocks = buildThinkingTaskPrompt([
      { type: 'text', value: 'Do X', enabled: false },
      { type: 'text', value: '   ', enabled: true },
    ]);
    expect(promptWithoutBlocks).not.toContain('Apply the Thinking-specific system instruction blocks configured in Thinking settings.');
  });
});
