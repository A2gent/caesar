import { useNavigate } from 'react-router-dom';
import { EmptyState, EmptyStateTitle, EmptyStateHint } from './EmptyState';

interface Notification {
  id: string;
  title: string;
  message?: string;
  status: string;
  createdAt: string;
  sessionId?: string;
  imageUrl?: string;
  audioClipId?: string;
}

interface NotificationsViewProps {
  notifications: Notification[];
  onClearAll: () => void;
  onDismiss: (id: string) => void;
}

function NotificationsView({ notifications, onClearAll, onDismiss }: NotificationsViewProps) {
  const navigate = useNavigate();
  const formatEuropeanDateTime = (value: string): string => {
    const date = new Date(value);
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  };

  const handleOpenSession = (sessionId: string) => {
    navigate(`/chat/${sessionId}`);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>🔔 Notifications</h1>
        {notifications.length > 0 && (
          <button 
            onClick={onClearAll} 
            className="btn btn-secondary"
          >
            Clear All
          </button>
        )}
      </div>

      <div className="page-content">
        {notifications.length === 0 ? (
          <EmptyState>
            <EmptyStateTitle>No notifications yet.</EmptyStateTitle>
            <EmptyStateHint>
              Notifications appear as toast messages in the bottom-left corner when they arrive.
            </EmptyStateHint>
          </EmptyState>
        ) : (
          <div className="notifications-list">
            {notifications.map((notification) => (
              <div key={notification.id} className="notification-card">
                <div className="notification-card-header">
                  <span className={`notification-status status-${notification.status}`}>
                    {notification.status}
                  </span>
                  <strong>{notification.title}</strong>
                </div>
                {notification.message && (
                  <div className="notification-message">{notification.message}</div>
                )}
                {notification.imageUrl && (
                  <img 
                    className="notification-image" 
                    src={notification.imageUrl} 
                    alt="Notification" 
                    loading="lazy"
                  />
                )}
                <div className="notification-footer">
                  <div className="notification-meta">
                    {formatEuropeanDateTime(notification.createdAt)}
                  </div>
                  <div className="notification-actions">
                    {notification.sessionId && (
                      <button 
                        onClick={() => handleOpenSession(notification.sessionId!)}
                        className="btn btn-primary btn-sm"
                      >
                        Open
                      </button>
                    )}
                    <button 
                      onClick={() => onDismiss(notification.id)}
                      className="btn btn-secondary btn-sm"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default NotificationsView;
