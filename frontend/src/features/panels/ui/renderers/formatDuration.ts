// HEL-1308 -- the ONE duration formatter behind the metric, collection, history-delta and table-column
// `duration` formats (a second copy in either formatter would drift). Pure; callers convert ms -> s first.

const UNITS = [
  { label: "d", seconds: 86400 },
  { label: "h", seconds: 3600 },
  { label: "m", seconds: 60 },
  { label: "s", seconds: 1 },
] as const;

/** Half-up on a non-negative magnitude; never `Math.round`, which rounds a negative half toward zero. */
function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

function digits(n: number): string {
  return new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 0 }).format(n);
}

/** Index of the largest unit that fits `seconds` (>= 1). */
function largestUnit(seconds: number): number {
  const index = UNITS.findIndex((u) => seconds >= u.seconds);
  return index === -1 ? UNITS.length - 1 : index;
}

/** Compact text for a number of seconds: at most two units from the largest non-zero one (`5m 30s`, `1h`,
 *  `1d 1h`), `ms` below one second, `0s` for zero, a leading `-` for a negative value. The value is rounded
 *  ONCE, from the original magnitude, to the smallest unit shown (so 3629.5 s is `1h`, never a double-rounded `1h 1m`). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return String(seconds);
  const sign = seconds < 0 ? "-" : "";
  let magnitude = Math.abs(seconds);

  if (magnitude < 1) {
    const ms = roundHalfUp(magnitude * 1000);
    if (ms === 0) return "0s";
    if (ms < 1000) return `${sign}${ms}ms`;
    magnitude = 1;
  }

  // The first rounding only picks the units to show; the total is rounded from the ORIGINAL magnitude.
  const lead = largestUnit(roundHalfUp(magnitude));
  const minor = UNITS[Math.min(lead + 1, UNITS.length - 1)];
  const total = roundHalfUp(magnitude / minor.seconds) * minor.seconds;

  // `total` is re-decomposed: rounding may carry into a larger unit.
  const top = largestUnit(total);
  const topUnit = UNITS[top];
  const topCount = Math.floor(total / topUnit.seconds);
  let text = `${digits(topCount)}${topUnit.label}`;
  if (top < UNITS.length - 1) {
    const next = UNITS[top + 1];
    const nextCount = Math.floor((total - topCount * topUnit.seconds) / next.seconds);
    if (nextCount > 0) text += ` ${nextCount}${next.label}`;
  }
  return `${sign}${text}`;
}
