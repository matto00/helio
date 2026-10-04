# HEL-1230: Layout undo/redo handlers duplicated between CommandBar and useLayoutUndoRedo; undo/redo persistence is incidental

## Description

origin_kind: followup
origin_ticket: HEL-1028

Found during HEL-1028. Two related loose ends in the layout undo/redo path:

1. `CommandBar.tsx` `handleUndo`/`handleRedo` duplicate the logic in `useLayoutUndoRedo.ts` (dispatch
   `undoLayout`/`redoLayout` plus `setDashboardLayoutLocally`). Consolidate into one helper.
2. Persisting an undo/redo is only incidental after HEL-1028: `useLayoutSave` skips re-baselining on a
   history-revision change, so an undo to a layout that differs from the last PATCHed one is flushed by the next
   30s autosave or Save-now. Make this deliberate and specified (explicit persist on undo/redo, or document the
   deferred flush), including the in-flight PATCH response overwriting a newer local layout.
3. A drag followed by a panel create before the flush re-baselines, so the drag stays visible but is never PATCHed
   (documented and unit-tested in HEL-1028, but arguably wrong).

Also: CLAUDE.md says layout changes are "debounced 250ms"; the real mechanism is the 30s autosave interval,
Save-now, or unmount flush (`usePanelUpdatesFlush.ts`).

## Acceptance Criteria (derived from the ticket's four items; driver brief 2026-10-04)

- AC1: The undo and redo logic (history traversal + applying the target layout to the store) lives in exactly one
  place; both the keyboard shortcuts and the CommandBar buttons call it. No duplicate implementation remains in
  `CommandBar.tsx`.
- AC2: Undo/redo persistence is deliberate and specified: an undo/redo is a local layout edit persisted by the same
  deferred flush as a drag/resize (30s auto-save, Save now, grid unmount), stated in the spec, code comments and tests.
  Classification of an undo/redo store write no longer depends on a revision counter that a no-op traversal can leave
  stale.
- AC3: A layout PATCH response that arrives after the user has made a newer local layout change does not overwrite
  that newer layout, and the newer change stays pending and is persisted by the next flush.
- AC4: A drag (or resize, or undo/redo) followed by a panel create before the flush is not lost: the pending edit
  stays pending and the next flush PATCHes it. A panel create with no pending edit still sends no layout PATCH and
  does not mark the layout pending.
- AC5: CLAUDE.md's "debounced 250ms" line and the canonical openspec specs' 250 ms debounce wording are corrected to
  the real mechanism.

## Standing owner rulings (must not regress)

- HEL-1023: a missing/overlapping breakpoint is reflowed at render and persisted only on user edit; valid authored
  layouts render exactly as saved.
- HEL-1028: RGL re-syncs only on a layouts prop change; the stop handler arms a commit; handleLayoutChange commits;
  useLayoutSave is revision-aware.
- HEL-1071: an out-of-bounds or overlapping layout PATCH is rejected with 400.

## Parallel-run constraints

- Do not touch sources (HEL-1258) or connectors (HEL-1254) files. No migration expected (V115 reserved for HEL-1258;
  use V116 if one is ever needed and report it).
- HEL-1233 (layout repair on open) builds on this ticket's save path next: keep it clean and documented.
