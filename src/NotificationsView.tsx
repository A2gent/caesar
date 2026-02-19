import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Notification {
  id: string;
  title: string;
  message?: string;
  status: string;
  createdAt: string;
  sessionId?: string;
}

function NotificationsView() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load notifications from local storage or state
    // For now, showing placeholder
    setLoading(false);
  }, []);

  const handleClearAll = () => {
    setNotifications([]);
  };

  const handleDismiss = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  if (loading) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1>🔔 Notifications</h1>
        </div>
        <div className="page-content">
          <div className="loading-state">Loading notifications...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>🔔 Notifications</h1>
        {notifications.length > 0 && (
          <button 
            onClick={handleClearAll} 
            className="btn btn-secondary"
          >
            Clear All
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content">
        {notifications.length === 0 ? (
          <div className="empty-state">
            <p>No notifications yet.</p>
            <p className="empty-state-hint">
              Notifications appear as toast messages in the bottom-left corner when they arrive.
            </p>
          </div>
        ) : (
          <div className="notifications-list">
            {notifications.map((notification) => (
              <div key={notification.id} className="notification-card">
                <div className="notification-card-header">
                  <strong>{notification.title}</strong>
                  <span className={`notification-status status-${notification.status}`}>
                    {notification.status}
                  </span>
                </div>
                {notification.message && (
                  <div className="notification-message">{notification.message}</div>
                )}
                <div className="notification-meta">
                  {new Date(notification.createdAt).toLocaleString()}
                </div>
                <div className="notification-actions">
                  {notification.sessionId && (
                    <button 
                      onClick={() => navigate(`/chat/${notification.sessionId}`)}
                      className="btn btn-primary btn-sm"
                    >
                      Open
                    </button>
                  )}
                  <button 
                    onClick={() => handleDismiss(notification.id)}
                    className="btn btn-secondary btn-sm"
                  >
                    Dismiss
                  </button>
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
