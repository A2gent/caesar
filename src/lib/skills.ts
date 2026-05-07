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
export const EXTERNAL_MARKDOWN_DISABLED_SKILLS_KEY = 'A2GENT_EXTERNAL_MARKDOWN_DISABLED_SKILLS';
export const DISABLED_TOOLS_KEY = 'A2GENT_DISABLED_TOOLS';
export const DISABLED_TOOLS_BOOTSTRAP_APPLIED_KEY = 'A2GENT_DISABLE_TOOLS_BY_DEFAULT_APPLIED';
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
  EXTERNAL_MARKDOWN_DISABLED_SKILLS_KEY,
  DISABLED_TOOLS_KEY,
  DISABLED_TOOLS_BOOTSTRAP_APPLIED_KEY,
  CHROME_HEADLESS,
  GIT_COMMIT_PROVIDER,
  GIT_COMMIT_PROMPT_TEMPLATE,
] as const;

export function parseDisabledExternalMarkdownSkills(raw: string): Set<string> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return new Set();
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value !== ''),
      );
    }
  } catch {
    // Fall through to legacy-delimited parsing.
  }

  return new Set(
    trimmed
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter((value) => value !== ''),
  );
}

export function serializeDisabledExternalMarkdownSkills(paths: Iterable<string>): string {
  const normalized = Array.from(paths)
    .map((path) => path.trim())
    .filter((path) => path !== '')
    .sort((a, b) => a.localeCompare(b));
  if (normalized.length === 0) {
    return '';
  }
  return JSON.stringify(normalized);
}

export function parseDisabledTools(raw: string): Set<string> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return new Set();
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value !== ''),
      );
    }
  } catch {
    // Fall through to legacy-delimited parsing.
  }

  return new Set(
    trimmed
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter((value) => value !== ''),
  );
}

export function serializeDisabledTools(names: Iterable<string>): string {
  const normalized = Array.from(names)
    .map((name) => name.trim())
    .filter((name) => name !== '')
    .sort((a, b) => a.localeCompare(b));
  if (normalized.length === 0) {
    return '';
  }
  return JSON.stringify(normalized);
}
