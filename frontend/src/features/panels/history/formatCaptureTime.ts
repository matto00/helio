/** HEL-1277 — one localized rendering of a history point's capture time ("5 Oct, 14:02"), shared by
 *  the History view's captions and a custom-compare overlay label. */
export function formatCaptureTime(iso: string, withSeconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  });
}

/** True when two capture times fall in the same minute, so minute-precision labels would read
 *  identically; callers then ask `formatCaptureTime` for seconds. */
export function sameMinute(a: string, b: string): boolean {
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  return !Number.isNaN(x) && !Number.isNaN(y) && Math.floor(x / 60000) === Math.floor(y / 60000);
}
