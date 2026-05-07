import { createContext } from 'react';

export interface AudioPlaybackState {
  isActive: boolean;
  isPaused: boolean;
  isQueued: boolean;
  mode: 'off' | 'system' | 'elevenlabs';
  sessionId: string | null;
  text: string;
  contentType: 'status' | 'final_response';
  charIndex: number;
  progress: number;
}

export interface AudioPlaybackContextValue {
  state: AudioPlaybackState;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export const defaultAudioPlaybackState: AudioPlaybackState = {
  isActive: false,
  isPaused: false,
  isQueued: false,
  mode: 'off',
  sessionId: null,
  text: '',
  contentType: 'status',
  charIndex: 0,
  progress: 0,
};

export const AudioPlaybackContext = createContext<AudioPlaybackContextValue>({
  state: defaultAudioPlaybackState,
  pause: () => undefined,
  resume: () => undefined,
  stop: () => undefined,
});
