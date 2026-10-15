import { useState } from "react";

import { useStepPreviewFetch } from "./useStepPreviewFetch";

// HEL-404 — persistent per-user "preview open" preference. One global key
// (not per-step, see design.md Decision 3): the last explicit open/hide
// choice becomes the default for every StepCard, so expanding any card
// auto-opens its preview once the user has opted in. Follows theme.ts's
// storage-key + read-at-init precedent; the try/catch guard here is our own
// hardening (theme.ts only guards `typeof window`).
const PREVIEW_OPEN_STORAGE_KEY = "helio-step-preview-open";

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
 * machine, extracted verbatim from `StepCard.tsx`. HEL-1579 task 3.4: the fetch/debounce half
 * now lives in `useStepPreviewFetch`, shared with the desktop preview table; this hook keeps the
 * localStorage-backed `previewOpen` default and the activation rule (`expanded && previewOpen`).
 * Behavior-preserving: same activation/debounce/disabled-transition rules (HEL-412
 * evaluation-1.md CR1).
 */
export function useStepCardPreview({
  pipelineId,
  stepId,
  stepEnabled,
  expanded,
  configFingerprint,
}: UseStepCardPreviewArgs) {
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => readStoredPreviewOpen());
  const { previewRows, previewLoading, previewError } = useStepPreviewFetch({
    pipelineId,
    stepId,
    stepEnabled,
    active: expanded && previewOpen,
    configFingerprint,
  });

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
