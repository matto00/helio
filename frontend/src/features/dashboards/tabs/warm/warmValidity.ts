// HEL-1575 D4: the pure rules that decide whether a tab is warm and whether a stored copy is still valid.

import type { Panel } from "../../../panels/types/panel";
import type { DashboardChange, DashboardTab } from "../tabTypes";
import { parseInstant } from "../tabTypes";
import { WARM_MAX, WARM_TTL_MS } from "./warmConfig";

/** A tab is warm when it is among the `WARM_MAX` open tabs with the latest `lastViewedAt` and the last
 *  view was within the TTL, in SERVER time (`nowServerMs`). A tab never viewed is never warm. */
export function isTabWarm(tabs: DashboardTab[], id: string, nowServerMs: number): boolean {
  const viewed = tabs
    .map((tab) => ({ id: tab.id, at: parseInstant(tab.lastViewedAt) }))
    .filter((t): t is { id: string; at: number } => t.at !== null)
    .sort((a, b) => b.at - a.at);
  const rank = viewed.findIndex((t) => t.id === id);
  if (rank === -1 || rank >= WARM_MAX) return false;
  return nowServerMs - viewed[rank].at <= WARM_TTL_MS;
}

/** The copy's panel list is valid while the dashboard's content has not changed since it was captured,
 *  counting the user's own writes: `contentUpdatedAt <= max(contentCapturedAt, ownWriteAt)`. Without a
 *  change signal the copy cannot be validated, so it is not valid. */
export function isContentValid(
  contentCapturedAt: number,
  ownWriteAt: number | null,
  signal: DashboardChange | undefined,
): boolean {
  const updated = parseInstant(signal?.contentUpdatedAt);
  if (updated === null) return false;
  return updated <= Math.max(contentCapturedAt, ownWriteAt ?? -Infinity);
}

/** A row window survives unless its Output received newer data than the window's capture instant. */
export function isWindowFresh(
  capturedAt: number | undefined,
  outputId: string,
  signal: DashboardChange | undefined,
): boolean {
  if (capturedAt === undefined) return false;
  const data = parseInstant(signal?.outputs.find((o) => o.outputId === outputId)?.dataUpdatedAt);
  return data === null || data <= capturedAt;
}

/** The Output ids a dashboard's panels are bound to (output-kind panels only). */
export function panelOutputIds(panels: Panel[]): string[] {
  const ids = new Set<string>();
  for (const panel of panels) {
    if (panel.type === "output" && panel.config.outputId !== "") ids.add(panel.config.outputId);
  }
  return [...ids];
}
