/** A schedule's next run for a compact list row, in the viewer's locale and zone. `null`/absent means the scheduler
 *  has not computed one yet (spray-json omits `None`, so both shapes occur). */
export function formatNextRun(nextRunAt: string | null | undefined): string | null {
  if (nextRunAt == null) return null;
  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
