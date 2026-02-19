import { useState } from 'react';
import { parseTaskProgressDetails, type TaskItem } from './api';

interface TaskProgressPanelProps {
  taskProgress: string;
}

function TaskTree({ tasks, level = 0 }: { tasks: TaskItem[]; level?: number }) {
  return (
    <ul className={`task-tree task-tree-level-${level}`}>
      {tasks.map((task) => (
        <li key={task.id} className={`task-item ${task.completed ? 'task-completed' : 'task-pending'}`}>
          <span className="task-checkbox">{task.completed ? '☑' : '☐'}</span>
          <span className="task-text">{task.text}</span>
          {task.children.length > 0 && (
            <TaskTree tasks={task.children} level={level + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function TaskProgressPanel({ taskProgress }: TaskProgressPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const details = parseTaskProgressDetails(taskProgress);

  if (details.total === 0) {
    return null;
  }

  return (
    <div className="task-progress-panel">
      <button
        className="task-progress-header"
        onClick={() => setIsExpanded(!isExpanded)}
        title={`${details.completed}/${details.total} tasks completed (${details.progressPct}%) - Click to ${isExpanded ? 'hide' : 'show'} details`}
      >
        <span className="task-progress-icon">📋</span>
        <div className="task-progress-bar-container">
          <div
            className="task-progress-bar"
            style={{ width: `${details.progressPct}%` }}
          />
        </div>
        <span className="task-progress-text">
          {details.completed}/{details.total} ({details.progressPct}%)
        </span>
        <span className={`task-progress-toggle ${isExpanded ? 'expanded' : ''}`}>
          ▼
        </span>
      </button>

      {isExpanded && details.tasks.length > 0 && (
        <div className="task-progress-details">
          <TaskTree tasks={details.tasks} />
        </div>
      )}
    </div>
  );
}
