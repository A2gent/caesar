import React, { useRef, useEffect, useState, useCallback } from 'react';
import { transcribeSpeech } from './api';

interface ChatInputProps {
  onSend?: (message: string) => void;
  onQueue?: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  actionControls?: React.ReactNode;
  showStopButton?: boolean;
  canStop?: boolean;
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  showQueueButton?: boolean;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const VOICE_SHORTCUT_LABEL = IS_MAC ? 'Ctrl+Shift+M' : 'Alt+M';
const VOICE_LANG_STORAGE_KEY = 'a2gent.voiceInputLanguage';
const VOICE_LANGUAGE_OPTIONS = [
  { value: '', label: 'Auto detect' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'ru-RU', label: 'Russian' },
  { value: 'uk-UA', label: 'Ukrainian' },
  { value: 'de-DE', label: 'German' },
  { value: 'fr-FR', label: 'French' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'pl-PL', label: 'Polish' },
  { value: 'tr-TR', label: 'Turkish' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
];

const isVoiceShortcut = (event: { altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; code?: string; key: string }) => {
  const keyMatch = event.code === 'KeyM' || event.key.toLowerCase() === 'm';
  if (!keyMatch || event.metaKey) return false;

  if (IS_MAC) {
    return event.ctrlKey && event.shiftKey && !event.altKey;
  }

  return event.altKey && !event.shiftKey && !event.ctrlKey;
};

function normalizeLanguageForBackend(language: string): string {
  const value = (language || '').trim().toLowerCase();
  if (!value) {
    return '';
  }
  const parts = value.split('-');
  return parts[0] || '';
}

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function trimSilence(samples: Float32Array, threshold = 0.01): Float32Array {
  if (samples.length === 0) {
    return samples;
  }
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) {
    start += 1;
  }
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) {
    end -= 1;
  }
  if (start >= end) {
    return samples;
  }
  return samples.slice(start, end + 1);
}

function downsampleLinear(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate <= 0 || targetRate <= 0 || sourceRate === targetRate || samples.length === 0) {
    return samples;
  }
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = srcPos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const targetRate = 16000;
  const merged = mergeFloat32(chunks);
  const trimmed = trimSilence(merged);
  const pcm = downsampleLinear(trimmed, sampleRate, targetRate);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onQueue,
  onStop,
  disabled = false,
  autoFocus = false,
  actionControls,
  showStopButton = false,
  canStop = true,
  placeholder,
  value: externalValue,
  onValueChange,
  showQueueButton = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const shortcutPressedRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(16000);
  const waveformStatsRef = useRef({ frames: 0, warnedNoSignal: false });
  const smoothedBarHeightsRef = useRef<Float32Array | null>(null);
  const lastWaveformDrawTimeRef = useRef<number>(0);

  const [internalValue, setInternalValue] = useState('');
  
  const isControlled = externalValue !== undefined;
  const value = isControlled ? externalValue : internalValue;
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [audioInputs, setAudioInputs] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedInputId, setSelectedInputId] = useState('');
  const [selectedVoiceLanguage, setSelectedVoiceLanguage] = useState(() => {
    try {
      return localStorage.getItem(VOICE_LANG_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  const setValue = useCallback((newValue: string | ((prev: string) => string)) => {
    const nextValue = typeof newValue === 'function' ? newValue(value) : newValue;
    if (isControlled) {
      onValueChange?.(nextValue);
    } else {
      setInternalValue(nextValue);
    }
  }, [isControlled, onValueChange, value]);

  const appendTranscript = useCallback((text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    setValue((prev) => {
      const hasText = prev.trim().length > 0;
      return hasText ? `${prev.trimEnd()} ${normalized}` : normalized;
    });
  }, [setValue]);

  const clearWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#232323';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setRecordingLevel(0);
  }, []);

  const drawWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas = waveformCanvasRef.current;
    if (!analyser || !canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const waveformData = new Uint8Array(analyser.fftSize);
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const render = (timestamp: number) => {
      const currentAnalyser = analyserRef.current;
      if (!currentAnalyser) {
        return;
      }
      const lastTs = lastWaveformDrawTimeRef.current;
      if (lastTs > 0 && timestamp - lastTs < 32) {
        animationFrameRef.current = window.requestAnimationFrame(render);
        return;
      }
      lastWaveformDrawTimeRef.current = timestamp;
      currentAnalyser.getByteTimeDomainData(waveformData);
      currentAnalyser.getByteFrequencyData(frequencyData);

      ctx.fillStyle = '#232323';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw a live bar waveform that fills the entire canvas width.
      const barWidth = 2;
      const minGap = 2;
      const bars = Math.max(12, Math.floor((canvas.width + minGap) / (barWidth + minGap)));
      const exactGap = bars > 1 ? (canvas.width - bars * barWidth) / (bars - 1) : 0;
      const barGap = Math.max(0, exactGap);
      const usableHeight = canvas.height - 4;

      let rms = 0;
      for (let i = 0; i < waveformData.length; i += 1) {
        const centered = (waveformData[i] - 128) / 128;
        rms += centered * centered;
      }
      rms = Math.sqrt(rms / waveformData.length);
      setRecordingLevel(Math.min(1, rms * 8));
      waveformStatsRef.current.frames += 1;
      if (waveformStatsRef.current.frames % 45 === 0) {
        console.debug('Voice waveform stats', {
          rms: Number(rms.toFixed(4)),
          frames: waveformStatsRef.current.frames,
        });
      }
      if (waveformStatsRef.current.frames > 90 && rms < 0.003 && !waveformStatsRef.current.warnedNoSignal) {
        waveformStatsRef.current.warnedNoSignal = true;
        console.warn('Voice waveform has near-zero signal. Check microphone selection/permissions/input level.');
      }

      const step = Math.max(1, Math.floor(waveformData.length / bars));
      const freqStep = Math.max(1, Math.floor(frequencyData.length / bars));
      if (!smoothedBarHeightsRef.current || smoothedBarHeightsRef.current.length !== bars) {
        smoothedBarHeightsRef.current = new Float32Array(bars);
      }
      const smoothed = smoothedBarHeightsRef.current;
      let x = 0;
      for (let i = 0; i < bars; i += 1) {
        const idx = i * step;
        const centered = Math.abs(((waveformData[idx] || 128) - 128) / 128);
        const freqAmp = (frequencyData[Math.min(i * freqStep, frequencyData.length - 1)] || 0) / 255;
        const amp = Math.min(1, centered * 2.2 + freqAmp * 0.8 + rms * 2.5);
        const targetHeight = Math.max(4, amp * usableHeight);
        const prev = smoothed[i] || 0;
        const alpha = targetHeight > prev ? 0.42 : 0.24;
        const height = prev + (targetHeight - prev) * alpha;
        smoothed[i] = height;
        const y = (canvas.height - height) / 2;
        const t = bars > 1 ? i / (bars - 1) : 0;
        const hue = 0 + t * 270; // red -> violet
        const lightness = 50 + Math.min(22, amp * 24);
        ctx.fillStyle = `hsl(${hue.toFixed(1)} 90% ${lightness.toFixed(1)}%)`;
        ctx.fillRect(x, y, barWidth, height);
        x += barWidth + barGap;
      }

      animationFrameRef.current = window.requestAnimationFrame(render);
    };

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    animationFrameRef.current = window.requestAnimationFrame(render);
  }, []);

  const teardownRecordingGraph = useCallback(async () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    lastWaveformDrawTimeRef.current = 0;
    smoothedBarHeightsRef.current = null;

    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    silentGainRef.current?.disconnect();

    processorRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    silentGainRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {
        // Ignore close failures.
      }
      audioContextRef.current = null;
    }

    clearWaveform();
  }, [clearWaveform]);

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || 'Microphone',
        }));
      setAudioInputs(inputs);
      if (!selectedInputId && inputs.length > 0) {
        setSelectedInputId(inputs[0].deviceId);
      }
    } catch (error) {
      console.error('Failed to enumerate microphones:', error);
    }
  }, [selectedInputId]);

  useEffect(() => {
    void refreshAudioInputs();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      void refreshAudioInputs();
    };

    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshAudioInputs]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_LANG_STORAGE_KEY, selectedVoiceLanguage);
    } catch {
      // Ignore storage failures.
    }
  }, [selectedVoiceLanguage]);

  useEffect(() => {
    if (disabled && isRecording) {
      void teardownRecordingGraph();
      setIsRecording(false);
      setIsTranscribing(false);
    }
  }, [disabled, isRecording, teardownRecordingGraph]);

  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      const maxHeight = 200;
      textarea.style.height = 'auto';
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, [value]);

  useEffect(() => {
    if (!autoFocus || disabled) {
      return;
    }

    textareaRef.current?.focus();
  }, [autoFocus, disabled]);

  useEffect(() => {
    return () => {
      void teardownRecordingGraph();
    };
  }, [teardownRecordingGraph]);

  useEffect(() => {
    clearWaveform();
  }, [clearWaveform]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    // Start rendering only after recording UI (canvas) is mounted.
    drawWaveform();
  }, [drawWaveform, isRecording]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
  };

  const handleSend = useCallback(() => {
    if (disabled) return;
    const messageToSend = value.trim();
    if (messageToSend && onSend) {
      onSend(messageToSend);
      setValue('');
    }
  }, [disabled, onSend, value]);

  const handleQueue = useCallback(() => {
    if (disabled) return;
    const messageToSend = value.trim();
    if (messageToSend && onQueue) {
      onQueue(messageToSend);
      setValue('');
    }
  }, [disabled, onQueue, value]);

  const startRecording = useCallback(async () => {
    if (disabled || isRecording || isTranscribing) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Microphone input is not supported in this browser.');
      return;
    }

    setShowVoiceSettings(true);
    pcmChunksRef.current = [];

    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedInputId ? { deviceId: { exact: selectedInputId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;

      sampleRateRef.current = context.sampleRate;
      streamRef.current = stream;
      audioContextRef.current = context;
      sourceRef.current = source;
      analyserRef.current = analyser;
      processorRef.current = processor;
      silentGainRef.current = silentGain;

      processor.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(channelData.length);
        copy.set(channelData);
        pcmChunksRef.current.push(copy);
      };

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);

      waveformStatsRef.current = { frames: 0, warnedNoSignal: false };
      setIsRecording(true);
      await refreshAudioInputs();
    } catch (error: any) {
      console.error('Failed to start recording:', error);
      if (error?.name === 'NotAllowedError') {
        alert('Microphone access was denied. Please allow microphone access to use voice input.');
      }
      await teardownRecordingGraph();
      setIsRecording(false);
      setShowVoiceSettings(false);
    }
  }, [disabled, drawWaveform, isRecording, isTranscribing, refreshAudioInputs, selectedInputId, teardownRecordingGraph]);

  const stopRecording = useCallback(async () => {
    if (!isRecording || isTranscribing) {
      return;
    }

    setIsRecording(false);
    setIsTranscribing(true);

    const chunks = [...pcmChunksRef.current];
    const sampleRate = sampleRateRef.current;
    pcmChunksRef.current = [];

    await teardownRecordingGraph();

    if (chunks.length === 0) {
      setIsTranscribing(false);
      setShowVoiceSettings(false);
      return;
    }

    try {
      const wavBlob = encodeWav(chunks, sampleRate);
      const result = await transcribeSpeech(wavBlob, normalizeLanguageForBackend(selectedVoiceLanguage));
      appendTranscript(result.text || '');
    } catch (error) {
      console.error('Failed to transcribe audio:', error);
      alert(error instanceof Error ? error.message : 'Failed to transcribe audio.');
    } finally {
      setIsTranscribing(false);
      setShowVoiceSettings(false);
    }
  }, [appendTranscript, isRecording, isTranscribing, selectedVoiceLanguage, teardownRecordingGraph]);

  const toggleRecording = useCallback(() => {
    if (isTranscribing) {
      return;
    }
    if (isRecording) {
      void stopRecording();
    } else {
      void startRecording();
    }
  }, [isRecording, isTranscribing, startRecording, stopRecording]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isVoiceShortcut(event)) {
        event.preventDefault();
        if (event.repeat || shortcutPressedRef.current) return;
        shortcutPressedRef.current = true;
        toggleRecording();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isVoiceShortcut(event)) {
        event.preventDefault();
      }
      shortcutPressedRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [toggleRecording]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isVoiceShortcut(event)) {
      event.preventDefault();
      if (event.repeat || shortcutPressedRef.current) return;
      shortcutPressedRef.current = true;
      toggleRecording();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (showStopButton) {
        return;
      }
      handleSend();
    }
  };

  const voiceButtonTitle = isTranscribing
    ? 'Transcribing audio...'
    : isRecording
      ? `Stop voice input (${VOICE_SHORTCUT_LABEL})`
      : `Start voice input (${VOICE_SHORTCUT_LABEL})`;

  return (
    <div className="chat-input-container">
      {(isRecording || isTranscribing) && (
        <div className="voice-live-panel" aria-live="polite">
          {isRecording ? (
            <>
              <span className="recording-dot"></span>
              <span>Recording...</span>
              <div className="voice-meter-wrap">
                <canvas ref={waveformCanvasRef} className="voice-waveform" width={1260} height={132} aria-hidden="true" />
                <span className="voice-level-text">{Math.round(recordingLevel * 100)}%</span>
              </div>
            </>
          ) : (
            <>
              <span className="recording-dot"></span>
              <span>Transcribing...</span>
            </>
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="chat-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || (disabled ? 'Agent is processing...' : 'Start a new chat...')}
        rows={1}
        disabled={disabled}
      />
      <div className="chat-input-actions">
        {actionControls}
        {showVoiceSettings && (
          <>
            <label className="voice-settings-inline">
              <select
                className="mic-select"
                value={selectedVoiceLanguage}
                onChange={(e) => setSelectedVoiceLanguage(e.target.value)}
                disabled={isRecording || isTranscribing}
                title="Voice input language"
                aria-label="Voice input language"
              >
                {VOICE_LANGUAGE_OPTIONS.map((locale) => (
                  <option key={locale.value || 'auto'} value={locale.value}>
                    {locale.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="voice-settings-inline">
              <select
                className="mic-select"
                value={selectedInputId}
                onChange={(e) => setSelectedInputId(e.target.value)}
                disabled={isRecording || isTranscribing}
                title="Microphone device"
                aria-label="Microphone device"
              >
                {audioInputs.length === 0 ? (
                  <option value="">No microphone devices found</option>
                ) : (
                  audioInputs.map((input) => (
                    <option key={input.deviceId} value={input.deviceId}>
                      {input.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          </>
        )}
        <button
          type="button"
          className={`voice-button ${isRecording ? 'recording' : ''}`}
          onClick={toggleRecording}
          disabled={disabled || isTranscribing}
          title={voiceButtonTitle}
          aria-label={voiceButtonTitle}
        >
          {isRecording ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="voice-icon" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="voice-icon"
              aria-hidden="true"
            >
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          )}
        </button>
        {showStopButton ? (
          <button
            type="button"
            className="send-button stop-button"
            onClick={onStop}
            disabled={!canStop}
            title="Stop run"
            aria-label="Stop run"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="send-icon" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <>
            {showQueueButton && (
              <button
                type="button"
                className="queue-button"
                onClick={handleQueue}
                disabled={disabled || !value.trim()}
                title="Queue for later (create without starting)"
                aria-label="Queue for later"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="send-icon" aria-hidden="true">
                  <rect x="6" y="4" width="4" height="16" fill="currentColor" />
                  <rect x="14" y="4" width="4" height="16" fill="currentColor" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="send-button"
              onClick={handleSend}
              disabled={disabled || !value.trim()}
              title="Send message"
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="send-icon" aria-hidden="true">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
