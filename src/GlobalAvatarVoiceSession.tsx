import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  createSession,
  getSession,
  listProviders,
  transcribeSpeech,
  type LLMProviderType,
} from './api';
import { useAvatarAudio } from './avatarAudio';
import {
  normalizeLanguageForBackend,
  readVoiceInputDeviceSetting,
  readVoiceInputLanguageSetting,
} from './voiceInputSettings';
import { START_AVATAR_VOICE_SESSION_EVENT } from './voiceInputEvents';
import { SYSTEM_PROJECT_KB_ID } from './Sidebar';

import {
  SELECTED_WORKFLOW_STORAGE_KEY_PREFIX,
  listWorkflows,
  DEFAULT_WORKFLOW_ID,
  resolveWorkflowLaunchTarget,
  buildWorkflowSessionMetadata,
} from './workflows';
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

function activeChatSessionIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)$/);
  if (!match?.[1]) {
    return null;
  }
  return decodeURIComponent(match[1]);
}

function GlobalAvatarVoiceSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setListening, clearListening } = useAvatarAudio();

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);

  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(16000);

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

  const resolveSessionProjectId = useCallback(async (): Promise<string> => {
    const projectMatch = location.pathname.match(/^\/projects\/([^/]+)/);
    if (projectMatch?.[1]) {
      return decodeURIComponent(projectMatch[1]);
    }

    const chatMatch = location.pathname.match(/^\/chat\/([^/]+)/);
    if (chatMatch?.[1]) {
      try {
        const session = await getSession(decodeURIComponent(chatMatch[1]));
        const projectId = (session.project_id || '').trim();
        if (projectId !== '') {
          return projectId;
        }
      } catch (error) {
        console.error('Failed to resolve project from active chat session:', error);
      }
    }

    return SYSTEM_PROJECT_KB_ID;
  }, [location.pathname]);

  const resolveActiveProvider = useCallback(async (): Promise<LLMProviderType | undefined> => {
    try {
      const providers = await listProviders();
      const active = providers.find((provider) => provider.is_active);
      return (active || providers[0])?.type;
    } catch (error) {
      console.error('Failed to resolve active provider for avatar voice session:', error);
      return undefined;
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording || isTranscribing) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Microphone input is not supported in this browser.');
      return;
    }

    pcmChunksRef.current = [];

    try {
      const selectedInputId = readVoiceInputDeviceSetting();
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
    } catch (error: any) {
      console.error('Failed to start avatar voice session recording:', error);
      if (error?.name === 'NotAllowedError') {
        alert('Microphone access was denied. Please allow microphone access to use voice input.');
      }
      await teardownRecordingGraph();
      setIsRecording(false);
    }
  }, [isRecording, isTranscribing, setListening, teardownRecordingGraph]);

  const stopRecordingAndCreateSession = useCallback(async () => {
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
      const result = await transcribeSpeech(wavBlob, normalizeLanguageForBackend(readVoiceInputLanguageSetting()));
      const prompt = (result.text || '').trim();
      if (prompt === '') {
        setIsTranscribing(false);
        return;
      }

      const activeChatSessionId = activeChatSessionIdFromPath(location.pathname);
      if (activeChatSessionId) {
        navigate(`/chat/${activeChatSessionId}`, {
          state: {
            initialMessage: prompt,
          },
        });
        return;
      }

      const [projectId, provider] = await Promise.all([
        resolveSessionProjectId(),
        resolveActiveProvider(),
      ]);

      const storedWorkflowId = projectId ? localStorage.getItem(SELECTED_WORKFLOW_STORAGE_KEY_PREFIX + projectId) || DEFAULT_WORKFLOW_ID : DEFAULT_WORKFLOW_ID;
      const availableWorkflows = await listWorkflows();
      const workflow = availableWorkflows.find((w) => w.id === storedWorkflowId) || availableWorkflows.find((w) => w.id === DEFAULT_WORKFLOW_ID);

      let targetProvider = provider;
      let targetSubAgentId: string | undefined = undefined;
      let targetMetadata: Record<string, unknown> | undefined = undefined;

      if (workflow) {
        const target = resolveWorkflowLaunchTarget(workflow);
        if (target.kind === 'subagent') {
          targetSubAgentId = target.subAgentId;
          targetProvider = undefined; // Sub-agents handle their own provider setup
        } else if (target.kind === 'main' || target.kind === 'none') {
          targetProvider = provider;
        } else {
          throw new Error(`Voice sessions do not support ${target.kind} workflow targets yet.`);
        }
        targetMetadata = buildWorkflowSessionMetadata(workflow);
      }

      const created = await createSession({
        agent_id: 'build',
        provider: targetProvider,
        sub_agent_id: targetSubAgentId,
        project_id: projectId,
        metadata: targetMetadata,
      });

      navigate(`/chat/${created.id}`, {
        state: {
          initialMessage: prompt,
        },
      });
    } catch (error) {
      console.error('Failed to create avatar voice session:', error);
      alert(error instanceof Error ? error.message : 'Failed to create session from avatar voice input.');
    } finally {
      setIsTranscribing(false);
    }
  }, [
    isRecording,
    isTranscribing,
    navigate,
    resolveActiveProvider,
    resolveSessionProjectId,
    teardownRecordingGraph,
  ]);

  const toggleAvatarVoiceSession = useCallback(() => {
    if (isTranscribing) {
      return;
    }
    if (isRecording) {
      void stopRecordingAndCreateSession();
      return;
    }
    void startRecording();
  }, [isRecording, isTranscribing, startRecording, stopRecordingAndCreateSession]);

  useEffect(() => {
    const handler = () => {
      toggleAvatarVoiceSession();
    };

    window.addEventListener(START_AVATAR_VOICE_SESSION_EVENT, handler);
    return () => {
      window.removeEventListener(START_AVATAR_VOICE_SESSION_EVENT, handler);
    };
  }, [toggleAvatarVoiceSession]);

  useEffect(() => {
    return () => {
      void teardownRecordingGraph();
    };
  }, [teardownRecordingGraph]);

  return null;
}

export default GlobalAvatarVoiceSession;
