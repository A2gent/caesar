export const ELEVENLABS_VOICE_ID = 'ELEVENLABS_VOICE_ID';
export const ELEVENLABS_SPEED = 'ELEVENLABS_SPEED';
export const SKILLS_FOLDER_KEY = 'AAGENT_SKILLS_FOLDER';

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
  SKILLS_FOLDER_KEY,
] as const;
