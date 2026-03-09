export const TOGGLE_VOICE_INPUT_EVENT = 'a2gent:toggle-voice-input';

export function emitToggleVoiceInputEvent(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(TOGGLE_VOICE_INPUT_EVENT));
}
