/**
 * AvatarAudio — shared context for driving the AgentAvatar animation.
 *
 * Two sources feed the avatar:
 *  1. Mic input  (listening state) — analyser node from ChatInput recording graph
 *  2. TTS output (speaking state)  — driven by AudioPlayback context (no analyser, just amplitude flag)
 *
 * Components that produce audio signal call setAnalyser / clearAnalyser.
 * AgentAvatar reads `useAvatarAudio()` to get the current state + level.
 */

import { createContext, useContext } from 'react';

export type AvatarMode = 'idle' | 'listening' | 'speaking';

export interface AvatarAudioState {
  mode: AvatarMode;
  /** 0..1 audio energy level (updated ~30fps from AnalyserNode or fake pulse) */
  level: number;
  /** Live AnalyserNode from mic graph (null when not recording) */
  analyser: AnalyserNode | null;
}

export interface AvatarAudioContextValue {
  state: AvatarAudioState;
  /** Call when mic recording starts — pass the live AnalyserNode */
  setListening: (analyser: AnalyserNode) => void;
  /** Call when mic recording stops */
  clearListening: () => void;
  /** Call when TTS playback starts */
  setSpeaking: () => void;
  /** Call when TTS playback stops */
  clearSpeaking: () => void;
}

export const defaultAvatarAudioState: AvatarAudioState = {
  mode: 'idle',
  level: 0,
  analyser: null,
};

export const AvatarAudioContext = createContext<AvatarAudioContextValue>({
  state: defaultAvatarAudioState,
  setListening: () => undefined,
  clearListening: () => undefined,
  setSpeaking: () => undefined,
  clearSpeaking: () => undefined,
});

export function useAvatarAudio(): AvatarAudioContextValue {
  return useContext(AvatarAudioContext);
}
