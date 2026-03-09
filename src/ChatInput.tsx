import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { transcribeSpeech, type MessageImage } from './api';
import {
  normalizeLanguageForBackend,
  readVoiceInputDeviceSetting,
  readVoiceInputLanguageSetting,
  writeVoiceInputDeviceSetting,
} from './voiceInputSettings';
import { useAvatarAudio } from './avatarAudio';
import { TOGGLE_VOICE_INPUT_EVENT } from './voiceInputEvents';

interface ChatInputProps {
  onSend?: (message: string, images?: MessageImage[]) => void;
  onQueue?: (message: string, images?: MessageImage[]) => void;
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
  showVoiceButton?: boolean;
  slashCommands?: SlashCommand[];
  onSlashCommand?: (command: SlashCommandSelection) => boolean | Promise<boolean>;
}

export interface SlashCommand {
  id: string;
  command: string;
  title: string;
  description?: string;
  aliases?: string[];
  disabled?: boolean;
}

export interface SlashCommandSelection {
  id: string;
  command: string;
  raw: string;
  args: string[];
}

interface PendingImage extends MessageImage {
  id: string;
  preview_url: string;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const VOICE_SHORTCUT_LABEL = IS_MAC ? 'Ctrl+Shift+M' : 'Alt+M';

const isVoiceShortcut = (event: { altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; code?: string; key: string }) => {
  const keyMatch = event.code === 'KeyM' || event.key.toLowerCase() === 'm';
  if (!keyMatch || event.metaKey) return false;

  if (IS_MAC) {
    return event.ctrlKey && event.shiftKey && !event.altKey;
  }

  return event.altKey && !event.shiftKey && !event.ctrlKey;
};

function parseSlashInput(raw: string): { command: string; args: string[] } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const tokens = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  return {
    command: tokens[0].toLowerCase(),
    args: tokens.slice(1),
  };
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
  showVoiceButton = true,
  slashCommands = [],
  onSlashCommand,
}) => {
  const { setListening, clearListening } = useAvatarAudio();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shortcutPressedRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);

  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(16000);

  const [internalValue, setInternalValue] = useState('');
  
  const isControlled = externalValue !== undefined;
  const value = isControlled ? externalValue : internalValue;
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [selectedInputId, setSelectedInputId] = useState(() => readVoiceInputDeviceSetting());
  const [selectedVoiceLanguage] = useState(() => readVoiceInputLanguageSetting());
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);

  const setValue = useCallback((newValue: string | ((prev: string) => string)) => {
    const nextValue = typeof newValue === 'function' ? newValue(value) : newValue;
    if (isControlled) {
      onValueChange?.(nextValue);
    } else {
      setInternalValue(nextValue);
    }
  }, [isControlled, onValueChange, value]);

  const slashInput = useMemo(() => parseSlashInput(value), [value]);
  const slashQuery = slashInput?.command || '';
  const slashSuggestions = useMemo(() => {
    if (!value.trimStart().startsWith('/')) {
      return [] as SlashCommand[];
    }
    const query = slashQuery.toLowerCase();
    return slashCommands
      .filter((item) => !item.disabled)
      .filter((item) => {
        if (!query) {
          return true;
        }
        if (item.command.toLowerCase().includes(query) || item.title.toLowerCase().includes(query)) {
          return true;
        }
        return (item.aliases || []).some((alias) => alias.toLowerCase().includes(query));
      })
      .slice(0, 12);
  }, [slashCommands, slashQuery, value]);

  useEffect(() => {
    setActiveSlashIndex(0);
  }, [slashQuery, value]);

  const toPendingImage = useCallback((file: File): Promise<PendingImage> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Failed to read image: ${file.name}`));
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const commaIdx = result.indexOf(',');
        const dataBase64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : '';
        resolve({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          media_type: file.type || 'image/png',
          data_base64: dataBase64,
          preview_url: result,
        });
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (fileArray.length === 0) {
      return;
    }
    try {
      const converted = await Promise.all(fileArray.map((file) => toPendingImage(file)));
      setPendingImages((prev) => {
        const combined = [...prev, ...converted];
        return combined.slice(0, 8);
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to attach image.');
    }
  }, [toPendingImage]);

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const appendTranscript = useCallback((text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    setValue((prev) => {
      const hasText = prev.trim().length > 0;
      return hasText ? `${prev.trimEnd()} ${normalized}` : normalized;
    });
  }, [setValue]);

  const teardownRecordingGraph = useCallback(async () => {
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

    clearListening();
  }, [clearListening]);

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
      setSelectedInputId((prev) => {
        if (prev && inputs.some((input) => input.deviceId === prev)) {
          return prev;
        }
        return inputs[0]?.deviceId || '';
      });
    } catch (error) {
      console.error('Failed to enumerate microphones:', error);
    }
  }, []);

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
    writeVoiceInputDeviceSetting(selectedInputId);
  }, [selectedInputId]);

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

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (imageFiles.length > 0) {
      event.preventDefault();
      void addFiles(imageFiles);
    }
  };

  const handleImagePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }
    void addFiles(event.target.files);
    event.target.value = '';
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    if (disabled) {
      return;
    }
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const applySlashSuggestion = useCallback((entry: SlashCommand) => {
    setValue(`/${entry.command} `);
    textareaRef.current?.focus();
  }, [setValue]);

  const executeSlashIfNeeded = useCallback(async (): Promise<boolean> => {
    if (!onSlashCommand) {
      return false;
    }
    const parsed = parseSlashInput(value);
    if (!parsed) {
      return false;
    }

    const selected = slashCommands.find((item) => {
      if (item.disabled) {
        return false;
      }
      if (item.command.toLowerCase() === parsed.command) {
        return true;
      }
      return (item.aliases || []).some((alias) => alias.toLowerCase() === parsed.command);
    });
    if (!selected) {
      return false;
    }

    if (pendingImages.length > 0) {
      alert('Slash commands currently do not support image attachments.');
      return true;
    }

    const handled = await onSlashCommand({
      id: selected.id,
      command: selected.command,
      raw: value.trim(),
      args: parsed.args,
    });

    if (handled) {
      setValue('');
    }

    return handled;
  }, [onSlashCommand, pendingImages.length, setValue, slashCommands, value]);

  const handleSend = useCallback(() => {
    if (disabled) return;
    void executeSlashIfNeeded()
      .then((handled) => {
        if (handled) {
          return;
        }
        const messageToSend = value.trim();
        if ((messageToSend || pendingImages.length > 0) && onSend) {
          onSend(messageToSend, pendingImages);
          setValue('');
          setPendingImages([]);
        }
      })
      .catch((error) => {
        console.error('Failed to execute slash command:', error);
      });
  }, [disabled, executeSlashIfNeeded, onSend, pendingImages, setValue, value]);

  const handleQueue = useCallback(() => {
    if (disabled) return;
    const parsed = parseSlashInput(value);
    if (parsed) {
      alert('Slash commands are immediate actions and cannot be queued.');
      return;
    }
    const messageToSend = value.trim();
    if ((messageToSend || pendingImages.length > 0) && onQueue) {
      onQueue(messageToSend, pendingImages);
      setValue('');
      setPendingImages([]);
    }
  }, [disabled, onQueue, pendingImages, setValue, value]);

  const startRecording = useCallback(async () => {
    if (disabled || isRecording || isTranscribing) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Microphone input is not supported in this browser.');
      return;
    }

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

      setIsRecording(true);
      setListening(analyser);
      await refreshAudioInputs();
    } catch (error: any) {
      console.error('Failed to start recording:', error);
      if (error?.name === 'NotAllowedError') {
        alert('Microphone access was denied. Please allow microphone access to use voice input.');
      }
      await teardownRecordingGraph();
      setIsRecording(false);
    }
  }, [disabled, isRecording, isTranscribing, refreshAudioInputs, selectedInputId, setListening, teardownRecordingGraph]);

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

  useEffect(() => {
    const handleToggleVoiceEvent = () => {
      if (disabled || isTranscribing) {
        return;
      }
      toggleRecording();
    };

    window.addEventListener(TOGGLE_VOICE_INPUT_EVENT, handleToggleVoiceEvent);
    return () => {
      window.removeEventListener(TOGGLE_VOICE_INPUT_EVENT, handleToggleVoiceEvent);
    };
  }, [disabled, isTranscribing, toggleRecording]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isVoiceShortcut(event)) {
      event.preventDefault();
      if (event.repeat || shortcutPressedRef.current) return;
      shortcutPressedRef.current = true;
      toggleRecording();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (slashSuggestions.length > 0 && value.trim() === '/') {
        event.preventDefault();
        applySlashSuggestion(slashSuggestions[activeSlashIndex] || slashSuggestions[0]);
        return;
      }
      event.preventDefault();
      if (showStopButton) {
        return;
      }
      handleSend();
      return;
    }

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && slashSuggestions.length > 0) {
      event.preventDefault();
      setActiveSlashIndex((prev) => {
        const max = slashSuggestions.length - 1;
        if (event.key === 'ArrowDown') {
          return prev >= max ? 0 : prev + 1;
        }
        return prev <= 0 ? max : prev - 1;
      });
      return;
    }

    if (event.key === 'Tab' && slashSuggestions.length > 0) {
      event.preventDefault();
      applySlashSuggestion(slashSuggestions[activeSlashIndex] || slashSuggestions[0]);
    }
  };

  const voiceButtonTitle = isTranscribing
    ? 'Transcribing audio...'
    : isRecording
      ? `Stop voice input (${VOICE_SHORTCUT_LABEL})`
      : `Start voice input (${VOICE_SHORTCUT_LABEL})`;

  return (
    <div
      className={`chat-input-container${isDragOver ? ' chat-input-dragover' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="chat-image-input"
        onChange={handleFileInputChange}
      />
      {pendingImages.length > 0 ? (
        <div className="chat-image-strip">
          {pendingImages.map((image) => (
            <div key={image.id} className="chat-image-chip">
              <img src={image.preview_url} alt={image.name || 'Selected image'} />
              <button type="button" onClick={() => removePendingImage(image.id)} aria-label="Remove image">×</button>
            </div>
          ))}
        </div>
      ) : null}
      {(isRecording || isTranscribing) && (
        <div className="voice-live-panel" aria-live="polite">
          {isRecording ? (
            <>
              <span className="recording-dot"></span>
              <span>Recording...</span>
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
        onPaste={handlePaste}
        placeholder={placeholder || (disabled ? 'Agent is processing...' : 'Start a new chat...')}
        rows={1}
        disabled={disabled}
      />
      {slashSuggestions.length > 0 ? (
        <div className="chat-slash-menu" role="listbox" aria-label="Slash commands">
          {slashSuggestions.map((entry, index) => {
            const isActive = index === activeSlashIndex;
            return (
              <button
                key={entry.id}
                type="button"
                className={`chat-slash-item${isActive ? ' active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySlashSuggestion(entry);
                }}
                onMouseEnter={() => setActiveSlashIndex(index)}
                role="option"
                aria-selected={isActive}
                title={entry.description || entry.title}
              >
                <span className="chat-slash-command">/{entry.command}</span>
                <span className="chat-slash-label">
                  {entry.title}
                  {entry.description ? ` - ${entry.description}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="chat-input-actions">
        {actionControls}
        <button
          type="button"
          className="image-button"
          onClick={handleImagePicker}
          disabled={disabled}
          title="Attach images"
          aria-label="Attach images"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="send-icon" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        {showVoiceButton ? (
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
        ) : null}
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
                disabled={disabled || (!value.trim() && pendingImages.length === 0)}
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
              disabled={disabled || (!value.trim() && pendingImages.length === 0)}
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
