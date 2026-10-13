/**
 * Rendering of a dashboard layout conflict (HEL-1524, design D4/D6), zod-free so handlers and
 * tests can import it without `registerTool`'s surface.
 *
 * A 409 from `PATCH /api/dashboards/:id` or `POST /api/dashboards/:id/auto-layout` means the
 * layout moved since the agent read it. The tool never re-sends: it returns the server's
 * current dashboard so the agent recomputes against it and calls again with the new version.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HelioLayoutConflictError } from "../httpClient.js";

/** `place_outputs` created its panels, then the follow-up pack hit a layout conflict. */
export class PlaceOutputsPackConflictError extends Error {
  constructor(
    readonly conflict: HelioLayoutConflictError,
    readonly createdPanelIds: string[],
  ) {
    super(conflict.message);
    this.name = "PlaceOutputsPackConflictError";
  }
}

/** The `isError` result for a layout conflict, or `undefined` when `err` is not one. */
export function layoutConflictResult(err: unknown): CallToolResult | undefined {
  const packed = err instanceof PlaceOutputsPackConflictError ? err : undefined;
  const conflict = packed
    ? packed.conflict
    : err instanceof HelioLayoutConflictError
      ? err
      : undefined;
  if (!conflict) return undefined;
  const payload = {
    error: "layout_conflict",
    message:
      `The dashboard's layout changed since you read it (409 from ${conflict.url}); nothing was ` +
      `saved by this layout write. ${conflict.message}`,
    expectedLayoutVersion: conflict.expectedLayoutVersion,
    currentLayoutVersion: conflict.current.layoutVersion,
    ...(packed
      ? {
          createdPanelIds: packed.createdPanelIds,
          createdButNotPositioned:
            "These panels were created but NOT positioned; they sit at their default position until you lay them out.",
        }
      : {}),
    dashboard: conflict.current,
    nextStep:
      "Recompute your layout against `dashboard.layout` and call again with " +
      "`expectedLayoutVersion` set to `dashboard.layoutVersion`. The write was not retried.",
  };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: true };
}
