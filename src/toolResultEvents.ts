import type { ToolResult } from './api';

const audioClipMarker = /A2_AUDIO_CLIP_ID:([a-zA-Z0-9-]+)/;

export interface AudioClipEvent {
  clipId: string;
  autoPlay: boolean;
}

export interface WebAppNotificationPayload {
  title: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  audioClipId: string;
  imagePath: string;
  imageUrl: string;
  autoPlayAudio: boolean;
}

export interface ImagePreviewEvent {
  imagePath: string;
  imageUrl: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readAudioClipEvent(result: ToolResult): AudioClipEvent | null {
  const metadata = asRecord(result.metadata);
  const audioClip = asRecord(metadata.audio_clip);
  const clipId = asString(audioClip.clip_id);
  if (clipId !== '') {
    return {
      clipId,
      autoPlay: asBool(audioClip.auto_play, true),
    };
  }

  const marker = audioClipMarker.exec(result.content || '');
  const legacyClipId = marker?.[1]?.trim() || '';
  if (legacyClipId === '') {
    return null;
  }
  return {
    clipId: legacyClipId,
    autoPlay: true,
  };
}

export function readWebAppNotification(result: ToolResult): WebAppNotificationPayload | null {
  const metadata = asRecord(result.metadata);
  const payload = asRecord(metadata.webapp_notification);
  const message = asString(payload.message);
  if (message === '') {
    return null;
  }

  const levelRaw = asString(payload.level).toLowerCase();
  const level = ['info', 'success', 'warning', 'error'].includes(levelRaw)
    ? (levelRaw as WebAppNotificationPayload['level'])
    : 'info';

  return {
    title: asString(payload.title),
    message,
    level,
    audioClipId: asString(payload.audio_clip_id),
    imagePath: asString(payload.image_path),
    imageUrl: asString(payload.image_url),
    autoPlayAudio: asBool(payload.auto_play_audio, true),
  };
}

export function readImagePreviewEvent(result: ToolResult): ImagePreviewEvent | null {
  const metadata = asRecord(result.metadata);

  const imageFile = asRecord(metadata.image_file);
  const imagePath = asString(imageFile.path);
  if (imagePath !== '') {
    return {
      imagePath,
      imageUrl: '',
    };
  }

  const notification = readWebAppNotification(result);
  if (!notification) {
    return null;
  }
  if (notification.imagePath === '' && notification.imageUrl === '') {
    return null;
  }
  return {
    imagePath: notification.imagePath,
    imageUrl: notification.imageUrl,
  };
}
