import type { HomeSummary } from "../types/homeSummary";

export interface TimelineRange {
  start: number;
  end: number;
}

export function timelineRange(
  summary: Pick<HomeSummary, "windowStart" | "horizonEnd">,
): TimelineRange {
  return { start: Date.parse(summary.windowStart), end: Date.parse(summary.horizonEnd) };
}

/** A time as a 0..100 percentage across the window plus horizon (clamped). */
export function timeToPercent(time: number, range: TimelineRange): number {
  const span = range.end - range.start;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((time - range.start) / span) * 100));
}

export interface HourTick {
  time: number;
  percent: number;
  label: string;
}

const HOUR_MS = 3_600_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:mm", 24-hour, in the viewer's local time. */
export function formatClock(time: number): string {
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Hour labels every `stepHours` (default 6) on local whole hours that are multiples of the step, so labels read
 *  00:00 / 06:00 / 12:00 / 18:00 regardless of when the page was opened. */
export function hourTicks(range: TimelineRange, stepHours: number = 6): HourTick[] {
  const ticks: HourTick[] = [];
  const first = new Date(range.start);
  first.setMinutes(0, 0, 0);
  let cursor = first.getTime();
  while (cursor < range.start || new Date(cursor).getHours() % stepHours !== 0) cursor += HOUR_MS;
  for (; cursor <= range.end; cursor += stepHours * HOUR_MS) {
    ticks.push({ time: cursor, percent: timeToPercent(cursor, range), label: formatClock(cursor) });
  }
  return ticks;
}
