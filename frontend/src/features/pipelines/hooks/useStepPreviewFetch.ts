import { useEffect, useRef, useState } from "react";

import { fetchStepPreview } from "../services/pipelineService";
import type { StepPreviewResponse } from "../services/pipelineService";
import { previewErrorMessage } from "../services/stepConfigError";

/** 500ms > the 300ms analyze debounce in PipelineDetailPage, so the analyze round-trip and any
 *  config-PATCH burst settle first (HEL-404 design.md Decision 2). */
export const PREVIEW_REFRESH_DEBOUNCE_MS = 500;

export type StepPreviewFetcher = (
  pipelineId: string,
  stepId: string,
) => Promise<StepPreviewResponse>;

interface UseStepPreviewFetchArgs {
  pipelineId: string;
  stepId: string;
  stepEnabled: boolean;
  /** Whether the preview is wanted right now: the card's `expanded && previewOpen` on the phone,
   *  "this step is selected and not still being created" for the desktop table. */
  active: boolean;
  /** `${stepIndex}:${enabledBits}:${JSON.stringify(step.config)}` -- see `StepCard`
   *  (HEL-407 design.md Decision 9 / HEL-412 Decision 8) for why index and enabled bits are folded in. */
  configFingerprint: string;
  /** Defaults to the plain `fetchStepPreview`; the desktop table passes a page-scoped in-flight
   *  dedupe wrapper (HEL-1579 design.md D8). */
  fetcher?: StepPreviewFetcher;
  /** HEL-1579 (design.md D8): resolves once every pending step save has settled, so the GET
   *  reflects the saved upstream config. Awaited before every fetch; the phone omits it. */
  beforeFetch?: () => Promise<void>;
}

/**
 * The step-preview fetch/debounce state machine, shared by the phone card's inline tray
 * (`useStepCardPreview`) and the desktop preview table (HEL-1579 task 3.4). Extracted verbatim from
 * `useStepCardPreview` (HEL-682 split, HEL-404/HEL-412 rules): same activation/debounce/
 * disabled-transition behaviour, plus an optional `fetcher` and `beforeFetch` and a stale-response
 * guard so an out-of-order response never overwrites a newer one.
 */
export function useStepPreviewFetch({
  pipelineId,
  stepId,
  stepEnabled,
  active: wanted,
  configFingerprint,
  fetcher = fetchStepPreview,
  beforeFetch,
}: UseStepPreviewFetchArgs) {
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewRowCount, setPreviewRowCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // HEL-404 -- the config fingerprint the preview was last fetched for. `null` means "not fetched
  // since the preview last activated": fetch immediately, no debounce. A non-null value that
  // differs from the current fingerprint means the config changed while active: debounce the
  // re-fetch. Reset to `null` whenever the preview deactivates by the USER's own action, so
  // reopening always fetches fresh. Deliberately NOT reset when a step is merely disabled
  // (HEL-412 evaluation-1.md CR1).
  const lastFetchedFingerprint = useRef<string | null>(null);
  // HEL-412 evaluation-1.md CR1 -- whether the step was enabled on the previous run of the
  // effect, so a false->true transition goes through the debounced path.
  const wasEnabledRef = useRef(stepEnabled);
  const requestToken = useRef(0);
  // Latest callbacks without re-running the effect on their identity.
  const fetcherRef = useRef(fetcher);
  const beforeFetchRef = useRef(beforeFetch);
  useEffect(() => {
    fetcherRef.current = fetcher;
    beforeFetchRef.current = beforeFetch;
  });

  useEffect(() => {
    const wasEnabled = wasEnabledRef.current;
    wasEnabledRef.current = stepEnabled;

    // A disabled step's preview is unavailable -- skip the fetch rather than hit the backend's
    // defensive 422. Does NOT touch `lastFetchedFingerprint` (HEL-412 evaluation-1.md CR1).
    if (!stepEnabled) return;

    if (!wanted) {
      lastFetchedFingerprint.current = null;
      return;
    }

    async function runFetch() {
      const token = ++requestToken.current;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        await beforeFetchRef.current?.();
        const result: StepPreviewResponse = await fetcherRef.current(pipelineId, stepId);
        if (token !== requestToken.current) return;
        setPreviewRows(result.rows);
        setPreviewRowCount(result.rowCount ?? result.rows.length);
      } catch (err: unknown) {
        if (token !== requestToken.current) return;
        // HEL sweep F-155: never surface raw transport text. HEL-1147: a step-configuration 422
        // shows the clean `reason` (attributed to the upstream step when an ancestor failed).
        setPreviewError(previewErrorMessage(err, "Preview failed — try again.", stepId));
      } finally {
        if (token === requestToken.current) setPreviewLoading(false);
      }
    }

    // HEL-412 evaluation-1.md CR1 -- a disabled->enabled transition must NEVER take the immediate
    // branch: the optimistic enable flip re-renders before its PATCH resolves, so an immediate GET
    // could reach the backend first (a defensive 422). Always debounce-refetch, even when the
    // fingerprint is textually unchanged (the server-side reality changed: skip -> run).
    if (!wasEnabled) {
      const handle = window.setTimeout(() => {
        lastFetchedFingerprint.current = configFingerprint;
        void runFetch();
      }, PREVIEW_REFRESH_DEBOUNCE_MS);
      return () => window.clearTimeout(handle);
    }

    if (lastFetchedFingerprint.current === null) {
      // Activation: fetch immediately, no debounce.
      lastFetchedFingerprint.current = configFingerprint;
      void runFetch();
      return;
    }

    if (lastFetchedFingerprint.current === configFingerprint) return;

    // Config changed while active: debounce so a PATCH burst (and the analyze round-trip feeding
    // the schema strip) settles first.
    const handle = window.setTimeout(() => {
      lastFetchedFingerprint.current = configFingerprint;
      void runFetch();
    }, PREVIEW_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [wanted, stepEnabled, pipelineId, stepId, configFingerprint]);

  return { previewRows, previewRowCount, previewLoading, previewError };
}
