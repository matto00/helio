// keptDraft -- HEL-1631: a pipeline draft is kept per tab in sessionStorage so a leave the page cannot hold (Back, the palette,
// Settings) does not lose it. It is stored WITH the saved pipeline it was made against: a return over a different saved
// pipeline must take the stale-base path, never silently re-base. Cleared on logout (keys are per pipeline id, not per user).

import type { DraftOverlay } from "./pipelineDraft";

export const KEPT_DRAFT_PREFIX = "helio.pipelineDraft.";

export interface KeptDraft {
  overlay: DraftOverlay;
  /** A signature of the saved steps the draft was made against (`baseSignature`). */
  base: string;
}

export function readKeptDraft(pipelineId: string): KeptDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEPT_DRAFT_PREFIX + pipelineId);
    if (raw === null) return null;
    const v = JSON.parse(raw) as { overlay?: Partial<DraftOverlay>; base?: unknown };
    const o = v.overlay;
    if (
      typeof v.base !== "string" ||
      o === undefined ||
      typeof o.configs !== "object" ||
      typeof o.enabled !== "object" ||
      !Array.isArray(o.deleted)
    )
      return null;
    return {
      base: v.base,
      overlay: { configs: o.configs ?? {}, enabled: o.enabled ?? {}, deleted: o.deleted },
    };
  } catch {
    return null;
  }
}

export function writeKeptDraft(pipelineId: string, kept: KeptDraft | null): void {
  try {
    if (kept !== null)
      window.sessionStorage.setItem(KEPT_DRAFT_PREFIX + pipelineId, JSON.stringify(kept));
    else window.sessionStorage.removeItem(KEPT_DRAFT_PREFIX + pipelineId);
  } catch {
    // Storage unavailable (private mode, quota): the draft simply is not kept.
  }
}

/** Removes every kept draft (logout: the next user in this tab must never see this one's). */
export function clearKeptDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key !== null && key.startsWith(KEPT_DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
