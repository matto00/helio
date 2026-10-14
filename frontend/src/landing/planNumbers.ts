/**
 * The plan numbers the landing copy quotes. Each is inserted into `index.html` at build time
 * (see `planNumbersPlugin.ts`) and pinned to its backend default by `planNumbers.sourceScan.test.ts`,
 * so a backend change fails a test instead of leaving the page quoting a stale number.
 */
export const BETA_DAILY_MESSAGE_LIMIT = 50;

export const PLAN_NUMBER_PLACEHOLDERS: Record<string, number> = {
  "%BETA_DAILY_MESSAGE_LIMIT%": BETA_DAILY_MESSAGE_LIMIT,
};
