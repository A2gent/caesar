export const TOGGLE_VOICE_INPUT_EVENT = 'a2gent:toggle-voice-input';
export const START_AVATAR_VOICE_SESSION_EVENT = 'a2gent:start-avatar-voice-session';

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
