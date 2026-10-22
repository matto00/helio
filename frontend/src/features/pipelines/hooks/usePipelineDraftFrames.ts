import { useMemo } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { selectRootFrames, selectSourceFrames } from "../../sources/state/sourceSamplesSlice";
import { evaluatePipeline, type Frame } from "../evaluator";
import {
  createIncrementalWalker,
  schemaFromFrame,
  secondarySourceIds,
  toStepDefinitions,
} from "../state/draftEvaluation";
import { buildDraftPreviewRequest } from "../state/draftPreviewRequest";
import { createViewTracker, type DraftStepView } from "../state/draftStepView";
import type { PipelineRoot, SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { useDraftPreviewTransport } from "./useDraftPreviewTransport";

/** What a draft remembers between renders: the last good frame per step and the walker's reuse state. Owned by the page
 *  hook, so a desktop/phone layout swap does not drop them. */
export interface DraftFrameMemory {
  walker: ReturnType<typeof createIncrementalWalker>;
  tracker: ReturnType<typeof createViewTracker>;
}

export function createDraftFrameMemory(): DraftFrameMemory {
  return { walker: createIncrementalWalker(), tracker: createViewTracker() };
}

export interface DraftFrames {
  /** Every step's displayed view; `null` while no draft exists (nothing displayed changes from the saved pipeline). */
  views: ReadonlyMap<string, DraftStepView> | null;
  /** The saved pipeline's per-step count over the SAME sample, for the "saved -> draft" display. */
  baseCounts: ReadonlyMap<string, number> | null;
  /** A root's sample is the first 1,000 rows of a larger source: the counts are over the sample. */
  sampleTruncated: boolean;
  /** The saved pipeline's frame per step over the same sample: what a first edit is compared with for the changed-row flash. */
  baseRows: ReadonlyMap<string, Frame> | null;
  /** Each root's sample frame, by pipeline root id: the rows an Output bound to a root renders (HEL-1632). */
  rootRows: ReadonlyMap<string, Frame>;
  /** Some step is waiting on the server. */
  pending: boolean;
  /** The columns (with types) a step receives as input in the draft, when its parent has a current frame; `null` falls back to
   *  the last analyze result (design.md D5). `saved` is that analyze result's input schema, which supplies the types. */
  inputSchemaOf: (step: Step, saved: readonly SchemaField[]) => SchemaField[] | null;
}

const NONE: DraftFrames = {
  views: null,
  baseCounts: null,
  baseRows: null,
  rootRows: new Map(),
  sampleTruncated: false,
  pending: false,
  inputSchemaOf: () => null,
};

/**
 * HEL-1631 (design.md D3/D4): the draft's per-step frames. The client evaluator walks the saved steps (the "saved" side of a
 * count) and the draft steps (the "draft" side) over the cached source samples; a step the client cannot evaluate goes through
 * the HEL-1630 transport. Called by the layout (desktop or phone), which knows the focused step; the draft itself lives on the
 * page hook. With no draft the draft side is not walked and nothing is requested; the saved side is walked only when the pipeline has an
 * Output (`needBase`), so the live Output column (HEL-1632) has rows to show and a first edit does not pay for it.
 */
export function usePipelineDraftFrames({
  pipelineId,
  roots,
  baseSteps,
  draftSteps,
  hasDraft,
  needBase = false,
  focusStepId,
  memory,
}: {
  pipelineId: string;
  roots: PipelineRoot[];
  baseSteps: Step[];
  draftSteps: Step[];
  hasDraft: boolean;
  /** Walk the saved steps even without a draft (the pipeline has an Output to render). */
  needBase?: boolean;
  focusStepId: string | null;
  memory: DraftFrameMemory;
}): DraftFrames {
  const { walker, tracker } = memory;
  const rootFrames = useAppSelector((state) => selectRootFrames(state, roots));
  const secondaryKey = useMemo(() => secondarySourceIds(draftSteps).join(","), [draftSteps]);
  const secondaryIds = useMemo(
    () => (secondaryKey === "" ? [] : secondaryKey.split(",")),
    [secondaryKey],
  );
  const sources = useAppSelector((state) => selectSourceFrames(state, secondaryIds));
  const sampleLoading = useAppSelector((state) =>
    roots.some((r) => {
      const entry = state.sourceSamples.entries[r.dataSourceId];
      return entry === undefined || entry.status === "loading";
    }),
  );
  const sampleTruncated = useAppSelector((state) =>
    roots.some((r) => state.sourceSamples.entries[r.dataSourceId]?.sample?.truncated === true),
  );

  const walkBase = hasDraft || needBase;
  const baseDefs = useMemo(
    () => (walkBase ? toStepDefinitions(baseSteps) : null),
    [baseSteps, walkBase],
  );
  const draftDefs = useMemo(
    () => (hasDraft ? toStepDefinitions(draftSteps) : null),
    [draftSteps, hasDraft],
  );
  const baseWalk = useMemo(
    () => (baseDefs === null ? null : evaluatePipeline(baseDefs, rootFrames, { sources })),
    [baseDefs, rootFrames, sources],
  );
  const draftWalk = useMemo(
    () => (draftDefs === null ? null : walker.walk(draftDefs, rootFrames, sources)),
    [walker, draftDefs, rootFrames, sources],
  );

  const built = useMemo(
    () =>
      draftDefs === null || draftWalk === null
        ? null
        : buildDraftPreviewRequest({
            defs: draftDefs,
            walk: draftWalk,
            rootFrames,
            sources,
            focusStepId,
          }),
    [draftDefs, draftWalk, rootFrames, sources, focusStepId],
  );
  const transport = useDraftPreviewTransport({ pipelineId, enabled: hasDraft, built });

  const views = useMemo(() => {
    if (draftWalk === null) {
      tracker.reset();
      return null;
    }
    return tracker.derive(draftWalk, baseWalk, transport, sampleLoading);
  }, [tracker, draftWalk, baseWalk, transport, sampleLoading]);

  const base = useMemo(() => {
    if (baseWalk === null) return null;
    const counts = new Map<string, number>();
    const rows = new Map<string, Frame>();
    for (const [id, node] of baseWalk.nodes) {
      if (node.status === "ok" || node.status === "disabled") {
        counts.set(id, node.count);
        rows.set(id, node.rows);
      }
    }
    return { counts, rows };
  }, [baseWalk]);

  const rootRows = useMemo(() => new Map(rootFrames.map((r) => [r.rootId, r.rows])), [rootFrames]);

  return useMemo(() => {
    if (views === null) {
      return base === null && rootRows.size === 0
        ? NONE
        : { ...NONE, baseRows: base?.rows ?? null, rootRows, sampleTruncated };
    }
    const inputSchemaOf = (step: Step, saved: readonly SchemaField[]): SchemaField[] | null => {
      if (draftWalk === null) return null;
      const parent = step.parentStepId ?? null;
      let frame: Frame | undefined;
      if (parent !== null) {
        const node = draftWalk.nodes.get(parent);
        frame = node?.status === "ok" || node?.status === "disabled" ? node.rows : undefined;
      } else {
        frame = rootFrames.find((r) => r.rootId === (step.rootId ?? rootFrames[0]?.rootId))?.rows;
      }
      return frame === undefined ? null : schemaFromFrame(frame, saved);
    };
    return {
      views,
      baseCounts: base?.counts ?? null,
      baseRows: base?.rows ?? null,
      rootRows,
      sampleTruncated,
      pending: [...views.values()].some((v) => v.status === "pending"),
      inputSchemaOf,
    };
  }, [views, base, rootRows, sampleTruncated, draftWalk, rootFrames]);
}
