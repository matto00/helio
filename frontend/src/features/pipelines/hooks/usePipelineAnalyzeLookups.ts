import { useCallback, useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";

import { resolveDraftFallbackSchema } from "../state/stepNarrowing";
import type { PendingDraftMeta } from "./usePipelineStepCreation";
import type { AnalyzeWarning, PipelineAnalyzeResponse, SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";

// F-146 — module-level (not per-render) so a step with no analyze data yet
// gets the same empty-array reference on every call, not a fresh `[]` per
// lookup; see `analyzeByStepId` below for why that reference stability
// matters for `StepCard`'s `React.memo`.
const EMPTY_ANALYZE_COLUMNS: string[] = [];
const EMPTY_ANALYZE_SCHEMA: SchemaField[] = [];
const EMPTY_ANALYZE_WARNINGS: AnalyzeWarning[] = [];

type UsePipelineAnalyzeLookupsArgs = {
  analyzeResult: PipelineAnalyzeResponse | null;
  steps: Step[];
  pendingDraftMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
  draftFallbackMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
};

/**
 * The per-step analyze lookups extracted from `usePipelineDetailPage` (HEL-1465): the memoised
 * `analyzeByStepId` map, the draft-step schema fallback and the `getAnalyze*` getters handed to each
 * `StepCard`. Every getter keeps the identity it had in the page hook (F-146).
 */
export function usePipelineAnalyzeLookups({
  analyzeResult,
  steps,
  pendingDraftMetaRef,
  draftFallbackMetaRef,
}: UsePipelineAnalyzeLookupsArgs) {
  // ── Per-step analyze columns / schema ──
  // Build helpers from step.id → inputSchema data so each StepCard can receive
  // the correct columns/schema without re-running the analyze logic in the UI.
  //
  // F-146 — this used to be 4 separate `.find()` scans over
  // `analyzeResult.steps` per lookup, called fresh for every StepCard on
  // every render (any keystroke in any one step's config re-renders
  // `PipelineDetailPage`, since `steps` state changes). Besides the
  // repeated O(n) scans, every call minted a brand-new array (`.map()` for
  // columns; even the pass-through `inputSchema`/`outputSchema` reads were
  // wrapped in a fresh closure invocation each time) — so even an unrelated
  // step's `StepCard` received new-identity `analyzeColumns`/`analyzeSchema`/
  // `analyzeOutputSchema` props every render, which defeats `React.memo`'s
  // shallow prop comparison (see `StepCard.tsx`) regardless of whether the
  // underlying `analyzeResult` actually changed. Built once per
  // `analyzeResult` change instead; lookups below are O(1) Map reads that
  // return the *same* array reference across renders until analyze data
  // itself changes.
  const analyzeByStepId = useMemo(() => {
    const map = new Map<
      string,
      {
        columns: string[];
        schema: SchemaField[];
        outputSchema: SchemaField[];
        validationError?: string;
      }
    >();
    if (analyzeResult) {
      for (const s of analyzeResult.steps) {
        map.set(s.id, {
          columns: s.inputSchema.map((f) => f.name),
          schema: s.inputSchema,
          outputSchema: s.outputSchema,
          validationError: s.validationError,
        });
      }
    }
    return map;
  }, [analyzeResult]);

  // HEL-1109 / evaluation-1.md CR2 — a draft AI step's field-picker fallback.
  // The actual resolution logic is the pure, independently-tested
  // `resolveDraftFallbackSchema` (`stepNarrowing.ts`); this hook only wires
  // in its own closures (the live `analyzeByStepId` map, the live `steps`
  // array, and the root-source-schema lookup).
  const sourceSchemaForRoot = useCallback(
    (rootId: string | undefined): SchemaField[] => {
      if (!analyzeResult) return EMPTY_ANALYZE_SCHEMA;
      if (rootId) {
        const match = analyzeResult.sourceSchemas.find((s) => s.rootId === rootId);
        if (match) return match.sourceSchema;
      }
      return analyzeResult.sourceSchemas[0]?.sourceSchema ?? EMPTY_ANALYZE_SCHEMA;
    },
    [analyzeResult],
  );

  const getDraftFallbackSchema = useCallback(
    (stepId: string): SchemaField[] =>
      resolveDraftFallbackSchema(
        stepId,
        steps,
        (id) => analyzeByStepId.get(id),
        sourceSchemaForRoot,
        pendingDraftMetaRef.current.get(stepId) ?? draftFallbackMetaRef.current.get(stepId),
      ),
    [steps, analyzeByStepId, sourceSchemaForRoot, pendingDraftMetaRef, draftFallbackMetaRef],
  );

  const hasDraftFallbackMeta = useCallback(
    (stepId: string) =>
      pendingDraftMetaRef.current.has(stepId) || draftFallbackMetaRef.current.has(stepId),
    [pendingDraftMetaRef, draftFallbackMetaRef],
  );

  // HEL-1340 — drop a sent draft's fallback meta once its CURRENT id has its own analyze entry
  // (reads go to `analyzeByStepId` first, so the stale entry is harmless; this just bounds it) or
  // the step is gone (removed, or its create failed and was removed).
  useEffect(() => {
    for (const key of Array.from(draftFallbackMetaRef.current.keys())) {
      if (analyzeByStepId.has(key) || !steps.some((s) => s.id === key)) {
        draftFallbackMetaRef.current.delete(key);
      }
    }
  }, [analyzeByStepId, steps, draftFallbackMetaRef]);

  const getAnalyzeColumns = useCallback(
    (stepId: string): string[] => {
      const entry = analyzeByStepId.get(stepId);
      if (entry) return entry.columns;
      if (hasDraftFallbackMeta(stepId)) {
        return getDraftFallbackSchema(stepId).map((f) => f.name);
      }
      return EMPTY_ANALYZE_COLUMNS;
    },
    [analyzeByStepId, getDraftFallbackSchema, hasDraftFallbackMeta],
  );

  const getAnalyzeSchema = useCallback(
    (stepId: string): SchemaField[] => {
      const entry = analyzeByStepId.get(stepId);
      if (entry) return entry.schema;
      if (hasDraftFallbackMeta(stepId)) return getDraftFallbackSchema(stepId);
      return EMPTY_ANALYZE_SCHEMA;
    },
    [analyzeByStepId, getDraftFallbackSchema, hasDraftFallbackMeta],
  );

  // HEL-404 — mirror of getAnalyzeSchema, reading outputSchema instead of
  // inputSchema, so StepCard can render the step's output schema inline in
  // its preview tray without any new backend call.
  const getAnalyzeOutputSchema = useCallback(
    (stepId: string): SchemaField[] =>
      analyzeByStepId.get(stepId)?.outputSchema ?? EMPTY_ANALYZE_SCHEMA,
    [analyzeByStepId],
  );

  // HEL-1340 — lets StepCard suppress the schema diff while a step is still on the fallback.
  const hasOwnAnalyzeEntry = useCallback(
    (stepId: string): boolean => analyzeByStepId.has(stepId),
    [analyzeByStepId],
  );

  const getAnalyzeValidationError = useCallback(
    (stepId: string): string | undefined => analyzeByStepId.get(stepId)?.validationError,
    [analyzeByStepId],
  );

  // HEL-1414 — warnings grouped by step id, built once per analyze result so each step's array
  // identity is stable across renders (StepCard is memoised) and a step without warnings gets the
  // shared empty array.
  const warningsByStepId = useMemo(() => {
    const map = new Map<string, AnalyzeWarning[]>();
    for (const w of analyzeResult?.warnings ?? []) {
      const list = map.get(w.stepId);
      if (list) list.push(w);
      else map.set(w.stepId, [w]);
    }
    return map;
  }, [analyzeResult]);

  const getAnalyzeWarnings = useCallback(
    (stepId: string): AnalyzeWarning[] => warningsByStepId.get(stepId) ?? EMPTY_ANALYZE_WARNINGS,
    [warningsByStepId],
  );

  return {
    getAnalyzeColumns,
    getAnalyzeSchema,
    getAnalyzeOutputSchema,
    hasOwnAnalyzeEntry,
    getAnalyzeValidationError,
    getAnalyzeWarnings,
  };
}
