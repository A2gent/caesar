import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import { EmptyState, EmptyStateHint, EmptyStateTitle } from './EmptyState';
import {
  createA2AOutboundSession,
  getSession,
  sendA2AOutboundMessage,
  type Message,
  type MessageImage,
  type Session,
} from './api';

const A2A_CONTACT_SESSION_KEY_PREFIX = 'a2gent.a2a_contact_session';

type ContactLocationState = {
  agent?: {
    id: string;
    name?: string;
    description?: string;
  };
  forceNewSession?: boolean;
};

function A2AContactView() {
  const { agentId } = useParams<{ agentId: string }>();
  const location = useLocation();
  const locationState = (location.state || {}) as ContactLocationState;
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetAgentID = useMemo(() => decodeURIComponent(agentId || '').trim(), [agentId]);
  const targetAgentName = useMemo(() => {
    if (locationState.agent?.name && locationState.agent.id === targetAgentID) {
      return locationState.agent.name;
    }
    return '';
  }, [locationState.agent, targetAgentID]);
  const forceNewSession = locationState.forceNewSession === true;

  useEffect(() => {
    if (!targetAgentID) {
      setError('Missing target agent ID.');
      return;
    }
    let cancelled = false;
    const prepare = async () => {
      try {
        setIsPreparing(true);
        setError(null);
        const storageKey = `${A2A_CONTACT_SESSION_KEY_PREFIX}:${targetAgentID}`;
        const existingSessionID = localStorage.getItem(storageKey)?.trim() || '';
        if (!forceNewSession && existingSessionID) {
          try {
            const existing = await getSession(existingSessionID);
            if (
              existing.a2a_outbound &&
              (existing.a2a_target_agent_id || '').trim() === targetAgentID
            ) {
              if (!cancelled) {
                setSession(existing);
                setMessages(existing.messages || []);
                setIsPreparing(false);
              }
              return;
            }
          } catch {
            // stale session ID; continue and create a new one
          }
        }
        const created = await createA2AOutboundSession({
          target_agent_id: targetAgentID,
          target_agent_name: targetAgentName || undefined,
        });
        if (cancelled) return;
        localStorage.setItem(storageKey, created.id);
        setSession(created);
        setMessages(created.messages || []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to prepare A2A session');
      } finally {
        if (!cancelled) {
          setIsPreparing(false);
        }
      }
    };
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [targetAgentID, targetAgentName, forceNewSession]);

  const handleSendMessage = async (message: string, images: MessageImage[] = []) => {
    if (!session) return;
    if (images.length > 0) {
      setError('A2A chat currently supports text only.');
      return;
    }
    setError(null);
    setIsLoading(true);
    const userMessage: Message = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);
    try {
      const resp = await sendA2AOutboundMessage(session.id, message);
      setMessages(resp.messages || []);
      const fresh = await getSession(session.id);
      setSession(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const title = targetAgentName || session?.a2a_target_agent_name || targetAgentID || 'Remote agent';

  return (
    <>
      <div className="top-bar">
        <div className="session-info">
          <span className={`session-status-dot-large status-${session?.status || 'paused'}`} />
          <div className="session-meta-stack">
            <div className="session-meta-row">
              <span className="session-title">{title}</span>
              <span className="session-provider-chip">A2A</span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="chat-history">
        {messages.length > 0 ? (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            sessionId={session?.id || null}
            projectId={session?.project_id || null}
          />
        ) : (
          <EmptyState>
            <EmptyStateTitle>{isPreparing ? 'Preparing connection…' : 'Contact remote agent'}</EmptyStateTitle>
            <EmptyStateHint>Type a message below to start an A2A conversation.</EmptyStateHint>
          </EmptyState>
        )}
      </div>

      <ChatInput
        onSend={handleSendMessage}
        disabled={isPreparing || isLoading || !session}
        placeholder="Send a prompt to the remote agent…"
      />
    </>
  );
}

export default A2AContactView;
