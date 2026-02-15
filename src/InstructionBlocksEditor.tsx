import type { InstructionBlock, InstructionBlockType } from './instructionBlocks';

interface InstructionBlocksEditorProps {
  blocks: InstructionBlock[];
  onChange: (blocks: InstructionBlock[]) => void;
  disabled?: boolean;
  blockEstimatedTokens?: Array<number | null>;
  blockEstimatedTokenLabels?: string[];
  textPlaceholder?: string;
  filePlaceholder?: string;
  addTextLabel?: string;
  addFileLabel?: string;
  emptyStateText?: string;
}

function InstructionBlocksEditor({
  blocks,
  onChange,
  disabled = false,
  blockEstimatedTokens = [],
  blockEstimatedTokenLabels = [],
  textPlaceholder = 'Write instructions...',
  filePlaceholder = 'path/to/instructions.md',
  addTextLabel = 'Add text block',
  addFileLabel = 'Add file block',
  emptyStateText = 'No instruction blocks yet.',
}: InstructionBlocksEditorProps) {
  const addBlock = (type: InstructionBlockType) => {
    onChange([...blocks, { type, value: '', enabled: true }]);
  };

  const updateBlock = (index: number, patch: Partial<InstructionBlock>) => {
    onChange(
      blocks.map((block, currentIndex) => {
        if (currentIndex !== index) {
          return block;
        }
        return {
          type: patch.type ?? block.type,
          value: patch.value ?? block.value,
          enabled: patch.enabled ?? block.enabled,
        };
      }),
    );
  };

  const removeBlock = (index: number) => {
    onChange(blocks.filter((_, currentIndex) => currentIndex !== index));
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= blocks.length) {
      return;
    }

    const nextBlocks = [...blocks];
    const [item] = nextBlocks.splice(index, 1);
    nextBlocks.splice(nextIndex, 0, item);
    onChange(nextBlocks);
  };

  return (
    <div className="instruction-blocks">
      <div className="instruction-blocks-actions">
        <button type="button" className="settings-add-btn" onClick={() => addBlock('text')} disabled={disabled}>
          {addTextLabel}
        </button>
        <button type="button" className="settings-add-btn" onClick={() => addBlock('file')} disabled={disabled}>
          {addFileLabel}
        </button>
      </div>

      {blocks.length === 0 ? <p className="settings-help">{emptyStateText}</p> : null}

      <div className="instruction-blocks-list">
        {blocks.map((block, index) => (
          <div className="instruction-block" key={`${block.type}-${index}`}>
            <div className="instruction-block-toolbar">
              <select
                className="instruction-block-type-select"
                value={block.type}
                onChange={(event) => updateBlock(index, { type: event.target.value as InstructionBlockType })}
                disabled={disabled}
                aria-label="Instruction block type"
              >
                <option value="text">Text</option>
                <option value="file">File path</option>
                <option value="project_agents_md">Project AGENTS.md</option>
              </select>
              <span className="instruction-block-token-count">
                {blockEstimatedTokenLabels[index] || `${blockEstimatedTokens[index] ?? 0} tokens`}
              </span>

              <div className="instruction-block-toolbar-actions">
                <label className="instruction-block-enabled-toggle" title="Enable this block">
                  <input
                    type="checkbox"
                    checked={block.enabled !== false}
                    onChange={(event) => updateBlock(index, { enabled: event.target.checked })}
                    disabled={disabled}
                    aria-label="Enable instruction block"
                  />
                  <span>Enabled</span>
                </label>
                {blocks.length > 1 ? (
                  <>
                    <button
                      type="button"
                      className="settings-add-btn"
                      onClick={() => moveBlock(index, -1)}
                      disabled={disabled || index === 0}
                      title="Move up"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="settings-add-btn"
                      onClick={() => moveBlock(index, 1)}
                      disabled={disabled || index === blocks.length - 1}
                      title="Move down"
                    >
                      Down
                    </button>
                  </>
                ) : null}
                <button type="button" className="settings-remove-btn" onClick={() => removeBlock(index)} disabled={disabled}>
                  Remove
                </button>
              </div>
            </div>

            {block.type === 'text' ? (
              <textarea
                value={block.value}
                onChange={(event) => updateBlock(index, { value: event.target.value })}
                rows={6}
                placeholder={textPlaceholder}
                disabled={disabled}
                aria-label="Instruction text"
              />
            ) : block.type === 'file' ? (
              <input
                type="text"
                value={block.value}
                onChange={(event) => updateBlock(index, { value: event.target.value })}
                placeholder={filePlaceholder}
                disabled={disabled}
                aria-label="Instruction file path"
              />
            ) : (
              <p className="settings-help">
                Loads `AGENTS.md` (or `agents.md`) from active project folder(s) at runtime. In Settings estimates, it defaults to your My Mind root folder.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default InstructionBlocksEditor;
