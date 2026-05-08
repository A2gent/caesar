import ChatInput from './ChatInput';
import MessageList from './MessageList';
import type { Message, MessageImage, Session } from '../../api';

interface SessionCreationPanelProps {
  className?: string;
  targetLabel?: string;
  appendContext?: string;
  appendContextLabel?: string;
  composerValue?: string;
  onComposerValueChange?: (value: string) => void;
  onClearAppendContext?: () => void;
  onSend: (message: string, images?: MessageImage[]) => void;
  onQueue?: (message: string, images?: MessageImage[]) => void;
  onClose?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  showQueueButton?: boolean;
  showVoiceButton?: boolean;
  placeholder?: string;
  actionControls?: React.ReactNode;
  inlineSession?: Session | null;
  inlineMessages?: Message[];
  inlineLoading?: boolean;
  inlineProjectId?: string | null;
  onInlineSend?: (message: string, images?: MessageImage[]) => void;
  onInlineStop?: () => void;
  onOpenInlineSession?: () => void;
  onNewInlineSession?: () => void;
}

function SessionCreationPanel({
  className = '',
  targetLabel = '',
  appendContext = '',
  appendContextLabel,
  composerValue,
  onComposerValueChange,
  onClearAppendContext,
  onSend,
  onQueue,
  onClose,
  disabled = false,
  autoFocus = false,
  showQueueButton = false,
  showVoiceButton = false,
  placeholder,
  actionControls,
  inlineSession = null,
  inlineMessages = [],
  inlineLoading = false,
  inlineProjectId = null,
  onInlineSend,
  onInlineStop,
  onOpenInlineSession,
  onNewInlineSession,
}: SessionCreationPanelProps) {
  const classes = ['session-creation-panel', inlineSession ? 'with-inline-session' : 'create-mode', className]
    .filter(Boolean)
    .join(' ');

  if (inlineSession) {
    return (
      <div className={classes} role="region" aria-label="Inline session">
        <div className="session-creation-panel-header">
          <h2>Session</h2>
          <div className="session-creation-inline-meta">
            <span className={`session-status status-${inlineSession.status}`}>{inlineSession.status}</span>
            {onOpenInlineSession ? (
              <button type="button" className="settings-add-btn" onClick={onOpenInlineSession}>
                Open full session
              </button>
            ) : null}
            {onNewInlineSession ? (
              <button type="button" className="settings-remove-btn" onClick={onNewInlineSession}>
                New session
              </button>
            ) : null}
            {onClose ? (
              <button type="button" className="settings-remove-btn" onClick={onClose}>
                Close
              </button>
            ) : null}
          </div>
        </div>
        <div className="session-creation-inline-conversation">
          <div className="session-creation-inline-body">
            <MessageList
              messages={inlineMessages}
              isLoading={inlineLoading}
              sessionId={inlineSession.id}
              projectId={inlineProjectId || inlineSession.project_id || null}
            />
          </div>
          <ChatInput
            onSend={onInlineSend || onSend}
            disabled={inlineLoading || disabled}
            showVoiceButton={showVoiceButton}
            onStop={onInlineStop}
            showStopButton={Boolean(onInlineStop && (inlineLoading || inlineSession.status === 'running'))}
            canStop={true}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={classes} role="region" aria-label="Create session">
      <ChatInput
        onSend={onSend}
        onQueue={onQueue}
        disabled={disabled}
        showVoiceButton={showVoiceButton}
        autoFocus={autoFocus}
        showQueueButton={showQueueButton}
        value={composerValue}
        onValueChange={onComposerValueChange}
        appendContext={appendContext}
        appendContextLabel={appendContextLabel || (targetLabel ? `Context: ${targetLabel}` : 'Context')}
        onClearAppendContext={onClearAppendContext}
        placeholder={placeholder || (targetLabel ? `Describe the task for ${targetLabel}...` : 'Start a new chat...')}
        actionControls={(
          <>
            {actionControls}
            {onClose ? (
              <button type="button" className="settings-remove-btn" onClick={onClose} disabled={disabled}>
                Close
              </button>
            ) : null}
          </>
        )}
      />
    </div>
  );
}

export default SessionCreationPanel;
