// HEL-1744 D7 -- the state derivation table: exactly one state per input row.
import { deriveInsightState, type InsightStateInput } from "./insightState";

const RENDER = { markdown: "x", citations: [], renderedAt: "2026-11-01T00:00:00Z" };
const attempt = (status: string) => ({ status, createdAt: "2026-11-02T00:00:00Z" });

function input(over: Partial<InsightStateInput>): InsightStateInput {
  return {
    render: RENDER,
    lastAttempt: attempt("ok"),
    isPipelineOwner: false,
    tier: "beta",
    variant: "authenticated",
    refreshPending: false,
    ...over,
  };
}

describe("deriveInsightState", () => {
  it.each([
    ["render + ok attempt", input({}), { kind: "rendered", note: "none" }],
    [
      "no render, no attempt",
      input({ render: null, lastAttempt: null }),
      { kind: "notRendered", note: "none" },
    ],
    [
      "render + failed",
      input({ lastAttempt: attempt("failed") }),
      { kind: "rendered", note: "failed" },
    ],
    [
      "no render + failed",
      input({ render: null, lastAttempt: attempt("failed") }),
      { kind: "failed" },
    ],
    [
      "render + unchanged",
      input({ lastAttempt: attempt("skipped_unchanged") }),
      { kind: "rendered", note: "unchanged" },
    ],
    // HEL-1743 D13: the server sends `skipped_quota` only to the owner and editors, so whoever receives it sees the quota note.
    [
      "render + quota, pipeline owner",
      input({ lastAttempt: attempt("skipped_quota"), isPipelineOwner: true }),
      { kind: "rendered", note: "quota" },
    ],
    [
      "render + quota, an editor (not the pipeline owner)",
      input({ lastAttempt: attempt("skipped_quota") }),
      { kind: "rendered", note: "quota" },
    ],
    [
      "render + budget, pipeline owner",
      input({ lastAttempt: attempt("skipped_budget"), isPipelineOwner: true }),
      { kind: "rendered", note: "notUpdated" },
    ],
    [
      "render + not_updated (a viewer's view of a quota or budget skip)",
      input({ lastAttempt: attempt("not_updated") }),
      { kind: "rendered", note: "notUpdated" },
    ],
    [
      "render + unknown status",
      input({ lastAttempt: attempt("skipped_mystery"), isPipelineOwner: true }),
      { kind: "rendered", note: "notUpdated" },
    ],
    [
      "free pipeline owner, no render",
      input({ render: null, lastAttempt: null, isPipelineOwner: true, tier: "free" }),
      { kind: "upsell" },
    ],
    [
      "free pipeline owner, no render, quota attempt: upsell wins",
      input({
        render: null,
        lastAttempt: attempt("skipped_quota"),
        isPipelineOwner: true,
        tier: "free",
      }),
      { kind: "upsell" },
    ],
    [
      "free pipeline owner WITH a render keeps the render",
      input({ isPipelineOwner: true, tier: "free" }),
      { kind: "rendered", note: "none" },
    ],
    [
      "free non-owner, no render",
      input({ render: null, lastAttempt: null, tier: "free" }),
      { kind: "notRendered", note: "none" },
    ],
    ["refresh pending with a render", input({ refreshPending: true }), { kind: "rendering" }],
    [
      "refresh pending without a render",
      input({ render: null, lastAttempt: null, refreshPending: true }),
      { kind: "rendering" },
    ],
    [
      "public with a render",
      input({ variant: "public", lastAttempt: null }),
      { kind: "rendered", note: "none" },
    ],
    [
      "public with no render",
      input({ variant: "public", render: null, lastAttempt: null }),
      { kind: "notRendered", note: "none" },
    ],
    [
      "public never sees a note even for a free owner",
      input({
        variant: "public",
        render: null,
        lastAttempt: attempt("skipped_quota"),
        isPipelineOwner: true,
        tier: "free",
      }),
      { kind: "notRendered", note: "none" },
    ],
  ])("%s", (_title, given, expected) => {
    expect(deriveInsightState(given)).toEqual(expected);
  });
});
