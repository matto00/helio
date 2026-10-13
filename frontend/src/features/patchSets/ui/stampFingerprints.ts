import type { PatchSet, PatchSetPreviewResponse } from "../types/patchSet";

/** HEL-1458: returns `patchSet` with each update/delete target's `fingerprint` taken from the preview the user was
 *  shown (overriding whatever came in with the patch set), so apply refuses any target changed since that preview.
 *  A create edit, or an entry the preview carries no fingerprint for, ends up with none. */
export function stampFingerprints(patchSet: PatchSet, preview: PatchSetPreviewResponse): PatchSet {
  const byIndex = new Map(preview.edits.map((entry) => [entry.index, entry.fingerprint]));
  return {
    ...patchSet,
    edits: patchSet.edits.map((edit, index) => {
      const { fingerprint: _incoming, ...target } = edit.target;
      void _incoming;
      const fingerprint = edit.op === "create" ? undefined : byIndex.get(index);
      return { ...edit, target: fingerprint ? { ...target, fingerprint } : target };
    }),
  };
}
