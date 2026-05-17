// Per-subtype editor handle interface.
//
// PanelDetailModal owns the modal lifecycle (mode toggle, discard warning,
// close). Each subtype-specific editor is a self-contained section that
// owns its own local form state and exposes its dirty flag + save thunk
// via a ref so the parent can sequence saves and present a unified Save
// button.

export interface PanelEditorHandle {
  /** Reset local state back to the panel's current values. */
  reset: () => void;
  /** Persist if dirty. Resolves with `{ ok: true }` on success or
   *  `{ ok: false, error: string }` on failure. Resolves with `ok: true`
   *  when there is nothing to save (the parent treats no-op as success). */
  save: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Each editor calls this whenever its local form state's dirty status
 *  changes so the parent modal can recompute its unified save / discard
 *  button state without polling. */
export type DirtyChangeCallback = (isDirty: boolean) => void;
