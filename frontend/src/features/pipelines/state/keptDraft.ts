// keptDraft -- HEL-1631: a pipeline draft is kept per tab in sessionStorage so a leave the page cannot hold (Back, the palette,
// Settings) does not lose it. It is stored WITH the saved pipeline it was made against: a return over a different saved
// pipeline must take the stale-base path, never silently re-base. Cleared on logout (keys are per pipeline id, not per user).

import type { DraftOp } from "./draftOps";
import type { DraftOverlay } from "./pipelineDraft";

export const KEPT_DRAFT_PREFIX = "helio.pipelineDraft.";

export interface KeptDraft {
  overlay: DraftOverlay;
  /** A signature of the saved steps the draft was made against (`baseSignature`). */
  base: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

/** One op with every field it needs (a duplicate missing `config`, say, rejects the whole kept draft). */
function parseOp(raw: unknown): DraftOp | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "delete":
      return isString(raw.stepId) ? { kind: "delete", stepId: raw.stepId } : null;
    case "insert": {
      const a = raw.anchor;
      const anchorOk = isRecord(a) && (isString(a.after) || isString(a.head) || isString(a.append));
      return isString(raw.clientId) && isString(raw.type) && isRecord(raw.config) && anchorOk
        ? (raw as unknown as DraftOp)
        : null;
    }
    case "lane":
      return isString(raw.clientId) &&
        isString(raw.type) &&
        isRecord(raw.config) &&
        isString(raw.parent)
        ? (raw as unknown as DraftOp)
        : null;
    case "duplicate":
      return isString(raw.clientId) &&
        isString(raw.of) &&
        isString(raw.type) &&
        isRecord(raw.config) &&
        typeof raw.enabled === "boolean"
        ? (raw as unknown as DraftOp)
        : null;
    case "reorder":
      return isString(raw.rootId) && Array.isArray(raw.trunk) && raw.trunk.every(isString)
        ? (raw as unknown as DraftOp)
        : null;
    default:
      return null;
  }
}

/** Version 2 is validated op by op; a draft kept with no `version` (`{configs, enabled, deleted}`) is the earlier format and
 *  restores as delete ops. Anything else reads as absent. */
export function readKeptDraft(pipelineId: string): KeptDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEPT_DRAFT_PREFIX + pipelineId);
    if (raw === null) return null;
    const v = JSON.parse(raw) as { overlay?: unknown; base?: unknown };
    const o = v.overlay;
    if (typeof v.base !== "string" || !isRecord(o) || !isRecord(o.configs) || !isRecord(o.enabled))
      return null;
    const configs = o.configs as DraftOverlay["configs"];
    const enabled = o.enabled as DraftOverlay["enabled"];
    if (o.version === undefined) {
      if (!Array.isArray(o.deleted) || !o.deleted.every(isString)) return null;
      const ops = o.deleted.map((stepId): DraftOp => ({ kind: "delete", stepId }));
      return { base: v.base, overlay: { version: 2, ops, configs, enabled } };
    }
    if (o.version !== 2 || !Array.isArray(o.ops)) return null;
    const ops: DraftOp[] = [];
    for (const item of o.ops) {
      const op = parseOp(item);
      if (op === null) return null;
      ops.push(op);
    }
    return { base: v.base, overlay: { version: 2, ops, configs, enabled } };
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
