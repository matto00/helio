// HEL-1744 D7 -- the one state an insight panel shows, derived from what the reads returned and who is looking.

import type { UserTier } from "../../auth/types/user";
import type { InsightAttempt, InsightRender } from "./insightService";

export interface InsightStateInput {
  render: InsightRender | null;
  lastAttempt: InsightAttempt | null;
  /** The signed-in user owns the insight's PIPELINE (never "created the Output"). */
  isPipelineOwner: boolean;
  tier: UserTier | undefined;
  variant: "authenticated" | "public";
  /** A refresh the user started is pending. Nothing sets it until HEL-1743 (L4) adds a refresh that calls the server. */
  refreshPending: boolean;
}

export type InsightNote = "none" | "failed" | "unchanged" | "quota" | "notUpdated";

export type InsightState =
  | { kind: "rendering" }
  | { kind: "upsell" }
  | { kind: "failed" }
  | { kind: "notRendered"; note: "none" }
  | { kind: "rendered"; note: InsightNote };

/** Exactly one state. A public viewer sees only the render or not-yet-rendered, never a note. The status switch is closed:
 *  an unknown status degrades to the neutral "not updated" note, never to quota wording. */
export function deriveInsightState(i: InsightStateInput): InsightState {
  if (i.variant === "public") {
    return i.render ? { kind: "rendered", note: "none" } : { kind: "notRendered", note: "none" };
  }
  if (i.refreshPending) return { kind: "rendering" };
  if (!i.render) {
    // The upsell wins over any attempt: a free-tier owner cannot have a render charged, so quota wording would mislead.
    if (i.isPipelineOwner && i.tier === "free") return { kind: "upsell" };
    if (i.lastAttempt?.status === "failed") return { kind: "failed" };
    return { kind: "notRendered", note: "none" };
  }
  switch (i.lastAttempt?.status) {
    case undefined:
    case "ok":
      return { kind: "rendered", note: "none" };
    case "failed":
      return { kind: "rendered", note: "failed" };
    case "skipped_unchanged":
      return { kind: "rendered", note: "unchanged" };
    case "skipped_quota":
    case "skipped_budget":
      return { kind: "rendered", note: i.isPipelineOwner ? "quota" : "notUpdated" };
    default:
      return { kind: "rendered", note: "notUpdated" };
  }
}
