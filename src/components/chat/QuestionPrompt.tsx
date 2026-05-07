import type { PendingQuestion } from '../../api';
import './QuestionPrompt.css';

interface QuestionPromptProps {
  question: PendingQuestion;
  onSelectOption: (answer: string) => void;
  selectedOption: string;
}

export default function QuestionPrompt({ question, onSelectOption, selectedOption }: QuestionPromptProps) {
  // Guard against incomplete question data
  if (!question || !question.options || !Array.isArray(question.options)) {
    return (
      <div className="question-prompt">
        <div className="question-prompt-error">
          Invalid question data received from server.
        </div>
      </div>
    );
  }

  const handleOptionClick = (label: string) => {
    if (question.multiple) {
      // For multiple choice, toggle selection
      const current = selectedOption.split(', ').filter(s => s);
      const updated = current.includes(label)
        ? current.filter(l => l !== label)
        : [...current, label];
      onSelectOption(updated.join(', '));
    } else {
      // For single choice, just set the label
      onSelectOption(label);
    }
  };

  const isSelected = (label: string) => {
    if (!selectedOption) return false;
    if (question.multiple) {
      return selectedOption.split(', ').includes(label);
    }
    return selectedOption === label;
  };

  return (
    <div className="question-prompt">
      <div className="question-prompt-header">
        <span className="question-prompt-icon">💬</span>
        <strong>{question.header}</strong>
      </div>
      
      <p className="question-prompt-text">{question.question}</p>

      <div className="question-prompt-options">
        {question.options.map((opt, idx) => {
          const selected = isSelected(opt.label);
          const icon = question.multiple ? (selected ? '☑' : '☐') : (selected ? '◉' : '○');
          
          return (
            <button
              key={idx}
              type="button"
              className={`question-option ${selected ? 'selected' : ''}`}
              onClick={() => handleOptionClick(opt.label)}
            >
              <span className="question-option-icon">{icon}</span>
              <div className="question-option-content">
                <strong>{opt.label}</strong>
                <span>{opt.description}</span>
              </div>
            </button>
          );
        })}
      </div>

      {question.custom && (
        <p className="question-prompt-hint">
          💡 Or type your own answer in the text box below
        </p>
      )}
    </div>
  );
}
