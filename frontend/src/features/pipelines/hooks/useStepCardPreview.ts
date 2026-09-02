import { useEffect, useRef, useState } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { fetchStepPreview } from "../services/pipelineService";
import type { StepPreviewResponse } from "../services/pipelineService";

// HEL-404 — persistent per-user "preview open" preference. One global key
// (not per-step, see design.md Decision 3): the last explicit open/hide
// choice becomes the default for every StepCard, so expanding any card
// auto-opens its preview once the user has opted in. Follows theme.ts's
// storage-key + read-at-init precedent; the try/catch guard here is our own
// hardening (theme.ts only guards `typeof window`).
const PREVIEW_OPEN_STORAGE_KEY = "helio-step-preview-open";

/** 500ms > the 300ms analyze debounce in PipelineDetailPage, so the analyze
 *  round-trip and any config-PATCH burst settle first (design.md Decision 2). */
const PREVIEW_REFRESH_DEBOUNCE_MS = 500;

export function readStoredPreviewOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PREVIEW_OPEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredPreviewOpen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREVIEW_OPEN_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Storage unavailable (private browsing, quota, disabled) — the
    // in-memory preview state still works for the current session.
  }
}

interface UseStepCardPreviewArgs {
  pipelineId: string;
  stepId: string;
  stepEnabled: boolean;
  expanded: boolean;
  /** `${stepIndex}:${enabledBits}:${JSON.stringify(step.config)}` — see
   *  `StepCard`'s original inline comment (design.md Decisions 8/9) for why
   *  stepIndex/enabledBits are folded in alongside config. */
  configFingerprint: string;
}

/**
 * HEL-682 split (task 3.2) — the per-step inline "preview data" tray's state
 * machine, extracted verbatim from `StepCard.tsx`. Behavior-preserving: same
 * activation/debounce/disabled-transition rules (HEL-412 evaluation-1.md
 * CR1), same localStorage-backed `previewOpen` default.
 */
export function useStepCardPreview({
  pipelineId,
  stepId,
  stepEnabled,
  expanded,
  configFingerprint,
}: UseStepCardPreviewArgs) {
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => readStoredPreviewOpen());
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // HEL-404 — tracks the config fingerprint the preview was last fetched for.
  // `null` means "not fetched since preview last activated" (fresh open or
  // just-expanded card): fetch immediately, no debounce. A non-null value
  // that differs from the current fingerprint means the config changed while
  // the preview was active: debounce the re-fetch. Resets to `null` whenever
  // the preview deactivates by the USER's own action (hidden or card
  // collapsed) so reopening always fetches fresh. Deliberately NOT reset when
  // a step is merely disabled (see the `step.enabled` branch below) — HEL-412
  // evaluation-1.md CR1.
  const lastFetchedFingerprint = useRef<string | null>(null);
  // HEL-412 evaluation-1.md CR1 — tracks whether the step was enabled on the
  // previous run of this effect, so a false→true transition can be detected
  // and routed through the debounced path even when `lastFetchedFingerprint`
  // happens to be `null` (e.g. the step was disabled+expanded+previewOpen
  // from a stale localStorage preference before ever fetching once).
  const wasEnabledRef = useRef(stepEnabled);

  useEffect(() => {
    const wasEnabled = wasEnabledRef.current;
    wasEnabledRef.current = stepEnabled;

    // A disabled step's preview is unavailable (its control is hidden) —
    // skip the fetch entirely rather than hitting the backend's defensive
    // 422 ("step is disabled"). Deliberately does NOT touch
    // `lastFetchedFingerprint` here (HEL-412 evaluation-1.md CR1): disabling
    // is not a user-initiated "close the tray" action, so re-enabling must
    // not look like a fresh activation.
    if (!stepEnabled) return;

    const active = expanded && previewOpen;
    if (!active) {
      lastFetchedFingerprint.current = null;
      return;
    }

    async function runFetch() {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result: StepPreviewResponse = await fetchStepPreview(pipelineId, stepId);
        setPreviewRows(result.rows);
      } catch (err: unknown) {
        // HEL sweep F-155: don't surface raw Axios/transport text (e.g.
        // "Request failed with status code 422") — read the backend's
        // parsed error body first, matching the app-wide extractErrorMessage
        // convention (see its docstring).
        setPreviewError(extractErrorMessage(err, "Preview failed — try again."));
      } finally {
        setPreviewLoading(false);
      }
    }

    // HEL-412 evaluation-1.md CR1 — a disabled→enabled transition must NEVER
    // take the immediate/undebounced "activation" branch below: the
    // optimistic enable flip in `PipelineDetailPage.handleToggleStepEnabled`
    // fires this same re-render before its own PATCH has resolved, so an
    // immediate GET can reach the backend (and get a defensive 422) before
    // the enable commits server-side. Always debounce-refetch instead — even
    // when `configFingerprint` happens to equal what was last fetched (a
    // single-step pipeline's `enabledBits`/config round-trip back to the
    // exact same string across a disable→enable cycle), because the
    // underlying server-side reality genuinely changed (skip → run): a
    // fingerprint-equality short-circuit here would leave the preview stuck
    // on stale-but-textually-identical data.
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

    if (lastFetchedFingerprint.current === configFingerprint) {
      // Already fetched for this config — nothing changed.
      return;
    }

    // Config changed while active: debounce the re-fetch so a PATCH burst
    // (and the analyze round-trip that feeds the schema strip) settles first.
    const handle = window.setTimeout(() => {
      lastFetchedFingerprint.current = configFingerprint;
      void runFetch();
    }, PREVIEW_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [expanded, previewOpen, stepEnabled, pipelineId, stepId, configFingerprint]);

  function handlePreviewToggle() {
    setPreviewOpen((prev) => {
      const next = !prev;
      writeStoredPreviewOpen(next);
      return next;
    });
  }

  function syncPreviewOpenFromStorage() {
    setPreviewOpen(readStoredPreviewOpen());
  }

  return {
    previewOpen,
    previewRows,
    previewLoading,
    previewError,
    handlePreviewToggle,
    syncPreviewOpenFromStorage,
  };
}
