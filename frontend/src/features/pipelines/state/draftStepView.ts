// draftStepView -- HEL-1631 (design.md D3): the displayed status of each step while a draft exists. A pure mapping from the
// evaluator's node, the server transport's state and the step's last good frame to
// `ok | error | pending | stale | notPreviewed`, plus the frame, count and message to show with it.

import type { Frame, NodeResult, WalkResult } from "../evaluator";
import type { DraftPreviewUnavailableReason } from "../types/draftPreview";
import { rootCauseOf } from "./draftEvaluation";

export type DraftDisplayStatus = "ok" | "error" | "pending" | "stale" | "notPreviewed";

/** The copy for a step that is never previewed before Save & run (owner ruling F). */
export const NOT_PREVIEWED_AI = "not previewed (AI step): runs on Save & run";

export interface DraftStepView {
  status: DraftDisplayStatus;
  /** The count to show: current when `frameStale` is false, the last good one otherwise; `null` when never known. */
  count: number | null;
  /** The rows to show for this step (a client frame, or the server's `rows` line for the focused step). */
  rows: Frame | null;
  /** The count/rows are the last good ones, not the current draft's. */
  frameStale: boolean;
  message: string | null;
}

export type ServerStepResult =
  | { kind: "ok"; count: number }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; reason: DraftPreviewUnavailableReason };

/** What the HEL-1630 transport has answered for the CURRENT request, and whether that request has ended. */
export interface TransportView {
  /** A request for the current draft is queued, in flight or waiting out a 429. */
  pending: boolean;
  results: ReadonlyMap<string, ServerStepResult>;
  /** The `rows` line, decoded, for the step the request asked rows of. */
  rows: { stepId: string; rows: Frame } | null;
  /** The request ended without an answer for the step: a failure, or the request was over a cap. */
  failure: { kind: "failed" | "tooLarge"; message: string } | null;
}

export const NO_TRANSPORT: TransportView = {
  pending: false,
  results: new Map(),
  rows: null,
  failure: null,
};

export interface GoodFrame {
  count: number;
  rows: Frame | null;
}

const UNAVAILABLE_COPY: Record<DraftPreviewUnavailableReason, string> = {
  aiStep: NOT_PREVIEWED_AI,
  downstreamOfAiStep: NOT_PREVIEWED_AI,
  sourceNotSupplied:
    "not previewed: a source this step reads is not cached here; runs on Save & run",
  laneNotSupplied: "not previewed: a lane this step reads has no preview; runs on Save & run",
  downstreamOfUnavailable: "not previewed: an earlier step has no preview; runs on Save & run",
  downstreamOfError: "an earlier step has an error",
};

const NO_SAMPLE = /^root '.*' has no frame$/;

export interface ViewInput {
  stepId: string;
  node: NodeResult | undefined;
  walk: WalkResult;
  transport: TransportView;
  lastGood: GoodFrame | undefined;
  /** Root sample state, for a step whose root has no frame yet. */
  sampleLoading: boolean;
}

const stale = (good: GoodFrame | undefined) => ({
  count: good?.count ?? null,
  rows: good?.rows ?? null,
  frameStale: good !== undefined,
});

export function mapStepView(input: ViewInput): DraftStepView {
  const { stepId, node, walk, transport, lastGood, sampleLoading } = input;
  if (node === undefined) {
    return { status: "ok", count: null, rows: null, frameStale: false, message: null };
  }
  switch (node.status) {
    case "ok":
    case "disabled":
      return { status: "ok", count: node.count, rows: node.rows, frameStale: false, message: null };
    case "notPreviewed":
      return { status: "notPreviewed", ...stale(undefined), message: NOT_PREVIEWED_AI };
    case "error":
      if (NO_SAMPLE.test(node.message)) {
        return sampleLoading
          ? { status: "pending", ...stale(lastGood), message: "Loading a sample of the source…" }
          : {
              status: "error",
              ...stale(lastGood),
              message: "No sample of this source is cached, so it cannot be previewed here.",
            };
      }
      return { status: "error", ...stale(lastGood), message: node.message };
    case "blocked":
    case "needsServer": {
      const cause = rootCauseOf(walk.nodes, stepId);
      if (cause.node?.status === "error") {
        return { status: "stale", ...stale(lastGood), message: "an earlier step has an error" };
      }
      if (cause.node?.status === "notPreviewed") {
        return { status: "notPreviewed", ...stale(undefined), message: NOT_PREVIEWED_AI };
      }
      return mapServerResolved(stepId, transport, lastGood);
    }
  }
}

function mapServerResolved(
  stepId: string,
  transport: TransportView,
  lastGood: GoodFrame | undefined,
): DraftStepView {
  const result = transport.results.get(stepId);
  if (result?.kind === "ok") {
    const rows = transport.rows?.stepId === stepId ? transport.rows.rows : null;
    return {
      status: "ok",
      count: result.count,
      rows: rows ?? lastGood?.rows ?? null,
      frameStale: rows === null && lastGood?.rows != null,
      message: null,
    };
  }
  if (result?.kind === "error") {
    return { status: "error", ...stale(lastGood), message: result.message };
  }
  if (result?.kind === "unavailable") {
    const message = UNAVAILABLE_COPY[result.reason];
    return result.reason === "downstreamOfError"
      ? { status: "stale", ...stale(lastGood), message }
      : { status: "notPreviewed", ...stale(undefined), message };
  }
  if (transport.failure !== null) {
    return { status: "error", ...stale(lastGood), message: transport.failure.message };
  }
  return {
    status: "pending",
    ...stale(lastGood),
    message: "Updating on the server…",
  };
}

const hasFrame = (n: NodeResult | undefined): n is Extract<NodeResult, { rows: Frame }> =>
  n !== undefined && (n.status === "ok" || n.status === "disabled");

export interface ViewTracker {
  /** Forget every remembered frame (the draft ended). */
  reset: () => void;
  /** The view of every step of `walk`. Remembers each step's latest good frame, seeded from `baseWalk` for a step the
   *  draft has not computed yet, so a step downstream of a new error keeps the frame it had. Idempotent for the same
   *  inputs, so it is safe to call from a memo. */
  derive: (
    walk: WalkResult,
    baseWalk: WalkResult | null,
    transport: TransportView,
    sampleLoading: boolean,
  ) => Map<string, DraftStepView>;
}

export function createViewTracker(): ViewTracker {
  const good = new Map<string, GoodFrame>();
  return {
    reset: () => good.clear(),
    derive(walk, baseWalk, transport, sampleLoading) {
      if (baseWalk !== null) {
        for (const [id, node] of baseWalk.nodes) {
          if (!good.has(id) && hasFrame(node)) good.set(id, { count: node.count, rows: node.rows });
        }
      }
      const views = new Map<string, DraftStepView>();
      for (const id of walk.order) {
        const view = mapStepView({
          stepId: id,
          node: walk.nodes.get(id),
          walk,
          transport,
          lastGood: good.get(id),
          sampleLoading,
        });
        views.set(id, view);
        if (view.status === "ok" && view.count !== null && !view.frameStale) {
          good.set(id, { count: view.count, rows: view.rows ?? good.get(id)?.rows ?? null });
        }
      }
      return views;
    },
  };
}
