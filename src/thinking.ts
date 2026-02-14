export const THINKING_JOB_ID_SETTING_KEY = 'A2GENT_THINKING_JOB_ID';
export const THINKING_PROJECT_ID = 'project-thinking';
export const THINKING_SOURCE_SETTING_KEY = 'A2GENT_THINKING_SOURCE';
export const THINKING_SCHEDULE_TEXT_SETTING_KEY = 'A2GENT_THINKING_SCHEDULE_TEXT';
export const THINKING_FREQUENCY_MINUTES_SETTING_KEY = 'A2GENT_THINKING_FREQUENCY_MINUTES';
export const THINKING_FREQUENCY_HOURS_SETTING_KEY = 'A2GENT_THINKING_FREQUENCY_HOURS';
export const THINKING_TEXT_SETTING_KEY = 'A2GENT_THINKING_TEXT';
export const THINKING_FILE_PATH_SETTING_KEY = 'A2GENT_THINKING_FILE_PATH';

export type ThinkingInstructionsSource = 'text' | 'file';

export function toThinkingSchedule(minutes: number): string {
  if (minutes <= 1) {
    return 'every minute';
  }
  return `every ${minutes} minutes`;
}

export function buildThinkingFileTaskPrompt(filePath: string): string {
  const normalizedPath = filePath.trim();
  return [
    'Run the Thinking routine.',
    `Load and follow instructions from this file path: ${normalizedPath}`,
    'Use the file as your source of truth for the work to perform in this run.',
  ].join('\n');
}
