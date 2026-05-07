import { useEffect, useState } from 'react';
import { getSessionTaskProgress, type TaskProgressResponse } from '../../api';
import './TaskProgressModal.css';

interface TaskProgressModalProps {
  sessionId: string;
  sessionTitle: string;
  onClose: () => void;
}

export function TaskProgressModal({ sessionId, sessionTitle, onClose }: TaskProgressModalProps) {
  const [progress, setProgress] = useState<TaskProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProgress = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getSessionTaskProgress(sessionId);
        setProgress(data);
      } catch (err) {
        console.error('Failed to load task progress:', err);
        setError(err instanceof Error ? err.message : 'Failed to load task progress');
      } finally {
        setLoading(false);
      }
    };

    void loadProgress();
  }, [sessionId]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const renderTaskLines = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed === '') return null;

      // Determine indent level
      const leadingSpaces = line.match(/^(\s*)/)?.[1]?.length || 0;
      const indentLevel = Math.floor(leadingSpaces / 2);

      let isCompleted = false;
      let text = trimmed;

      if (trimmed.startsWith('[x]') || trimmed.startsWith('[X]')) {
        isCompleted = true;
        text = trimmed.substring(3).trim();
      } else if (trimmed.startsWith('[ ]')) {
        isCompleted = false;
        text = trimmed.substring(3).trim();
      }

      const hasCheckbox = trimmed.startsWith('[');

      return (
        <div
          key={idx}
          className={`task-line ${hasCheckbox ? 'task-item' : 'task-text'} ${isCompleted ? 'task-completed' : ''}`}
          style={{ paddingLeft: `${indentLevel * 20}px` }}
        >
          {hasCheckbox && (
            <span className="task-checkbox">{isCompleted ? '☑' : '☐'}</span>
          )}
          <span className={`task-text-content ${isCompleted ? 'task-strikethrough' : ''}`}>
            {text}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="task-progress-modal-backdrop" onClick={handleBackdropClick}>
      <div className="task-progress-modal">
        <div className="task-progress-modal-header">
          <h2>Task Progress: {sessionTitle}</h2>
          <button className="task-progress-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="task-progress-modal-body">
          {loading && <div className="task-progress-loading">Loading...</div>}

          {error && (
            <div className="task-progress-error">
              <p>Error: {error}</p>
            </div>
          )}

          {!loading && !error && progress && (
            <>
              {progress.content ? (
                <>
                  <div className="task-progress-stats">
                    <div className="task-progress-stat">
                      <span className="task-progress-stat-value">{progress.completed_tasks}</span>
                      <span className="task-progress-stat-label">Completed</span>
                    </div>
                    <div className="task-progress-stat">
                      <span className="task-progress-stat-value">{progress.total_tasks}</span>
                      <span className="task-progress-stat-label">Total</span>
                    </div>
                    <div className="task-progress-stat">
                      <span className="task-progress-stat-value">{progress.progress_pct}%</span>
                      <span className="task-progress-stat-label">Progress</span>
                    </div>
                  </div>

                  <div className="task-progress-content">
                    {renderTaskLines(progress.content)}
                  </div>
                </>
              ) : (
                <div className="task-progress-empty">
                  <p>No task progress information available for this session.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
