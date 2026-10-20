// draftPreviewRequest -- HEL-1631 (design.md D4): builds the `POST /api/pipelines/:id/draft-preview` body for the steps the
// client cannot evaluate. The body holds the draft configs from the first server-evaluated step downward and the input frames
// they need, all taken from the client's own walk: each frontier step's input frame becomes a synthetic root, a lane
// reference to a step outside the request becomes a `lanes` frame, and a cached source secondary becomes a `sources` frame.

import type { Frame, RootFrame, SourceFrames, StepDefinition, WalkResult } from "../evaluator";
import { encodeRow } from "../evaluator/wire";
import type { DraftPreviewRequest, DraftPreviewStep, WireRow } from "../types/draftPreview";
import { serverResolvedStepIds } from "./draftEvaluation";

const frameIds = new WeakMap<object, number>();
let nextFrameId = 1;
/** A small stable id per frame object: a request key changes when an INPUT frame changes, not only a step config. */
function frameIdOf(frame: Frame): number {
  let id = frameIds.get(frame);
  if (id === undefined) {
    id = nextFrameId;
    nextFrameId += 1;
    frameIds.set(frame, id);
  }
  return id;
}

const encoded = new WeakMap<object, WireRow[]>();
function encodeFrame(frame: Frame): WireRow[] {
  let rows = encoded.get(frame);
  if (rows === undefined) {
    rows = frame.map((r) => encodeRow(r) as WireRow);
    encoded.set(frame, rows);
  }
  return rows;
}

const hasFrame = (
  n: ReturnType<WalkResult["nodes"]["get"]>,
): n is NonNullable<typeof n> & { rows: Frame } =>
  n !== undefined && (n.status === "ok" || n.status === "disabled");

const secondaryOf = (
  config: unknown,
): { kind: "source"; dataSourceId: string } | { kind: "lane"; stepId: string } | undefined => {
  const si = (config as { secondaryInput?: unknown } | null)?.secondaryInput;
  if (typeof si !== "object" || si === null) return undefined;
  const o = si as { kind?: unknown; dataSourceId?: unknown; stepId?: unknown };
  if (o.kind === "source" && typeof o.dataSourceId === "string")
    return { kind: "source", dataSourceId: o.dataSourceId };
  if (o.kind === "lane" && typeof o.stepId === "string") return { kind: "lane", stepId: o.stepId };
  return undefined;
};

export interface BuiltDraftPreview {
  request: DraftPreviewRequest;
  /** Changes whenever the request would answer differently (a step config, an input frame or the rows step). */
  key: string;
  /** The steps the request asks the server about. */
  stepIds: ReadonlySet<string>;
}

/** `null` when every step is client-evaluable (nothing to ask the server). */
export function buildDraftPreviewRequest(args: {
  defs: readonly StepDefinition[];
  walk: WalkResult;
  rootFrames: readonly RootFrame[];
  sources: SourceFrames;
  /** The step the user is looking at: its rows come back when the server resolves it. */
  focusStepId: string | null;
}): BuiltDraftPreview | null {
  const { defs, walk, rootFrames, sources, focusStepId } = args;
  const serverIds = serverResolvedStepIds(walk);
  if (serverIds.size === 0) return null;

  const steps = defs.filter((d) => serverIds.has(d.id));
  const roots = new Map<string, { id: string; frame: Frame }>();
  const rootFrameById = new Map(rootFrames.map((r) => [r.rootId, r.rows]));
  const lanes: Record<string, Frame> = {};
  const sourceFrames: Record<string, { rows: Frame; complete: boolean }> = {};

  const wireSteps: DraftPreviewStep[] = steps.map((d) => {
    const step: DraftPreviewStep = {
      id: d.id,
      kind: d.kind,
      enabled: d.enabled,
      position: d.position,
      config: (d.config ?? {}) as Record<string, unknown>,
    };
    if (d.parentStepId !== null && serverIds.has(d.parentStepId)) {
      step.parentStepId = d.parentStepId;
      return step;
    }
    // The first server step of its chain: its input frame is the parent's (or its root's) client frame.
    const parentNode = d.parentStepId !== null ? walk.nodes.get(d.parentStepId) : undefined;
    const frame = hasFrame(parentNode)
      ? parentNode.rows
      : d.parentStepId === null
        ? rootFrameById.get(d.rootId ?? rootFrames[0]?.rootId ?? "")
        : undefined;
    if (frame !== undefined) {
      const label = `frame:${d.parentStepId ?? d.rootId ?? "root"}`;
      roots.set(label, { id: label, frame });
      step.rootId = label;
    } else if (d.parentStepId !== null) {
      step.parentStepId = d.parentStepId;
    }
    return step;
  });

  for (const d of steps) {
    const secondary = secondaryOf(d.config);
    if (secondary?.kind === "lane" && !serverIds.has(secondary.stepId)) {
      const node = walk.nodes.get(secondary.stepId);
      if (hasFrame(node)) lanes[secondary.stepId] = node.rows;
    } else if (secondary?.kind === "source") {
      const src = sources[secondary.dataSourceId];
      if (src !== undefined) sourceFrames[secondary.dataSourceId] = src;
    }
  }

  const rowsStepId =
    focusStepId !== null && serverIds.has(focusStepId) ? focusStepId : (steps[0]?.id ?? null);

  const request: DraftPreviewRequest = {
    roots: [...roots.values()].map((r) => ({ id: r.id, rows: encodeFrame(r.frame) })),
    steps: wireSteps,
    ...(Object.keys(lanes).length > 0
      ? {
          lanes: Object.fromEntries(
            Object.entries(lanes).map(([id, f]) => [id, { rows: encodeFrame(f) }]),
          ),
        }
      : {}),
    ...(Object.keys(sourceFrames).length > 0
      ? {
          sources: Object.fromEntries(
            Object.entries(sourceFrames).map(([id, s]) => [
              id,
              { rows: encodeFrame(s.rows), complete: s.complete },
            ]),
          ),
        }
      : {}),
    rowsStepId,
  };

  const key = JSON.stringify({
    steps: wireSteps,
    roots: [...roots.values()].map((r) => [r.id, frameIdOf(r.frame)]),
    lanes: Object.entries(lanes).map(([id, f]) => [id, frameIdOf(f)]),
    sources: Object.entries(sourceFrames).map(([id, s]) => [id, frameIdOf(s.rows), s.complete]),
    rowsStepId,
  });
  return { request, key, stepIds: new Set(steps.map((s) => s.id)) };
}
