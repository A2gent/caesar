/**
 * AvatarAudioProvider — top-level provider that manages avatar audio state.
 * Wrap the app (or the relevant subtree) with this provider.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  AvatarAudioContext,
  type AvatarMode,
  type AvatarAudioState,
} from './avatarAudio';

interface AvatarAudioProviderProps {
  children: React.ReactNode;
}

export function AvatarAudioProvider({ children }: AvatarAudioProviderProps) {
  const [state, setState] = useState<AvatarAudioState>({
    mode: 'idle',
    level: 0,
    analyser: null,
  });

  // Track which sources are active so they don't cancel each other
  const speakingRef = useRef(false);
  const listeningRef = useRef(false);

  const resolveMode = useCallback((): AvatarMode => {
    if (listeningRef.current) return 'listening';
    if (speakingRef.current) return 'speaking';
    return 'idle';
  }, []);

  const setListening = useCallback((analyser: AnalyserNode) => {
    listeningRef.current = true;
    setState(() => ({
      mode: resolveMode(),
      level: 0,
      analyser,
    }));
  }, [resolveMode]);

  const clearListening = useCallback(() => {
    listeningRef.current = false;
    setState((prev) => ({
      ...prev,
      mode: resolveMode(),
      level: 0,
      analyser: null,
    }));
  }, [resolveMode]);

  const setSpeaking = useCallback(() => {
    speakingRef.current = true;
    setState((prev) => ({
      ...prev,
      mode: resolveMode(),
    }));
  }, [resolveMode]);

  const clearSpeaking = useCallback(() => {
    speakingRef.current = false;
    setState((prev) => ({
      ...prev,
      mode: resolveMode(),
      level: 0,
    }));
  }, [resolveMode]);

  return (
    <AvatarAudioContext.Provider value={{ state, setListening, clearListening, setSpeaking, clearSpeaking }}>
      {children}
    </AvatarAudioContext.Provider>
  );
}
