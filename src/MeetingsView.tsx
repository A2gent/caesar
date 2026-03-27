import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  deleteMeetingArtifacts,
  getMeetingAudioAssetUrl,
  getSettings,
  listMeetingArtifacts,
  saveMeetingArtifacts,
  transcribeSpeech,
  type MeetingHistoryItem,
  type SaveMeetingArtifactsResponse,
} from './api';
import { useAvatarAudio } from './avatarAudio';
import { buildOpenInMyMindUrl } from './myMindNavigation';
import { normalizeLanguageForBackend, readVoiceInputDeviceSetting, readVoiceInputLanguageSetting } from './voiceInputSettings';

type MeetingStatus = 'idle' | 'recording' | 'paused' | 'stopping' | 'saving';
type MeetingsPanel = 'new' | 'past';
const MEETING_AUDIO_FOLDER_KEY = 'A2GENT_MEETINGS_AUDIO_FOLDER';
const MEETING_NOTES_FOLDER_KEY = 'A2GENT_MEETINGS_NOTES_FOLDER';
const MEETING_CAPTURE_REMOTE_AUDIO_KEY = 'A2GENT_MEETINGS_CAPTURE_REMOTE_AUDIO';
const MEETING_ME_SPEAKER_LABEL_KEY = 'A2GENT_MEETINGS_ME_SPEAKER_LABEL';

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

interface PastTranscriptEntry {
  id: string;
  offsetSeconds: number;
  speaker: string;
  text: string;
}

const TRANSCRIBE_FLUSH_INTERVAL_MS = 10000;
const MAX_SAME_SPEAKER_GROUP_SECONDS = 10;
const MIN_TRANSCRIBE_SAMPLES_AT_16K = 160;
const NO_SPEECH_MARKERS = new Set([
  'blank audio',
  'no speech',
  'silence',
  'silent',
  'inaudible',
  'no audio',
]);

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
  if (start > end) return new Float32Array(0);
  return samples.slice(start, end + 1);
}

function isNoSpeechTranscript(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\[|\]|\(|\)|\{|\}/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  return NO_SPEECH_MARKERS.has(normalized);
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

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob | null {
  const targetRate = 16000;
  const merged = mergeFloat32(chunks);
  const trimmed = trimSilence(merged);
  if (trimmed.length === 0) return null;
  const pcm = downsampleLinear(trimmed, sampleRate, targetRate);
  if (pcm.length < MIN_TRANSCRIBE_SAMPLES_AT_16K) return null;
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

function formatMeetingDateTime(value?: string): string {
  const raw = (value || '').trim();
  if (!raw) return 'Unknown time';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('et-EE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed);
}

function fileNameFromPath(path: string): string {
  const normalized = (path || '').trim().replace(/\\/g, '/');
  if (!normalized) return 'meeting.md';
  const parts = normalized.split('/');
  return parts[parts.length - 1] || 'meeting.md';
}

function parseDurationToSeconds(value: string): number {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const h = Number.parseInt(match[1], 10) || 0;
  const m = Number.parseInt(match[2], 10) || 0;
  const s = Number.parseInt(match[3], 10) || 0;
  return h * 3600 + m * 60 + s;
}

function parsePastTranscript(markdown: string): PastTranscriptEntry[] {
  if (!markdown.trim()) return [];
  const lines = markdown.split('\n');
  const entries: PastTranscriptEntry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const match = line.match(/^- \[(\d{2}:\d{2}:\d{2})\]\s+\*\*(.+?):\*\*\s*(.+)$/);
    if (!match) continue;
    entries.push({
      id: `${match[1]}-${entries.length}`,
      offsetSeconds: parseDurationToSeconds(match[1]),
      speaker: match[2].trim() || 'Speaker',
      text: match[3].trim(),
    });
  }
  return entries;
}

function speakerTone(speaker: string, meLabel: string, themLabel: string): 'me' | 'them' | 'other' {
  const normalizedSpeaker = speaker.trim().toLowerCase();
  const normalizedMe = meLabel.trim().toLowerCase();
  const normalizedThem = themLabel.trim().toLowerCase();

  if (normalizedSpeaker && normalizedMe && normalizedSpeaker === normalizedMe) return 'me';
  if (normalizedSpeaker && normalizedThem && normalizedSpeaker === normalizedThem) return 'them';

  if (normalizedSpeaker === 'me' || normalizedSpeaker === 'i') return 'me';
  if (normalizedSpeaker === 'them' || normalizedSpeaker === 'remote') return 'them';
  return 'other';
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

function MeetingsView() {
  const { projectID } = useParams<{ projectID: string }>();
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
  const [saveResult, setSaveResult] = useState<SaveMeetingArtifactsResponse | null>(null);
  const [meetingTimerSeconds, setMeetingTimerSeconds] = useState(0);
  const [activePanel, setActivePanel] = useState<MeetingsPanel>('new');
  const [pastMeetings, setPastMeetings] = useState<MeetingHistoryItem[]>([]);
  const [isPastMeetingsLoading, setIsPastMeetingsLoading] = useState(false);
  const [deletingMeetingPath, setDeletingMeetingPath] = useState('');
  const [pastMeetingsError, setPastMeetingsError] = useState('');
  const [selectedPastMeetingPath, setSelectedPastMeetingPath] = useState('');
  const [pastPlaybackSeconds, setPastPlaybackSeconds] = useState(0);

  const language = useMemo(() => normalizeLanguageForBackend(readVoiceInputLanguageSetting()), []);
  const selectedInputId = useMemo(() => readVoiceInputDeviceSetting(), []);

  const capturesRef = useRef<Map<'me' | 'them', ActiveCapture>>(new Map());
  const pastAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const pastTranscriptEntryRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastPastPlaybackSecondsRef = useRef(0);
  const isSyncingPastAudioRef = useRef(false);
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
        setCaptureRemoteAudio(settings[MEETING_CAPTURE_REMOTE_AUDIO_KEY] !== 'false');
        setMeSpeakerLabel((settings[MEETING_ME_SPEAKER_LABEL_KEY] || 'Me').trim() || 'Me');
      } catch (loadError) {
        console.error('Failed to load meeting storage settings:', loadError);
      }
    };
    void loadConfig();
  }, []);

  const loadPastMeetings = useCallback(async () => {
    const trimmedNotes = notesFolder.trim();
    const trimmedAudio = audioFolder.trim();
    if (!trimmedNotes || !trimmedAudio) {
      setPastMeetings([]);
      setSelectedPastMeetingPath('');
      setPastMeetingsError('');
      return;
    }
    setIsPastMeetingsLoading(true);
    setPastMeetingsError('');
    try {
      const response = await listMeetingArtifacts(trimmedNotes, trimmedAudio);
      const items = response.meetings || [];
      setPastMeetings(items);
      setSelectedPastMeetingPath((current) => {
        if (items.length === 0) return '';
        if (current && items.some((item) => item.notes_path === current)) return current;
        return items[0]?.notes_path || '';
      });
    } catch (loadError) {
      console.error('Failed to load past meetings:', loadError);
      setPastMeetingsError(loadError instanceof Error ? loadError.message : 'Failed to load past meetings.');
      setPastMeetings([]);
      setSelectedPastMeetingPath('');
    } finally {
      setIsPastMeetingsLoading(false);
    }
  }, [audioFolder, notesFolder]);

  useEffect(() => {
    void loadPastMeetings();
  }, [loadPastMeetings]);

  const appendTranscript = useCallback((speaker: string, text: string, offsetSeconds: number) => {
    const trimmed = text.trim();
    if (isNoSpeechTranscript(trimmed)) return;
    const normalizedSpeaker = speaker.trim() || 'Speaker';
    setTranscriptEntries((current) => {
      const last = current[current.length - 1];
      if (
        last
        && last.speaker === normalizedSpeaker
        && offsetSeconds - last.offsetSeconds <= MAX_SAME_SPEAKER_GROUP_SECONDS
      ) {
        const next = [
          ...current.slice(0, -1),
          {
            ...last,
            text: `${last.text} ${trimmed}`.replace(/\s+/g, ' ').trim(),
          },
        ];
        transcriptEntriesRef.current = next;
        return next;
      }
      const entry: TranscriptEntry = {
        id: crypto.randomUUID(),
        offsetSeconds,
        speaker: normalizedSpeaker,
        text: trimmed,
      };
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
  }, [clearListening, clearRecording, teardownAllCaptures]);

  const flushCaptureTranscription = useCallback(async (capture: ActiveCapture) => {
    if (capture.isTranscribing || capture.pendingPcmChunks.length === 0) {
      return;
    }
    const chunks = capture.pendingPcmChunks.splice(0, capture.pendingPcmChunks.length);
    capture.isTranscribing = true;
    try {
      const wav = encodeWav(chunks, capture.sampleRate);
      if (!wav) {
        return;
      }
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
    setActivePanel('new');

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
      await loadPastMeetings();
      setActivePanel('past');
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
    loadPastMeetings,
    stopRecorder,
    themSpeakerLabel,
  ]);

  const isBusy = status === 'recording' || status === 'paused' || status === 'stopping' || status === 'saving';
  const selectedPastMeeting = useMemo(
    () => pastMeetings.find((meeting) => meeting.notes_path === selectedPastMeetingPath) || null,
    [pastMeetings, selectedPastMeetingPath],
  );
  const parsedPastTranscript = useMemo(
    () => parsePastTranscript(selectedPastMeeting?.transcript_markdown || ''),
    [selectedPastMeeting?.transcript_markdown],
  );
  const activePastTranscriptEntryID = useMemo(() => {
    if (parsedPastTranscript.length === 0) return '';
    for (let i = parsedPastTranscript.length - 1; i >= 0; i -= 1) {
      if (pastPlaybackSeconds >= parsedPastTranscript[i].offsetSeconds) {
        return parsedPastTranscript[i].id;
      }
    }
    return parsedPastTranscript[0].id;
  }, [parsedPastTranscript, pastPlaybackSeconds]);

  useEffect(() => {
    if (!activePastTranscriptEntryID) return;
    const activeNode = pastTranscriptEntryRefs.current.get(activePastTranscriptEntryID);
    if (!activeNode) return;
    activeNode.scrollIntoView({ block: 'nearest' });
  }, [activePastTranscriptEntryID]);

  useEffect(() => {
    setPastPlaybackSeconds(0);
    lastPastPlaybackSecondsRef.current = 0;
  }, [selectedPastMeetingPath]);

  const withPastAudioSyncGuard = useCallback((fn: () => void) => {
    if (isSyncingPastAudioRef.current) return;
    isSyncingPastAudioRef.current = true;
    try {
      fn();
    } finally {
      window.setTimeout(() => {
        isSyncingPastAudioRef.current = false;
      }, 0);
    }
  }, []);

  const syncPastAudios = useCallback((sourcePath: string, nextTime: number, playState?: 'play' | 'pause') => {
    withPastAudioSyncGuard(() => {
      for (const [audioPath, audio] of pastAudioRefs.current.entries()) {
        if (audioPath === sourcePath) continue;
        if (Number.isFinite(nextTime) && Math.abs(audio.currentTime - nextTime) > 0.35) {
          audio.currentTime = nextTime;
        }
        if (playState === 'play') {
          void audio.play().catch(() => {
            // ignore autoplay restrictions
          });
        } else if (playState === 'pause') {
          audio.pause();
        }
      }
    });
  }, [withPastAudioSyncGuard]);

  const seekAllPastAudios = useCallback((nextTime: number) => {
    withPastAudioSyncGuard(() => {
      for (const audio of pastAudioRefs.current.values()) {
        if (Math.abs(audio.currentTime - nextTime) > 0.35) {
          audio.currentTime = nextTime;
        }
      }
    });
    setPastPlaybackSeconds(nextTime);
    lastPastPlaybackSecondsRef.current = nextTime;
  }, [withPastAudioSyncGuard]);

  const bindPastAudioRef = useCallback((audioPath: string, element: HTMLAudioElement | null) => {
    if (!element) {
      pastAudioRefs.current.delete(audioPath);
      return;
    }
    pastAudioRefs.current.set(audioPath, element);
  }, []);

  const handlePastAudioSeeked = useCallback((audioPath: string) => {
    const source = pastAudioRefs.current.get(audioPath);
    if (!source) return;
    syncPastAudios(audioPath, source.currentTime);
  }, [syncPastAudios]);

  const handlePastAudioPlay = useCallback((audioPath: string) => {
    const source = pastAudioRefs.current.get(audioPath);
    if (!source) return;
    syncPastAudios(audioPath, source.currentTime, 'play');
  }, [syncPastAudios]);

  const handlePastAudioPause = useCallback((audioPath: string) => {
    const source = pastAudioRefs.current.get(audioPath);
    if (!source) return;
    syncPastAudios(audioPath, source.currentTime, 'pause');
  }, [syncPastAudios]);

  const handlePastAudioTimeUpdate = useCallback((audioPath: string) => {
    const source = pastAudioRefs.current.get(audioPath);
    if (!source) return;
    const current = source.currentTime;
    if (!Number.isFinite(current)) return;
    if (Math.abs(current - lastPastPlaybackSecondsRef.current) < 0.2) return;
    lastPastPlaybackSecondsRef.current = current;
    setPastPlaybackSeconds(current);
  }, []);
  const handleDeleteMeeting = useCallback(async (meeting: MeetingHistoryItem) => {
    const meetingTitleForPrompt = (meeting.title || 'Meeting').trim();
    const confirmed = window.confirm(`Delete "${meetingTitleForPrompt}" and all associated audio files? This cannot be undone.`);
    if (!confirmed) return;

    setPastMeetingsError('');
    setDeletingMeetingPath(meeting.notes_path);
    try {
      await deleteMeetingArtifacts({
        notes_path: meeting.notes_path,
        audio_paths: meeting.audio_paths || [],
      });
      await loadPastMeetings();
    } catch (deleteError) {
      console.error('Failed to delete meeting artifacts:', deleteError);
      setPastMeetingsError(deleteError instanceof Error ? deleteError.message : 'Failed to delete meeting artifacts.');
    } finally {
      setDeletingMeetingPath('');
    }
  }, [loadPastMeetings]);

  return (
    <div className="meetings-view">
      <div className="meetings-panel-switch" role="tablist" aria-label="Meetings panel">
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'new'}
          className={`meetings-panel-switch-btn ${activePanel === 'new' ? 'active' : ''}`}
          onClick={() => setActivePanel('new')}
          disabled={status === 'recording' || status === 'paused' || status === 'stopping' || status === 'saving'}
        >
          New meeting
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === 'past'}
          className={`meetings-panel-switch-btn ${activePanel === 'past' ? 'active' : ''}`}
          onClick={() => setActivePanel('past')}
          disabled={status === 'recording' || status === 'paused' || status === 'stopping' || status === 'saving'}
        >
          Past meetings
        </button>
      </div>

      {activePanel === 'new' ? (
        <>
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
        </>
      ) : null}

      {activePanel === 'past' ? (
      <div className="meetings-transcript meetings-transcript-past">
        {pastMeetingsError ? <div className="error-banner">{pastMeetingsError}</div> : null}
        {!isPastMeetingsLoading && pastMeetings.length === 0 ? (
          <div className="project-files-empty">
            <p>No saved meetings found.</p>
            <p>Meetings are loaded from your configured notes folder.</p>
          </div>
        ) : null}
        {pastMeetings.length > 0 ? (
          <div className="meetings-history-layout">
            <div className="meetings-history-list">
              {pastMeetings.map((meeting) => (
                <div
                  key={meeting.notes_path}
                  className={`meetings-history-item ${selectedPastMeetingPath === meeting.notes_path ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="meetings-history-item-main"
                    onClick={() => setSelectedPastMeetingPath(meeting.notes_path)}
                  >
                    <strong>{meeting.title || 'Meeting'}</strong>
                    <span>{meeting.started_at || meeting.updated_at || 'Unknown time'}</span>
                  </button>
                  <button
                    type="button"
                    className="meetings-history-delete-btn"
                    onClick={() => void handleDeleteMeeting(meeting)}
                    title="Delete meeting note and audio"
                    aria-label={`Delete ${meeting.title || 'meeting'}`}
                    disabled={deletingMeetingPath === meeting.notes_path}
                  >
                    {deletingMeetingPath === meeting.notes_path ? '…' : '🗑'}
                  </button>
                </div>
              ))}
            </div>
            <div className="meetings-history-detail">
              {selectedPastMeeting ? (
                <>
                  <div className="meetings-history-top">
                    <div className="meetings-history-meta">
                      <h3>{selectedPastMeeting.title || 'Meeting'}</h3>
                      <div className="meetings-history-meta-time">
                        <span>{formatMeetingDateTime(selectedPastMeeting.started_at || selectedPastMeeting.updated_at)}</span>
                        {selectedPastMeeting.ended_at ? <span>{formatMeetingDateTime(selectedPastMeeting.ended_at)}</span> : null}
                      </div>
                      <Link
                        className="meetings-history-note-link"
                        to={buildOpenInMyMindUrl(selectedPastMeeting.notes_path, projectID)}
                      >
                        {fileNameFromPath(selectedPastMeeting.notes_path)}
                      </Link>
                      {selectedPastMeeting.audio_paths.length > 0 ? (
                        <div className="meetings-history-file-links">
                          {selectedPastMeeting.audio_paths.map((audioPath) => (
                            <a
                              key={audioPath}
                              className="meetings-history-note-link"
                              href={getMeetingAudioAssetUrl(audioPath)}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              {fileNameFromPath(audioPath)}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="meetings-history-audio">
                      <h4>Audio</h4>
                      {selectedPastMeeting.audio_paths.length === 0 ? (
                        <p>No audio files linked to this meeting.</p>
                      ) : (
                        selectedPastMeeting.audio_paths.map((audioPath) => (
                          <div key={audioPath} className="meetings-history-audio-item">
                            <audio
                              ref={(element) => bindPastAudioRef(audioPath, element)}
                              controls
                              preload="metadata"
                              src={getMeetingAudioAssetUrl(audioPath)}
                              onSeeked={() => handlePastAudioSeeked(audioPath)}
                              onPlay={() => handlePastAudioPlay(audioPath)}
                              onPause={() => handlePastAudioPause(audioPath)}
                              onTimeUpdate={() => handlePastAudioTimeUpdate(audioPath)}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="meetings-history-transcript">
                    <h4>Transcript</h4>
                    {parsedPastTranscript.length > 0 ? (
                      <div className="meetings-history-transcript-list">
                        {parsedPastTranscript.map((entry) => (
                          <div
                            key={entry.id}
                            ref={(element) => {
                              if (!element) {
                                pastTranscriptEntryRefs.current.delete(entry.id);
                                return;
                              }
                              pastTranscriptEntryRefs.current.set(entry.id, element);
                            }}
                            className={`meetings-transcript-entry meetings-transcript-entry-past speaker-${speakerTone(entry.speaker, meSpeakerLabel, themSpeakerLabel)} ${activePastTranscriptEntryID === entry.id ? 'active' : ''}`}
                          >
                            <div className="meetings-transcript-meta">
                              <button
                                type="button"
                                className="meetings-transcript-time-btn"
                                onClick={() => seekAllPastAudios(entry.offsetSeconds)}
                              >
                                {formatDuration(entry.offsetSeconds)}
                              </button>
                              <span className="meetings-transcript-speaker">{entry.speaker}</span>
                            </div>
                            <span className="meetings-transcript-text">{entry.text}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>No transcript in this note.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="project-files-empty">
                  <p>Select a meeting from the list.</p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

export default MeetingsView;
