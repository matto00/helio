import type { Frame } from "../../evaluator";
import type { DraftStepView } from "../draftStepView";
import {
  DRAFT_CAPTION,
  LAST_GOOD_NOTE,
  LAST_RUN_CAPTION,
  NOT_PREVIEWED_CAPTION,
  SAMPLE_CAPTION,
  SAVED_PIPELINE_CAPTION,
  SELECT_STEP_HINT,
  liveOutputSource,
  type LiveOutputSourceInput,
} from "./liveOutputSource";

const BASE: Frame = [{ a: 1 }, { a: 2 }];
const DRAFT: Frame = [{ a: 2 }];
const ROOT: Frame = [{ a: 1 }, { a: 2 }, { a: 3 }];

const view = (over: Partial<DraftStepView>): DraftStepView => ({
  status: "ok",
  count: 1,
  rows: DRAFT,
  frameStale: false,
  message: null,
  ...over,
});

function source(over: Partial<LiveOutputSourceInput>) {
  return liveOutputSource({
    output: { nodeStepId: "s1" },
    hasDraft: true,
    sample: "ready",
    baseFrame: BASE,
    rootFrame: null,
    view: view({}),
    ...over,
  });
}

describe("liveOutputSource (design.md D3 table)", () => {
  it("shows a skeleton while the sample is loading, before anything else", () => {
    expect(source({ sample: "loading", output: { rootId: "r" } })).toEqual({ kind: "loading" });
  });

  it("shows saved rows when no usable sample exists: saved without a draft, stale with one", () => {
    expect(source({ sample: "unusable", hasDraft: false })).toMatchObject({
      kind: "saved",
      marker: "saved",
      caption: LAST_RUN_CAPTION,
    });
    expect(source({ sample: "unusable" })).toMatchObject({ kind: "saved", marker: "stale" });
    // A root-bound Output with a failed sample shows saved rows too.
    expect(source({ sample: "unusable", output: { rootId: "r" }, rootFrame: ROOT })).toMatchObject({
      kind: "saved",
    });
  });

  it("renders a root-bound Output from the root's sample, never live", () => {
    for (const hasDraft of [false, true]) {
      expect(source({ output: { rootId: "r" }, rootFrame: ROOT, hasDraft })).toMatchObject({
        kind: "frame",
        rows: ROOT,
        marker: "none",
        caption: SAMPLE_CAPTION,
      });
    }
  });

  it("renders the saved pipeline over the sample with no draft, with no marker", () => {
    expect(source({ hasDraft: false, view: undefined })).toMatchObject({
      kind: "frame",
      rows: BASE,
      marker: "none",
      caption: SAVED_PIPELINE_CAPTION,
    });
  });

  it("falls to saved rows with no draft when the base node has no frame", () => {
    expect(source({ hasDraft: false, baseFrame: null, view: undefined })).toMatchObject({
      kind: "saved",
      marker: "saved",
      caption: LAST_RUN_CAPTION,
    });
  });

  it("is live on the draft's own current frame", () => {
    expect(source({})).toEqual({
      kind: "frame",
      rows: DRAFT,
      marker: "live",
      caption: DRAFT_CAPTION,
      note: null,
    });
  });

  it("is updating on the last good frame while a server fallback is pending", () => {
    expect(
      source({ view: view({ status: "pending", rows: BASE, frameStale: true }) }),
    ).toMatchObject({
      kind: "frame",
      rows: BASE,
      marker: "updating",
    });
    expect(
      source({ view: view({ status: "pending", rows: null }), baseFrame: null }),
    ).toMatchObject({
      kind: "saved",
      marker: "updating",
    });
  });

  it("is stale on the last good frame for an error or a stale step, without repeating the step's message", () => {
    for (const status of ["error", "stale"] as const) {
      expect(
        source({ view: view({ status, rows: BASE, frameStale: true, message: "boom" }) }),
      ).toEqual({
        kind: "frame",
        rows: BASE,
        marker: "stale",
        caption: DRAFT_CAPTION,
        note: LAST_GOOD_NOTE,
      });
    }
    // The base frame stands in when the view has none.
    expect(source({ view: view({ status: "error", rows: null, message: "x" }) })).toMatchObject({
      kind: "frame",
      rows: BASE,
      marker: "stale",
    });
  });

  it("shows saved rows labelled stale for a not-previewed node", () => {
    expect(source({ view: view({ status: "notPreviewed", rows: null }) })).toEqual({
      kind: "saved",
      marker: "stale",
      caption: NOT_PREVIEWED_CAPTION,
      note: null,
    });
  });

  it("hints to select the step for a server-resolved, non-focused node", () => {
    // Older rows, not current: stale frame plus the hint.
    expect(source({ view: view({ rows: BASE, frameStale: true }) })).toMatchObject({
      kind: "frame",
      marker: "stale",
      note: SELECT_STEP_HINT,
    });
    // No rows at all (ok, rows null): saved rows plus the hint.
    expect(source({ view: view({ rows: null }) })).toMatchObject({
      kind: "saved",
      marker: "stale",
      note: SELECT_STEP_HINT,
    });
    // An unknown node.
    expect(source({ view: undefined })).toMatchObject({ kind: "saved", note: SELECT_STEP_HINT });
  });
});
