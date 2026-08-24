# Layout

Cross-panel layout undo/redo history: `state/layoutHistorySlice.ts` and
`hooks/useLayoutUndoRedo.ts`.

**Belongs here:** the undo/redo stack shared across panel layout edits.
**Does not belong here:** the panel grid itself or per-drag persistence,
which live in `panels`.
