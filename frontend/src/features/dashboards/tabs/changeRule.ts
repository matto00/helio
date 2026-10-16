import { parseInstant } from "./tabTypes";

/** HEL-1575 D7's pure dot comparison, shared with the Home shelf (HEL-1578 D5): one rule, never re-implemented.
 *
 *  A dashboard has changed when its content changed after the later of the user's last view and their own last
 *  write (`contentUpdatedAt > max(lastViewedAt, ownWriteAt)`), OR a pipeline run produced new data after the last
 *  view (`dataUpdatedAt > lastViewedAt`). Own writes never mask new data. Never viewed (null `lastViewedAt`) or
 *  no signal at all is never a change. Times are server-time ISO strings or epoch milliseconds. */
export function hasChangedSince(
  signal: { contentUpdatedAt: string | null; dataUpdatedAt: string | null } | undefined,
  lastViewedAt: string | number | null,
  ownWriteAt: string | number | null,
): boolean {
  if (signal === undefined) return false;
  const viewed = toMs(lastViewedAt);
  if (viewed === null) return false;
  const own = toMs(ownWriteAt);
  const content = parseInstant(signal.contentUpdatedAt);
  const data = parseInstant(signal.dataUpdatedAt);
  const contentChanged = content !== null && content > Math.max(viewed, own ?? -Infinity);
  const dataChanged = data !== null && data > viewed;
  return contentChanged || dataChanged;
}

function toMs(value: string | number | null): number | null {
  return typeof value === "number" ? value : parseInstant(value);
}
