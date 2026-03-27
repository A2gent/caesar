import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browseSkillDirectories, getSettings, saveMeetingArtifacts, transcribeSpeech, updateSettings, type MindTreeEntry, type SaveMeetingArtifactsResponse } from './api';
import { useAvatarAudio } from './avatarAudio';
import { normalizeLanguageForBackend, readVoiceInputDeviceSetting, readVoiceInputLanguageSetting } from './voiceInputSettings';

type MeetingStatus = 'idle' | 'recording' | 'paused' | 'stopping' | 'saving';
type PickerTarget = 'notes' | 'audio' | null;

interface TranscriptEntry {
  id: string;
  offsetSeconds: number;
  speaker: string;
  text: string;
}

interface ActiveCapture {
  key: 'me' | 'them';
  speakerRef: () => string;
  stream: MediaStream;
  recorder: MediaRecorder | null;
  recorderChunks: Blob[];
  audioContext: AudioContext | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  processorNode: ScriptProcessorNode | null;
  analyserNode: AnalyserNode | null;
  silentGainNode: GainNode | null;
  pendingPcmChunks: Float32Array[];
  sampleRate: number;
  isTranscribing: boolean;
}

const MEETING_AUDIO_FOLDER_KEY = 'A2GENT_MEETINGS_AUDIO_FOLDER';
const MEETING_NOTES_FOLDER_KEY = 'A2GENT_MEETINGS_NOTES_FOLDER';
const TRANSCRIBE_FLUSH_INTERVAL_MS = 4500;

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
  if (samples.length === 0) return samples;
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) {
    start += 1;
  }
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) {
    end -= 1;
  }
  if (start >= end) return samples;
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

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600).toString().padStart(2, '0');
  const m = Math.floor((safe % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function sanitizeFilePart(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 48);
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return '.m4a';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('wav')) return '.wav';
  return '.webm';
}

function buildMeetingMarkdown(
  title: string,
  startedAt: Date,
  endedAt: Date,
  meLabel: string,
  themLabel: string,
  entries: TranscriptEntry[],
): string {
  const sorted = [...entries].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const header = [
    `# Meeting: ${title}`,
    '',
    `- Started: ${startedAt.toISOString()}`,
    `- Ended: ${endedAt.toISOString()}`,
    `- Duration: ${formatDuration((endedAt.getTime() - startedAt.getTime()) / 1000)}`,
    `- Participants: ${meLabel}, ${themLabel}`,
    '',
    '## Transcript',
    '',
  ];
  const lines = sorted.map((entry) => `- [${formatDuration(entry.offsetSeconds)}] **${entry.speaker}:** ${entry.text}`);
  return [...header, ...lines].join('\n');
}

function getParentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  if (trimmed === '' || trimmed === '/') return '/';
  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (separatorIndex <= 0) return '/';
  return trimmed.slice(0, separatorIndex);
}

function MeetingsView() {
  const { setListening, clearListening, setRecording, clearRecording } = useAvatarAudio();
  const [status, setStatus] = useState<MeetingStatus>('idle');
  const statusRef = useRef<MeetingStatus>('idle');
  const [meetingTitle, setMeetingTitle] = useState('1:1 Meeting');
  const [meSpeakerLabel, setMeSpeakerLabel] = useState('Me');
  const [themSpeakerLabel, setThemSpeakerLabel] = useState('Them');
  const [captureRemoteAudio, setCaptureRemoteAudio] = useState(true);
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notesFolder, setNotesFolder] = useState('');
  const [audioFolder, setAudioFolder] = useState('');
  const [isSavingFolders, setIsSavingFolders] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
  const [pickerPath, setPickerPath] = useState('');
  const [pickerEntries, setPickerEntries] = useState<MindTreeEntry[]>([]);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveMeetingArtifactsResponse | null>(null);
  const [meetingTimerSeconds, setMeetingTimerSeconds] = useState(0);

  const language = useMemo(() => normalizeLanguageForBackend(readVoiceInputLanguageSetting()), []);
  const selectedInputId = useMemo(() => readVoiceInputDeviceSetting(), []);

  const capturesRef = useRef<Map<'me' | 'them', ActiveCapture>>(new Map());
  const transcriptEntriesRef = useRef<TranscriptEntry[]>([]);
  const flushIntervalRef = useRef<number | null>(null);
  const meetingStartRef = useRef<Date | null>(null);
  const meetingIDRef = useRef<string>('');
  const timerIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = status;
    if (status === 'recording') {
      setRecording();
    } else {
      clearRecording();
    }
  }, [clearRecording, setRecording, status]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const settings = await getSettings();
        setNotesFolder((settings[MEETING_NOTES_FOLDER_KEY] || '').trim());
        setAudioFolder((settings[MEETING_AUDIO_FOLDER_KEY] || '').trim());
      } catch (loadError) {
        console.error('Failed to load meeting storage settings:', loadError);
      }
    };
    void loadConfig();
  }, []);

  useEffect(() => {
    return () => {
      if (flushIntervalRef.current !== null) {
        window.clearInterval(flushIntervalRef.current);
      }
      if (timerIntervalRef.current !== null) {
        window.clearInterval(timerIntervalRef.current);
      }
      void teardownAllCaptures();
      clearRecording();
      clearListening();
    };
  }, [clearListening, clearRecording]);

  const appendTranscript = useCallback((speaker: string, text: string, offsetSeconds: number) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const entry: TranscriptEntry = {
      id: crypto.randomUUID(),
      offsetSeconds,
      speaker: speaker.trim() || 'Speaker',
      text: trimmed,
    };
    setTranscriptEntries((current) => {
      const next = [...current, entry];
      transcriptEntriesRef.current = next;
      return next;
    });
  }, []);

  const closeAudioGraph = useCallback(async (capture: ActiveCapture) => {
    capture.processorNode?.disconnect();
    capture.sourceNode?.disconnect();
    capture.analyserNode?.disconnect();
    capture.silentGainNode?.disconnect();
    capture.processorNode = null;
    capture.sourceNode = null;
    capture.analyserNode = null;
    capture.silentGainNode = null;
    if (capture.audioContext) {
      try {
        await capture.audioContext.close();
      } catch {
        // ignore close errors
      }
      capture.audioContext = null;
    }
  }, []);

  const stopRecorder = useCallback(async (capture: ActiveCapture) => {
    const recorder = capture.recorder;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }
    await new Promise<void>((resolve) => {
      const handleDone = () => resolve();
      recorder.addEventListener('stop', handleDone, { once: true });
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }, []);

  const teardownCapture = useCallback(async (capture: ActiveCapture, stopRecorderFirst: boolean) => {
    if (stopRecorderFirst) {
      await stopRecorder(capture);
    }
    capture.stream.getTracks().forEach((track) => track.stop());
    await closeAudioGraph(capture);
  }, [closeAudioGraph, stopRecorder]);

  const teardownAllCaptures = useCallback(async () => {
    const captures = [...capturesRef.current.values()];
    capturesRef.current.clear();
    await Promise.all(captures.map((capture) => teardownCapture(capture, true)));
  }, [teardownCapture]);

  const flushCaptureTranscription = useCallback(async (capture: ActiveCapture) => {
    if (capture.isTranscribing || capture.pendingPcmChunks.length === 0) {
      return;
    }
    const chunks = capture.pendingPcmChunks.splice(0, capture.pendingPcmChunks.length);
    capture.isTranscribing = true;
    try {
      const wav = encodeWav(chunks, capture.sampleRate);
      const res = await transcribeSpeech(wav, language);
      const startedAt = meetingStartRef.current;
      const offsetSeconds = startedAt ? (Date.now() - startedAt.getTime()) / 1000 : 0;
      appendTranscript(capture.speakerRef(), res.text || '', offsetSeconds);
    } catch (transcribeError) {
      console.error('Meeting transcription failed:', transcribeError);
    } finally {
      capture.isTranscribing = false;
    }
  }, [appendTranscript, language]);

  const flushAllTranscriptions = useCallback(async () => {
    const captures = [...capturesRef.current.values()];
    for (const capture of captures) {
      await flushCaptureTranscription(capture);
    }
  }, [flushCaptureTranscription]);

  const loadPickerPath = useCallback(async (path: string) => {
    setIsPickerLoading(true);
    try {
      const response = await browseSkillDirectories(path);
      setPickerPath(response.path);
      setPickerEntries(response.entries);
    } catch (browseError) {
      console.error('Failed to browse directories for meeting storage:', browseError);
      setPickerEntries([]);
    } finally {
      setIsPickerLoading(false);
    }
  }, []);

  const openPicker = useCallback(async (target: Exclude<PickerTarget, null>) => {
    setPickerTarget(target);
    const base = target === 'audio' ? audioFolder : notesFolder;
    await loadPickerPath(base || '');
  }, [audioFolder, loadPickerPath, notesFolder]);

  const handleSaveStorageFolders = useCallback(async () => {
    setError('');
    setMessage('');
    setSaveResult(null);
    const trimmedNotes = notesFolder.trim();
    const trimmedAudio = audioFolder.trim();
    if (!trimmedNotes || !trimmedAudio) {
      setError('Both notes and audio folders are required.');
      return;
    }

    setIsSavingFolders(true);
    try {
      const settings = await getSettings();
      const next = {
        ...settings,
        [MEETING_NOTES_FOLDER_KEY]: trimmedNotes,
        [MEETING_AUDIO_FOLDER_KEY]: trimmedAudio,
      };
      await updateSettings(next);
      setMessage('Meeting storage folders saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save meeting folders.');
    } finally {
      setIsSavingFolders(false);
    }
  }, [audioFolder, notesFolder]);

  const createCapture = useCallback(async (
    key: 'me' | 'them',
    stream: MediaStream,
    speakerRef: () => string,
    setAsListeningSource: boolean,
  ): Promise<ActiveCapture> => {
    const capture: ActiveCapture = {
      key,
      speakerRef,
      stream,
      recorder: null,
      recorderChunks: [],
      audioContext: null,
      sourceNode: null,
      processorNode: null,
      analyserNode: null,
      silentGainNode: null,
      pendingPcmChunks: [],
      sampleRate: 16000,
      isTranscribing: false,
    };

    const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

    capture.recorder = preferredMime
      ? new MediaRecorder(stream, { mimeType: preferredMime })
      : new MediaRecorder(stream);
    capture.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        capture.recorderChunks.push(event.data);
      }
    };
    capture.recorder.start(1000);

    const context = new AudioContext();
    await context.resume();
    const sourceNode = context.createMediaStreamSource(stream);
    const analyserNode = context.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.82;
    const processorNode = context.createScriptProcessor(4096, 1, 1);
    const silentGainNode = context.createGain();
    silentGainNode.gain.value = 0;

    capture.audioContext = context;
    capture.sourceNode = sourceNode;
    capture.analyserNode = analyserNode;
    capture.processorNode = processorNode;
    capture.silentGainNode = silentGainNode;
    capture.sampleRate = context.sampleRate;

    processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
      if (statusRef.current !== 'recording') {
        return;
      }
      const data = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(data.length);
      copy.set(data);
      capture.pendingPcmChunks.push(copy);
    };

    sourceNode.connect(analyserNode);
    analyserNode.connect(processorNode);
    processorNode.connect(silentGainNode);
    silentGainNode.connect(context.destination);

    if (setAsListeningSource) {
      setListening(analyserNode);
    }

    return capture;
  }, [setListening]);

  const startMeeting = useCallback(async () => {
    setError('');
    setMessage('');
    setSaveResult(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone recording is not supported in this browser.');
      return;
    }
    if (notesFolder.trim() === '' || audioFolder.trim() === '') {
      setError('Configure notes and audio folders before starting.');
      return;
    }

    const title = meetingTitle.trim();
    if (!title) {
      setError('Meeting title is required.');
      return;
    }

    setTranscriptEntries([]);
    transcriptEntriesRef.current = [];
    meetingStartRef.current = new Date();
    meetingIDRef.current = crypto.randomUUID();
    setMeetingTimerSeconds(0);

    try {
      const micConstraints: MediaStreamConstraints = {
        audio: selectedInputId ? { deviceId: { exact: selectedInputId } } : true,
      };
      const micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
      const meCapture = await createCapture('me', micStream, () => meSpeakerLabel, true);
      capturesRef.current.set('me', meCapture);

      if (captureRemoteAudio && navigator.mediaDevices?.getDisplayMedia) {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
          });
          const remoteAudioTracks = displayStream.getAudioTracks();
          const remoteVideoTracks = displayStream.getVideoTracks();
          if (remoteAudioTracks.length > 0) {
            const remoteAudioStream = new MediaStream([remoteAudioTracks[0]]);
            const themCapture = await createCapture('them', remoteAudioStream, () => themSpeakerLabel, false);
            capturesRef.current.set('them', themCapture);
          } else {
            displayStream.getTracks().forEach((track) => track.stop());
            setMessage('Started with microphone only. Remote/system audio was not shared.');
          }
          remoteVideoTracks.forEach((track) => track.stop());
        } catch (displayError) {
          setMessage('Started with microphone only. Remote audio capture was skipped.');
          console.warn('Display audio capture not available:', displayError);
        }
      }

      if (flushIntervalRef.current !== null) {
        window.clearInterval(flushIntervalRef.current);
      }
      flushIntervalRef.current = window.setInterval(() => {
        if (statusRef.current !== 'recording') return;
        void flushAllTranscriptions();
      }, TRANSCRIBE_FLUSH_INTERVAL_MS);

      if (timerIntervalRef.current !== null) {
        window.clearInterval(timerIntervalRef.current);
      }
      timerIntervalRef.current = window.setInterval(() => {
        const started = meetingStartRef.current;
        if (!started) return;
        setMeetingTimerSeconds((Date.now() - started.getTime()) / 1000);
      }, 500);

      setStatus('recording');
    } catch (startError: unknown) {
      console.error('Failed to start meeting recording:', startError);
      setError(startError instanceof Error ? startError.message : 'Failed to start meeting recording.');
      await teardownAllCaptures();
      setStatus('idle');
      clearListening();
      clearRecording();
    }
  }, [
    audioFolder,
    captureRemoteAudio,
    clearListening,
    clearRecording,
    createCapture,
    flushAllTranscriptions,
    meSpeakerLabel,
    meetingTitle,
    notesFolder,
    selectedInputId,
    teardownAllCaptures,
    themSpeakerLabel,
  ]);

  const pauseMeeting = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    for (const capture of capturesRef.current.values()) {
      if (capture.recorder && capture.recorder.state === 'recording') {
        capture.recorder.pause();
      }
    }
    setStatus('paused');
    clearListening();
  }, [clearListening]);

  const resumeMeeting = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    for (const capture of capturesRef.current.values()) {
      if (capture.recorder && capture.recorder.state === 'paused') {
        capture.recorder.resume();
      }
    }
    const micCapture = capturesRef.current.get('me');
    if (micCapture?.analyserNode) {
      setListening(micCapture.analyserNode);
    }
    setStatus('recording');
  }, [setListening]);

  const stopMeeting = useCallback(async () => {
    if (statusRef.current === 'idle' || statusRef.current === 'stopping' || statusRef.current === 'saving') return;
    setStatus('stopping');
    clearListening();
    clearRecording();
    setError('');
    setMessage('');

    if (flushIntervalRef.current !== null) {
      window.clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    await flushAllTranscriptions();
    const captures = [...capturesRef.current.values()];
    await Promise.all(captures.map((capture) => stopRecorder(capture)));
    await Promise.all(captures.map((capture) => closeAudioGraph(capture)));
    captures.forEach((capture) => capture.stream.getTracks().forEach((track) => track.stop()));

    setStatus('saving');
    const endedAt = new Date();
    const startedAt = meetingStartRef.current || endedAt;
    setMeetingTimerSeconds((endedAt.getTime() - startedAt.getTime()) / 1000);

    const markdown = buildMeetingMarkdown(
      meetingTitle.trim() || 'Meeting',
      startedAt,
      endedAt,
      meSpeakerLabel.trim() || 'Me',
      themSpeakerLabel.trim() || 'Them',
      transcriptEntriesRef.current,
    );

    try {
      const audioFiles = captures.map((capture) => {
        const type = capture.recorder?.mimeType || 'audio/webm';
        const ext = extensionForMimeType(type);
        const speakerSafe = sanitizeFilePart(capture.speakerRef()) || capture.key;
        return {
          filename: `${speakerSafe}${ext}`,
          blob: new Blob(capture.recorderChunks, { type }),
        };
      }).filter((item) => item.blob.size > 0);

      const result = await saveMeetingArtifacts({
        meetingId: meetingIDRef.current || crypto.randomUUID(),
        title: meetingTitle.trim() || 'Meeting',
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        notesMarkdown: markdown,
        notesFolder: notesFolder.trim(),
        audioFolder: audioFolder.trim(),
        audioFiles,
      });
      setSaveResult(result);
      setMessage('Meeting recording and notes saved.');
    } catch (saveError) {
      console.error('Failed to save meeting artifacts:', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Failed to save meeting artifacts.');
    } finally {
      capturesRef.current.clear();
    setStatus('idle');
    }
  }, [
    audioFolder,
    clearListening,
    clearRecording,
    closeAudioGraph,
    flushAllTranscriptions,
    meSpeakerLabel,
    meetingTitle,
    notesFolder,
    stopRecorder,
    themSpeakerLabel,
  ]);

  const isBusy = status === 'recording' || status === 'paused' || status === 'stopping' || status === 'saving';

  return (
    <div className="meetings-view">
      <div className="meetings-controls">
        <div className="meetings-field-grid">
          <label className="settings-field">
            <span>Meeting title</span>
            <input
              type="text"
              value={meetingTitle}
              onChange={(event) => setMeetingTitle(event.target.value)}
              disabled={isBusy}
              placeholder="Weekly planning"
            />
          </label>
          <label className="settings-field">
            <span>Your speaker label</span>
            <input
              type="text"
              value={meSpeakerLabel}
              onChange={(event) => setMeSpeakerLabel(event.target.value)}
              disabled={isBusy}
              placeholder="Me"
            />
          </label>
          <label className="settings-field">
            <span>Remote speaker label</span>
            <input
              type="text"
              value={themSpeakerLabel}
              onChange={(event) => setThemSpeakerLabel(event.target.value)}
              disabled={isBusy}
              placeholder="Them"
            />
          </label>
        </div>

        <div className="meetings-field-grid">
          <label className="settings-field">
            <span>Notes folder (Markdown)</span>
            <div className="tool-folder-picker-row">
              <input
                type="text"
                value={notesFolder}
                onChange={(event) => setNotesFolder(event.target.value)}
                disabled={isBusy}
                placeholder="/path/to/meeting-notes"
              />
              <button type="button" className="settings-add-btn" onClick={() => void openPicker('notes')} disabled={isBusy}>
                Browse
              </button>
            </div>
          </label>
          <label className="settings-field">
            <span>Audio folder</span>
            <div className="tool-folder-picker-row">
              <input
                type="text"
                value={audioFolder}
                onChange={(event) => setAudioFolder(event.target.value)}
                disabled={isBusy}
                placeholder="/path/to/meeting-audio"
              />
              <button type="button" className="settings-add-btn" onClick={() => void openPicker('audio')} disabled={isBusy}>
                Browse
              </button>
            </div>
          </label>
        </div>

        <div className="meetings-action-row">
          <label className="settings-field settings-field-checkbox">
            <input
              type="checkbox"
              checked={captureRemoteAudio}
              disabled={isBusy}
              onChange={(event) => setCaptureRemoteAudio(event.target.checked)}
            />
            <span>Capture remote/system audio (share tab/app audio when prompted)</span>
          </label>
          <button type="button" className="settings-add-btn" onClick={() => void handleSaveStorageFolders()} disabled={isSavingFolders || isBusy}>
            {isSavingFolders ? 'Saving paths...' : 'Save storage paths'}
          </button>
        </div>

        <div className="meetings-action-row">
          <span className={`meetings-status-badge status-${status}`}>Status: {status}</span>
          <span className="meetings-timer">Elapsed: {formatDuration(meetingTimerSeconds)}</span>
          {status === 'idle' ? (
            <button type="button" className="settings-save-btn" onClick={() => void startMeeting()}>
              New meeting
            </button>
          ) : null}
          {status === 'recording' ? (
            <>
              <button type="button" className="settings-add-btn" onClick={() => pauseMeeting()}>
                Pause
              </button>
              <button type="button" className="settings-remove-btn" onClick={() => void stopMeeting()}>
                Stop
              </button>
            </>
          ) : null}
          {status === 'paused' ? (
            <>
              <button type="button" className="settings-add-btn" onClick={() => resumeMeeting()}>
                Resume
              </button>
              <button type="button" className="settings-remove-btn" onClick={() => void stopMeeting()}>
                Stop
              </button>
            </>
          ) : null}
        </div>

        {message ? <div className="success-banner">{message}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {saveResult ? (
          <div className="meetings-save-result">
            <div><strong>Notes:</strong> <code>{saveResult.notes_path}</code></div>
            {saveResult.audio_paths.length > 0 ? (
              <div><strong>Audio:</strong> <code>{saveResult.audio_paths.join(', ')}</code></div>
            ) : (
              <div><strong>Audio:</strong> no audio files saved</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="meetings-transcript">
        <h3>Live transcript</h3>
        {transcriptEntries.length === 0 ? (
          <div className="project-files-empty">
            <p>No transcript yet.</p>
            <p>Start a meeting and speech will appear here in near real time.</p>
          </div>
        ) : (
          <div className="meetings-transcript-list">
            {transcriptEntries
              .slice()
              .sort((a, b) => a.offsetSeconds - b.offsetSeconds)
              .map((entry) => (
                <div key={entry.id} className="meetings-transcript-entry">
                  <span className="meetings-transcript-time">{formatDuration(entry.offsetSeconds)}</span>
                  <span className="meetings-transcript-speaker">{entry.speaker}</span>
                  <span className="meetings-transcript-text">{entry.text}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {pickerTarget ? (
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose meetings folder">
          <div className="mind-picker-dialog">
            <h2>Choose {pickerTarget === 'notes' ? 'notes' : 'audio'} folder</h2>
            <div className="mind-picker-path">{pickerPath || 'Loading...'}</div>
            <div className="mind-picker-actions">
              <button
                type="button"
                className="settings-add-btn"
                onClick={() => void loadPickerPath(getParentPath(pickerPath))}
                disabled={isPickerLoading || pickerPath === '' || getParentPath(pickerPath) === pickerPath}
              >
                Up
              </button>
              <button
                type="button"
                className="settings-save-btn"
                onClick={() => {
                  if (pickerTarget === 'notes') {
                    setNotesFolder(pickerPath);
                  } else {
                    setAudioFolder(pickerPath);
                  }
                  setPickerTarget(null);
                }}
                disabled={isPickerLoading || pickerPath.trim() === ''}
              >
                Use this folder
              </button>
              <button type="button" className="settings-remove-btn" onClick={() => setPickerTarget(null)}>
                Cancel
              </button>
            </div>
            <div className="mind-picker-list">
              {!isPickerLoading && pickerEntries.length === 0 ? (
                <div className="sessions-empty">No sub-folders found.</div>
              ) : null}
              {pickerEntries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className="mind-picker-item"
                  onClick={() => void loadPickerPath(entry.path)}
                >
                  📁 {entry.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default MeetingsView;
