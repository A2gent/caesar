import {
  BUILTIN_TOOLS_BLOCK_TYPE,
  buildAgentSystemPromptAppend,
  normalizeInstructionBlocks,
  parseInstructionBlocksSetting,
  serializeInstructionBlocksSetting,
  type InstructionBlock,
} from './instructionBlocks';

describe('instructionBlocks', () => {
  it('normalizes types, drops empty text/file values, and defaults enabled=true', () => {
    const blocks: InstructionBlock[] = [
      { type: 'text', value: '  hello  ', enabled: true },
      { type: 'file', value: '   ', enabled: true },
      { type: 'project_agents_md', value: '', enabled: true },
      { type: 'text', value: '  ', enabled: false },
      { type: BUILTIN_TOOLS_BLOCK_TYPE, value: '', enabled: true },
      { type: 'text', value: 'keep', enabled: false },
    ];

    expect(normalizeInstructionBlocks(blocks)).toEqual([
      { type: 'text', value: 'hello', enabled: true },
      { type: 'project_agents_md', value: '', enabled: true },
      { type: BUILTIN_TOOLS_BLOCK_TYPE, value: '', enabled: true },
      { type: 'text', value: 'keep', enabled: false },
    ]);
  });

  it('parses persisted JSON setting safely', () => {
    expect(parseInstructionBlocksSetting('')).toEqual([]);
    expect(parseInstructionBlocksSetting('{"bad":true}')).toEqual([]);
    expect(parseInstructionBlocksSetting('not-json')).toEqual([]);

    const parsed = parseInstructionBlocksSetting(
      JSON.stringify([
        { type: 'file', value: ' /tmp/rules.md ', enabled: false },
        { type: 'nope', value: ' free text ' },
        { type: 'text', value: 123 },
      ]),
    );

    expect(parsed).toEqual([
      { type: 'file', value: '/tmp/rules.md', enabled: false },
      { type: 'text', value: 'free text', enabled: true },
    ]);
  });

  it('serializes normalized blocks and returns empty string for empty input', () => {
    expect(serializeInstructionBlocksSetting([])).toBe('');

    const value = serializeInstructionBlocksSetting([
      { type: 'text', value: '  hi ', enabled: true },
      { type: 'text', value: '  ', enabled: true },
    ]);

    expect(value).toBe('[{"type":"text","value":"hi","enabled":true}]');
  });

  it('builds agent prompt append only from enabled non-dynamic blocks', () => {
    const prompt = buildAgentSystemPromptAppend([
      { type: 'text', value: '  Alpha ', enabled: true },
      { type: 'file', value: '/tmp/AGENTS.md', enabled: true },
      { type: 'project_agents_md', value: '', enabled: true },
      { type: BUILTIN_TOOLS_BLOCK_TYPE, value: '', enabled: true },
      { type: 'text', value: 'Hidden', enabled: false },
    ]);

    expect(prompt).toContain('Apply these additional instructions in order:');
    expect(prompt).toContain('Instruction block 1 (text):\nAlpha');
    expect(prompt).toContain('Instruction block 2 (file):\nLoad and follow instructions from this file path: /tmp/AGENTS.md');
    expect(prompt).toContain('Instruction block 3 (dynamic project file):');
    expect(prompt).not.toContain('Hidden');
  });
});
