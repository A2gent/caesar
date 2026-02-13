import React, { useRef, useEffect, useState, useCallback } from 'react';

interface ChatInputProps {
  onSend?: (message: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  actionControls?: React.ReactNode;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const VOICE_SHORTCUT_LABEL = IS_MAC ? 'Ctrl+Shift+M' : 'Alt+M';
const VOICE_LANG_STORAGE_KEY = 'a2gent.voiceInputLanguage';
const VOICE_LANGUAGE_OPTIONS = [
  { value: '', label: 'Browser default' },
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

const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled = false, autoFocus = false, actionControls }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const interimTranscriptRef = useRef('');
  const shortcutPressedRef = useRef(false);

  const [value, setValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState('');
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

  const appendTranscript = useCallback((text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    setValue((prev) => {
      const hasText = prev.trim().length > 0;
      return hasText ? `${prev.trimEnd()} ${normalized}` : normalized;
    });
  }, []);

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

  const warmUpSelectedMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedInputId ? { deviceId: { exact: selectedInputId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((track) => track.stop());
      await refreshAudioInputs();
    } catch (error) {
      console.error('Failed to access selected microphone:', error);
    }
  }, [refreshAudioInputs, selectedInputId]);

  useEffect(() => {
    interimTranscriptRef.current = interimTranscript;
  }, [interimTranscript]);

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
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition ||
      (window as any).mozSpeechRecognition ||
      (window as any).msSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = selectedVoiceLanguage || navigator.language || 'en-US';
    recognition.onstart = () => {
      setIsRecording(true);
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (final) {
        appendTranscript(final);
        setInterimTranscript('');
      } else {
        setInterimTranscript(interim);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        appendTranscript(interimTranscriptRef.current);
      }

      if (event.error === 'not-allowed') {
        shouldRestartRef.current = false;
        setIsRecording(false);
        setShowVoiceSettings(false);
        alert('Microphone access was denied. Please allow microphone access to use voice input.');
      }
    };

    recognition.onend = () => {
      if (shouldRestartRef.current && !disabled) {
        restartTimerRef.current = window.setTimeout(() => {
          try {
            recognition.start();
            setIsRecording(true);
          } catch (error) {
            console.error('Failed to restart speech recognition:', error);
            setIsRecording(false);
          }
        }, 200);
        return;
      }

      appendTranscript(interimTranscriptRef.current);
      setInterimTranscript('');
      setIsRecording(false);
      setShowVoiceSettings(false);
    };

    recognitionRef.current = recognition;

    return () => {
      shouldRestartRef.current = false;
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [appendTranscript, disabled, selectedVoiceLanguage]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_LANG_STORAGE_KEY, selectedVoiceLanguage);
    } catch {
      // Ignore storage failures.
    }
    if (recognitionRef.current) {
      recognitionRef.current.lang = selectedVoiceLanguage || navigator.language || 'en-US';
    }
  }, [selectedVoiceLanguage]);

  useEffect(() => {
    if (disabled && isRecording && recognitionRef.current) {
      shouldRestartRef.current = false;
      recognitionRef.current.stop();
      setIsRecording(false);
      setInterimTranscript('');
    }
  }, [disabled, isRecording]);

  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      const maxHeight = 200;
      textarea.style.height = 'auto';
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, [value, interimTranscript]);

  useEffect(() => {
    if (!autoFocus || disabled) {
      return;
    }

    textareaRef.current?.focus();
  }, [autoFocus, disabled]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
    setInterimTranscript('');
  };

  const handleSend = useCallback(() => {
    if (disabled) return;
    const messageToSend = value.trim();
    if (messageToSend && onSend) {
      onSend(messageToSend);
      setValue('');
      setInterimTranscript('');
    }
  }, [disabled, onSend, value]);

  const startRecording = useCallback(() => {
    if (!recognitionRef.current || disabled || !isSupported) return;
    setShowVoiceSettings(true);
    shouldRestartRef.current = true;
    void warmUpSelectedMic();

    try {
      recognitionRef.current.lang = selectedVoiceLanguage || navigator.language || 'en-US';
      recognitionRef.current.start();
    } catch (error) {
      shouldRestartRef.current = false;
      console.error('Failed to start speech recognition:', error);
    }
  }, [disabled, isSupported, selectedVoiceLanguage, warmUpSelectedMic]);

  const stopRecording = useCallback(() => {
    if (!recognitionRef.current) return;
    shouldRestartRef.current = false;
    appendTranscript(interimTranscriptRef.current);
    recognitionRef.current.stop();
    setIsRecording(false);
    setInterimTranscript('');
    setShowVoiceSettings(false);
  }, [appendTranscript]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

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
      handleSend();
    }
  };

  const displayValue = interimTranscript
    ? `${value}${value && !value.endsWith(' ') ? ' ' : ''}${interimTranscript}`
    : value;

  const voiceButtonTitle = !isSupported
    ? `Voice input is not supported in this browser (${VOICE_SHORTCUT_LABEL})`
    : isRecording
      ? `Stop voice input (${VOICE_SHORTCUT_LABEL})`
      : `Start voice input (${VOICE_SHORTCUT_LABEL})`;

  return (
    <div className="chat-input-container">
      <textarea
        ref={textareaRef}
        className="chat-textarea"
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Agent is processing...' : 'Start a new chat...'}
        rows={1}
        disabled={disabled}
      />
      <div className="chat-input-actions">
        {isRecording && (
          <div className="recording-indicator">
            <span className="recording-dot"></span>
            <span>Listening...</span>
          </div>
        )}
        {actionControls}
        {showVoiceSettings && (
          <>
            <label className="voice-settings-inline">
              <select
                className="mic-select"
                value={selectedVoiceLanguage}
                onChange={(e) => setSelectedVoiceLanguage(e.target.value)}
                disabled={isRecording}
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
              disabled={isRecording}
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
          disabled={disabled || !isSupported}
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
        <button
          type="button"
          className="send-button"
          onClick={handleSend}
          disabled={disabled || (!value.trim() && !interimTranscript)}
          title="Send message"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="send-icon">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default ChatInput;
