import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import { 
  getSession, 
  createSession, 
  sendMessage,
  type Session, 
  type Message 
} from './api';

function ChatView() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSessionId = urlSessionId;

  useEffect(() => {
    if (activeSessionId) {
      loadSession(activeSessionId);
    } else {
      setSession(null);
      setMessages([]);
    }
  }, [activeSessionId]);

  const loadSession = async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getSession(id);
      setSession(data);
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load session:', err);
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!session) {
      // Create a new session, then send the first message to trigger an agent response.
      let createdSessionId: string | null = null;
      setIsLoading(true);
      setError(null);

      try {
        const created = await createSession({ agent_id: 'build' });
        createdSessionId = created.id;

        const response = await sendMessage(created.id, message);
        const newSession = await getSession(created.id);

        setSession(newSession);
        setMessages(response.messages);
      } catch (err) {
        console.error('Failed to create session and send first message:', err);
        setError(err instanceof Error ? err.message : 'Failed to send message');

        if (createdSessionId) {
          try {
            const createdSession = await getSession(createdSessionId);
            setSession(createdSession);
            setMessages(createdSession.messages || []);
          } catch {
            // Keep the original error visible; no-op for fallback load failure.
          }
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Add user message optimistically
    const userMessage: Message = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessage(session.id, message);
      setMessages(response.messages);
      
      // Update session status
      setSession(prev => prev ? { ...prev, status: response.status } : null);
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Remove the optimistic message on error
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="top-bar">
        <div className="top-bar-left">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/sessions')}
          >
            Back to Sessions
          </button>
        </div>

        <div className="session-info">
          {session ? (
            <>
              <span className="session-title">{session.title || 'Untitled Session'}</span>
              <span className={`session-status status-${session.status}`}>
                {session.status}
              </span>
            </>
          ) : (
            <span className="session-title">New Session</span>
          )}
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
          <MessageList messages={messages} isLoading={isLoading} />
        ) : (
          <div className="empty-state">
            <h2>Start a Conversation</h2>
            <p>Type a message below to begin chatting with the agent.</p>
          </div>
        )}
      </div>
      
      <ChatInput onSend={handleSendMessage} disabled={isLoading} />
    </>
  );
}

export default ChatView;
