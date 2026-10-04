# Layout

Cross-panel layout undo/redo history: `state/layoutHistorySlice.ts`, the single traversal entry
`state/layoutHistoryThunks.ts` (`applyLayoutUndo`/`applyLayoutRedo`, used by both the keyboard
shortcuts in `hooks/useLayoutUndoRedo.ts` and the CommandBar buttons), and the `applied` layout.

An undo/redo is a local layout edit persisted by the same deferred flush as a drag (auto-save
tick, Save now, grid unmount). How the store write is classified is documented in the header of
`features/panels/hooks/useLayoutSave.ts` (the classification contract).

**Belongs here:** the undo/redo stack shared across panel layout edits.
**Does not belong here:** the panel grid itself or per-drag persistence,
which live in `panels`.
