# HEL-1007: Editor: reorder affordance is wired for root 0 only — non-first roots cannot be reordered

## Description

HEL-973 unfenced `PUT /api/pipelines/:id/steps/order` for multi-root pipelines (whole-pipeline reorder, root membership invariant by construction). The backend now fully supports reordering a multi-root pipeline. The editor does not: the reorder affordance is wired for root 0 only.

- `PipelineRiverView.tsx` wires the move handlers only for the first root.
- `LaneColumn.tsx` uses `NOOP_MOVE` for every other root.

Pre-existing HEL-968 behaviour, made visible when HEL-973 removed the 400 fence. Priority High: (1) the capability looks delivered while being partly unusable; (2) it blocks closing a coverage loop: `usePipelineDetailPage.handleReorderSteps` gained a guard (HEL-973 evaluation-1 CR2) refusing a truncated payload when a root's trunk lane comes back empty, deliberately untested because currently unreachable.

## Acceptance Criteria (Scope)

- Wire the move up/down handlers (and drag) for every root's lane, not just `roots[0]`.
- Remove `LaneColumn`'s `NOOP_MOVE` path, or reduce it to genuinely non-reorderable lanes.
- The payload construction in `handleReorderSteps` already sends exactly one trunk lane per root and needs no change (to be verified).
- With the affordance in place, add real coverage for the CR2 guard and remove its "deliberately untested" note.
- (Driver additions) Accessible names identifying lane/root, keyboard operability, focus follows moved step; real-browser Playwright spec: reorder in root 1's lane, reload, order persists, red on main and green after; both themes checked live.

Related: HEL-973, HEL-968.
