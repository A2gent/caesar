export const ELEVENLABS_VOICE_ID = 'ELEVENLABS_VOICE_ID';
export const ELEVENLABS_SPEED = 'ELEVENLABS_SPEED';
export const PIPER_MODEL = 'PIPER_MODEL';
export const WHISPER_LANGUAGE = 'AAGENT_WHISPER_LANGUAGE';
export const WHISPER_TRANSLATE = 'AAGENT_WHISPER_TRANSLATE';
export const SCREENSHOT_OUTPUT_DIR = 'AAGENT_SCREENSHOT_OUTPUT_DIR';
export const SCREENSHOT_DISPLAY_INDEX = 'AAGENT_SCREENSHOT_DISPLAY_INDEX';
export const CAMERA_OUTPUT_DIR = 'AAGENT_CAMERA_OUTPUT_DIR';
export const CAMERA_INDEX = 'AAGENT_CAMERA_INDEX';
export const SKILLS_FOLDER_KEY = 'AAGENT_SKILLS_FOLDER';
export const CHROME_HEADLESS = 'CHROME_HEADLESS';
export const GIT_COMMIT_PROVIDER = 'AAGENT_GIT_COMMIT_PROVIDER';
export const GIT_COMMIT_PROMPT_TEMPLATE = 'AAGENT_GIT_COMMIT_PROMPT_TEMPLATE';
export function speedToOptionIndex(speed: string): number {
  const ELEVENLABS_SPEED_OPTIONS = ['0.5', '0.8', '1.0', '1.5', '2.0'] as const;
  const parsed = Number.parseFloat(speed);
  if (!Number.isFinite(parsed)) {
    return ELEVENLABS_SPEED_OPTIONS.indexOf('1.0');
  }

  let closestIndex = 0;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ELEVENLABS_SPEED_OPTIONS.length; i += 1) {
    const optionValue = Number.parseFloat(ELEVENLABS_SPEED_OPTIONS[i]);
    const distance = Math.abs(optionValue - parsed);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }
  return closestIndex;
}

export const ELEVENLABS_SPEED_OPTIONS = ['0.5', '0.8', '1.0', '1.5', '2.0'] as const;

export const SKILLS_MANAGED_SETTING_KEYS = [
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_SPEED,
  PIPER_MODEL,
  WHISPER_LANGUAGE,
  WHISPER_TRANSLATE,
  SCREENSHOT_OUTPUT_DIR,
  SCREENSHOT_DISPLAY_INDEX,
  CAMERA_OUTPUT_DIR,
  CAMERA_INDEX,
  SKILLS_FOLDER_KEY,
  CHROME_HEADLESS,
  GIT_COMMIT_PROVIDER,
  GIT_COMMIT_PROMPT_TEMPLATE,
] as const;
