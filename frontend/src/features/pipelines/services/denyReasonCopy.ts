// HEL-1096 design.md D6 — the deny-reason copy mapping: one hand-maintained sentence per
// `CostReason.code` `PipelineCostEstimator` can produce, naming the SPECIFIC denying rule (the
// AC's requirement — never a single generic "couldn't update" message). Mirrors
// `PipelineCostEstimator`'s own "hand-maintained set + coverage invariant" pattern
// (`backend/.../PipelineCostEstimator.scala`'s own doc comment on `CheapOps`).
//
// Four codes get honest, NON-ALARMING copy (design.md D6): `unclassified-op`,
// `unclassified-source`, `row-estimate-unavailable`, `no-roots`. Nothing is actually known
// about RISK for these — the estimator couldn't classify them at all — so their copy names what
// wasn't recognized/available, never why it might be dangerous.

import type { CostReason } from "../types/pipelineStep";

/** Every `CostReason.code` the backend's `PipelineCostEstimator` can produce (mirrors the
 *  `schemas/sources/denied-pipeline-response.schema.json` / `schemas/pipelines/pipeline-
 *  analyze-response.schema.json` `CostReason.code` enum verbatim). The single source of truth
 *  `denyReasonCoverage.test.ts` iterates to prove every one of these has a mapping entry. */
export const ALL_COST_REASON_CODES = [
  "ai-step",
  "writeback-step",
  "content-conversion",
  "remote-fetch",
  "unclassified-op",
  "unclassified-source",
  "no-roots",
  "row-estimate-unavailable",
  "rows-above-threshold",
  "steps-above-bound",
] as const;

export type CostReasonCode = (typeof ALL_COST_REASON_CODES)[number];

/** The generic fallback `denyReasonCopy` returns for a code this map doesn't cover — the AC
 *  forbids this as the message for a KNOWN code; it exists only so an unforeseen future backend
 *  code (shipped before this map is updated) degrades to something honest rather than throwing.
 *  Exported so `denyReasonCoverage.test.ts` can assert no covered code ever produces it. */
export const GENERIC_FALLBACK_MESSAGE = "This pipeline wasn't updated automatically.";

// Deliberately NOT typed as `Record<CostReasonCode, string>` (design.md D6, ticket AC "Show the
// red"): a `Record` keyed by the full literal union would make a missing entry a TypeScript
// COMPILE error — a strictly stronger guarantee, but the WRONG one for this ticket's binding
// requirement, which is a real, deletable-and-rerunnable RUNTIME gate
// (`denyReasonCoverage.test.ts`), not one the type checker could quietly absorb if a future edit
// loosened this type. Kept as a plain `Record<string, string>` so that test is the thing that
// actually fails when an entry is removed.
const DENY_REASON_COPY: Record<string, string> = {
  "ai-step": "This pipeline calls AI, so it wasn't updated automatically.",
  "writeback-step":
    "This pipeline writes back to a data source, so it wasn't updated automatically.",
  "content-conversion": "This pipeline converts file content, so it wasn't updated automatically.",
  "remote-fetch": "This pipeline reads from a remote source, so it wasn't updated automatically.",
  "rows-above-threshold": "This pipeline processes too many rows to update automatically.",
  "steps-above-bound": "This pipeline has too many steps to update automatically.",
  // Honest, non-alarming copy (design.md D6) — nothing is known about risk for these four; they
  // name what wasn't recognized/available, not why it might be unsafe.
  "unclassified-op":
    "This pipeline uses a step type we don't yet recognize, so it wasn't updated automatically.",
  "unclassified-source":
    "This pipeline reads from a source type we don't yet recognize, so it wasn't updated automatically.",
  "row-estimate-unavailable":
    "We couldn't estimate this pipeline's row count, so it wasn't updated automatically.",
  "no-roots": "This pipeline has no data source connected, so it wasn't updated automatically.",
};

/** Renders one `CostReason` into its specific-rule sentence. */
export function denyReasonCopy(reason: CostReason): string {
  return DENY_REASON_COPY[reason.code] ?? GENERIC_FALLBACK_MESSAGE;
}
