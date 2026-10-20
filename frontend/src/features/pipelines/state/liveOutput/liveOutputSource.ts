// HEL-1632 (design.md D3): which rows the live Output column shows, with which marker and caption. A pure mapping from
// the page's walks and sample state to a render source; every row of the design's table is one branch here.

import type { Frame } from "../../evaluator";
import type { DraftStepView } from "../draftStepView";

export const DRAFT_CAPTION = "Rendered from the draft. Nothing is written until you save and run.";
export const SAVED_PIPELINE_CAPTION = "Rendered from the saved pipeline over the cached sample.";
export const SAMPLE_CAPTION = "Rendered from the cached sample.";
export const LAST_RUN_CAPTION = "Showing the last run.";
export const NOT_PREVIEWED_CAPTION = "Not previewed (AI step): showing the last run's data.";
export const SELECT_STEP_HINT = "Select this step to update it";

/** `none`: nothing to flag; `live`: the current draft's frame; `updating`: a server fallback is in flight; `stale`: a last
 *  good frame or saved rows while a draft exists; `saved`: saved rows with no draft. */
export type LiveMarker = "none" | "live" | "updating" | "stale" | "saved";

export type SampleState = "loading" | "ready" | "unusable";

export type LiveOutputSource =
  | { kind: "loading" }
  | { kind: "frame"; rows: Frame; marker: LiveMarker; caption: string; note: string | null }
  | { kind: "saved"; marker: LiveMarker; caption: string; note: string | null };

export interface LiveOutputSourceInput {
  output: { nodeStepId?: string; rootId?: string };
  hasDraft: boolean;
  sample: SampleState;
  /** The saved pipeline's frame for the Output's node (`null` when the walk could not give one). */
  baseFrame: Frame | null;
  /** The sample frame of the Output's root, when it is bound to a root. */
  rootFrame: Frame | null;
  /** The draft's view of the Output's node. */
  view: DraftStepView | undefined;
}

const saved = (
  hasDraft: boolean,
  caption: string,
  note: string | null = null,
  marker: LiveMarker = hasDraft ? "stale" : "saved",
): LiveOutputSource => ({ kind: "saved", marker, caption, note });

export function liveOutputSource(input: LiveOutputSourceInput): LiveOutputSource {
  const { output, hasDraft, sample, baseFrame, rootFrame, view } = input;
  if (sample === "loading") return { kind: "loading" };
  if (sample === "unusable") return saved(hasDraft, LAST_RUN_CAPTION);

  if (output.nodeStepId === undefined && output.rootId !== undefined) {
    return rootFrame === null
      ? saved(hasDraft, LAST_RUN_CAPTION)
      : { kind: "frame", rows: rootFrame, marker: "none", caption: SAMPLE_CAPTION, note: null };
  }

  if (!hasDraft) {
    return baseFrame === null
      ? saved(false, LAST_RUN_CAPTION)
      : {
          kind: "frame",
          rows: baseFrame,
          marker: "none",
          caption: SAVED_PIPELINE_CAPTION,
          note: null,
        };
  }

  if (view === undefined) return saved(true, DRAFT_CAPTION, SELECT_STEP_HINT);
  if (view.status === "notPreviewed") return saved(true, NOT_PREVIEWED_CAPTION);

  const lastGood = view.rows ?? baseFrame;
  const staleFrame = (note: string | null): LiveOutputSource =>
    lastGood === null
      ? saved(true, DRAFT_CAPTION, note)
      : { kind: "frame", rows: lastGood, marker: "stale", caption: DRAFT_CAPTION, note };

  if (view.status === "ok") {
    if (view.rows === null) return saved(true, DRAFT_CAPTION, SELECT_STEP_HINT);
    if (view.frameStale) return staleFrame(SELECT_STEP_HINT);
    return { kind: "frame", rows: view.rows, marker: "live", caption: DRAFT_CAPTION, note: null };
  }
  if (view.status === "pending") {
    return lastGood === null
      ? saved(true, DRAFT_CAPTION, null, "updating")
      : { kind: "frame", rows: lastGood, marker: "updating", caption: DRAFT_CAPTION, note: null };
  }
  // error | stale: the last good frame, with the step's message.
  return staleFrame(view.message);
}
