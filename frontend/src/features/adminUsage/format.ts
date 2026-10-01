/** "5m 20s" / "1h 2m" / "45s" — whole-second durations for the TTFD figures. `null` is a gap. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** `null` renders as an em dash (a gap), never 0. */
export function formatCount(value: number | null): string {
  return value === null ? "—" : String(value);
}

export function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

/** "2026-04-13" -> "Apr 13" for compact chart axes; the full ISO date stays in the data table. */
export function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
