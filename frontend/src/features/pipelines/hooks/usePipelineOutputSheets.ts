import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { MutableRefObject } from "react";
import { useSearchParams } from "react-router-dom";

import { useAppSelector } from "../../../hooks/reduxHooks";
import {
  selectOutputsByStepId,
  selectOutputsForPipeline,
  selectPreviewRowCountByOutputId,
} from "../state/outputsSlice";
import type { Output } from "../types/output";
import type { DraftFrames } from "./usePipelineDraftFrames";

type UsePipelineOutputSheetsArgs = {
  id: string | undefined;
  allOutputsRef: MutableRefObject<Output[]>;
};

/**
 * The Output lists and sheets extracted from `usePipelineDetailPage` (HEL-1478 D3, C7): the
 * per-step and flat Output selectors, the editor sheet and History view state with their open /
 * close handlers, and the HEL-909 `?outputId=` deep link (D1d).
 */
export function usePipelineOutputSheets({ id, allOutputsRef }: UsePipelineOutputSheetsArgs) {
  // task 3.3 — one array per trunk/tail step id, memoized (see
  // `selectOutputsByStepId`'s doc comment); `EMPTY_OUTPUTS` (in
  // `state/outputsSlice.ts`, shared by `ui/LaneColumn.tsx` and
  // `ui/PipelineRiverView.tsx`) mirrors the `EMPTY_ANALYZE_COLUMNS` pattern
  // (in `usePipelineAnalyzeLookups.ts`) so a step with zero Outputs gets a
  // stable `[]` reference rather than defeating `StepCard`'s `React.memo`.
  const outputsByStepId = useAppSelector((state) => selectOutputsByStepId(state, id ?? ""));
  const previewRowCountByOutputId = useAppSelector(selectPreviewRowCountByOutputId);
  // task 4.1/4.2 -- flat list feeding the "Outputs (N)" tab/gallery. Distinct
  // from `outputsByStepId` (grouped, feeds the rail): the gallery is one flat
  // grid regardless of which step each Output is off of.
  const allOutputs = useAppSelector((state) => selectOutputsForPipeline(state, id ?? ""));
  useLayoutEffect(() => {
    allOutputsRef.current = allOutputs;
  });

  // task 5.1 — `OutputEditorSheet.tsx` opens against either an existing
  // Output (edit) or a target step id with no Output yet (create, `stepId`
  // omitted = pipeline root; the sheet's own step-picker, task 4.4, then
  // lets the user change it before the first save).
  const [outputSheet, setOutputSheet] = useState<{
    output: Output | null;
    createTargetStepId?: string;
  } | null>(null);
  const handleOpenOutput = useCallback((output: Output) => {
    setOutputSheet({ output });
  }, []);
  // HEL-1277 — the per-Output History view (scrubber); separate from the editor sheet above.
  const [historyOutput, setHistoryOutput] = useState<Output | null>(null);
  const handleOpenOutputHistory = useCallback((output: Output) => setHistoryOutput(output), []);
  const handleCloseOutputHistory = useCallback(() => setHistoryOutput(null), []);
  const handleAddOutput = useCallback((stepId?: string) => {
    setOutputSheet({ output: null, createTargetStepId: stepId });
  }, []);
  const handleCloseOutputSheet = useCallback(() => {
    setOutputSheet(null);
  }, []);

  // HEL-1733 (design.md D5 wiring): the sheet's target node is page state, so the layout can ask the draft-preview request for its
  // rows (`rowsStepIds`) and the sheet can read its draft columns. Initialised from the opened Output (or the create target); the
  // sheet's Step picker moves it. Keyed by the sheet, so a new sheet starts from its own target (effect-free).
  const sheetKey =
    outputSheet === null
      ? null
      : (outputSheet.output?.id ?? `create:${outputSheet.createTargetStepId ?? ""}`);
  const [pickedNode, setPickedNode] = useState<{ key: string; id: string | undefined } | null>(
    null,
  );
  const sheetNodeStepId =
    outputSheet === null
      ? undefined
      : pickedNode !== null && pickedNode.key === sheetKey
        ? pickedNode.id
        : (outputSheet.output?.nodeStepId ?? outputSheet.createTargetStepId);
  const setSheetNodeStepId = useCallback(
    (stepId: string | undefined) => {
      if (sheetKey !== null) setPickedNode({ key: sheetKey, id: stepId });
    },
    [sheetKey],
  );
  // Written by the active layout (desktop or phone) while a sheet is open: the draft frames the sheet's preview and columns read.
  const [sheetDraftNode, setSheetDraftNode] = useState<{
    frames: DraftFrames;
    nodeStepId: string | undefined;
  } | null>(null);

  // HEL-909 — the Panel sheet's "Output link" deep-links here as
  // `/pipelines/:id?outputId=<id>` (no pre-existing OutputEditorSheet
  // deep-link convention exists to follow — this is the new one). Opens the
  // sheet once the matching Output has loaded into `allOutputs`; clears the
  // param afterward so a later manual close doesn't immediately reopen it.
  //
  // HEL-1478 D1d — the open is a render-time state adjustment (like the derived-state block
  // in `usePipelineDetailPage.ts`), not an effect-driven `setOutputSheet`, which `react-hooks/set-state-in-effect`
  // rejects. `deepLinkSeen` holds the (searchParams, allOutputs) pair the sheet was last opened
  // at. It MUST start at the `null` sentinel: seeding it with the current pair would skip the
  // open when the Outputs are already in Redux at mount. State is set only when the id is present
  // AND resolves AND the pair changed by identity, so renders without a deep link gain no extra
  // pass. An acted-on `searchParams` identity cannot recur (the clear below changes
  // `location.search`; `useMemo` hands out a fresh object on any later return to a string), and
  // `EMPTY_OUTPUTS` can recur but never resolves an id, so it is never stored. `setSearchParams`
  // is deliberately not part of the comparison: it is not stable (react-router builds it with
  // `useCallback([navigate, searchParams])`, and `BrowserRouter`'s navigate depends on the
  // pathname), but its changes are `searchParams` changes plus pathname-only ones. The effect's
  // outcome is a pure function of the (searchParams, allOutputs) values; the one case where a
  // pathname-only change could re-open on the old code is a navigation landing between the
  // clear's call and its commit, which the app never produces (it would also change the route
  // id, and so `allOutputs`).
  const [searchParams, setSearchParams] = useSearchParams();
  const [deepLinkSeen, setDeepLinkSeen] = useState<{
    searchParams: URLSearchParams;
    allOutputs: Output[];
  } | null>(null);
  const deepLinkId = searchParams.get("outputId");
  const deepLinkTarget = deepLinkId ? allOutputs.find((o) => o.id === deepLinkId) : undefined;
  if (
    deepLinkTarget &&
    (deepLinkSeen === null ||
      deepLinkSeen.searchParams !== searchParams ||
      deepLinkSeen.allOutputs !== allOutputs)
  ) {
    setDeepLinkSeen({ searchParams, allOutputs });
    setOutputSheet({ output: deepLinkTarget });
  }
  useEffect(() => {
    const targetOutputId = searchParams.get("outputId");
    if (!targetOutputId) return;
    const target = allOutputs.find((o) => o.id === targetOutputId);
    if (!target) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("outputId");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, allOutputs, setSearchParams]);
  return {
    outputsByStepId,
    previewRowCountByOutputId,
    allOutputs,
    outputSheet,
    handleOpenOutput,
    historyOutput,
    handleOpenOutputHistory,
    handleCloseOutputHistory,
    handleAddOutput,
    handleCloseOutputSheet,
    sheetNodeStepId,
    setSheetNodeStepId,
    sheetDraftNode,
    setSheetDraftNode,
  };
}
