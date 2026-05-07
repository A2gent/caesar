export const VOICE_LANG_STORAGE_KEY = 'a2gent.voiceInputLanguage';
export const VOICE_INPUT_DEVICE_STORAGE_KEY = 'a2gent.voiceInputDeviceId';

export const VOICE_LANGUAGE_OPTIONS = [
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

export function normalizeLanguageForBackend(language: string): string {
  const value = (language || '').trim().toLowerCase();
  if (!value) {
    return '';
  }
  const parts = value.split('-');
  return parts[0] || '';
}

export function readVoiceInputLanguageSetting(): string {
  try {
    return localStorage.getItem(VOICE_LANG_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeVoiceInputLanguageSetting(value: string): void {
  try {
    localStorage.setItem(VOICE_LANG_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures.
  }
}

export function readVoiceInputDeviceSetting(): string {
  try {
    return localStorage.getItem(VOICE_INPUT_DEVICE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeVoiceInputDeviceSetting(value: string): void {
  try {
    localStorage.setItem(VOICE_INPUT_DEVICE_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures.
  }
}
