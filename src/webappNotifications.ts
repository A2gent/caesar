export interface WebAppNotificationEventDetail {
  id: string;
  title: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  createdAt: string;
  sessionId: string;
  imageUrl?: string;
  audioClipId?: string;
  autoPlayAudio?: boolean;
}

export const webAppNotificationEventName = 'a2gent:webapp-notification';

export function emitWebAppNotification(detail: WebAppNotificationEventDetail): void {
  window.dispatchEvent(new CustomEvent<WebAppNotificationEventDetail>(webAppNotificationEventName, { detail }));
}
