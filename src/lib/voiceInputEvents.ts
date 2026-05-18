export const TOGGLE_VOICE_INPUT_EVENT = 'a2gent:toggle-voice-input';
export const START_AVATAR_VOICE_SESSION_EVENT = 'a2gent:start-avatar-voice-session';
export const START_MEETING_RECORDING_EVENT = 'a2gent:start-meeting-recording';
export const START_MEETING_RECORDING_REQUEST_KEY = 'a2gent:start-meeting-recording-request';

export function emitToggleVoiceInputEvent(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(TOGGLE_VOICE_INPUT_EVENT));
}

export function emitStartAvatarVoiceSessionEvent(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(START_AVATAR_VOICE_SESSION_EVENT));
}

export function emitStartMeetingRecordingEvent(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(START_MEETING_RECORDING_EVENT));
}
