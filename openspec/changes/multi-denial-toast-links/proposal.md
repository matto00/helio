## Why

When one dataset write denies two or more pipelines' auto-run, the HEL-1096 denial toast lists each
pipeline's reason but offers no action and no pointer to the pipeline pages, and it auto-dismisses
after 4 s. A user who does not know pipeline pages exist cannot act on it. The N>1 shape was a
design-gate decision, not an owner ruling (HEL-1172 corrects the record); the owner has now ruled
(2026-11-23, HEL-1172 Planning escalation): each row links to its pipeline page AND carries its own
inline "Run to update" where `canRun` (Q1 = b), and every denied pipeline is listed, scrolling
inside the toast past a maximum height (Q2 = a, no truncation).

## What Changes

- The toast data model gains an optional, ordered list of per-item rows (`items`), each with a
  pipeline link (`/pipelines/:id`), its reason text, and an optional per-row action.
- `ToastItem` (shared `Toast.tsx`) renders those rows as a list: the pipeline name is an in-app
  link, the reason text follows it, and a row whose pipeline the writer `canRun` gets its own
  "Run to update" button styled with the existing `.toast__action` treatment.
- `buildDeniedPipelinesToast` emits rows for N >= 2 denied pipelines (sorted by id, deterministic),
  `duration: 0` (persistent) — every such toast holds at least one link. N = 1 is unchanged.
- A used row action is removed from that toast (new `toastsSlice` reducer); when the last row
  action is used the toast is dismissed, mirroring the single-pipeline toast's dismiss-on-run.
- The row list scrolls inside the toast past a maximum height; nothing is truncated.
- Rapid identical writes still coalesce through the existing variant+message dedup (the message
  stays the deterministic aggregate, which also remains the live-region announcement).

## Capabilities

### New Capabilities

### Modified Capabilities
- `run-to-update-affordance`: the denial-toast requirement changes for N >= 2 denied pipelines —
  per-pipeline page links, per-pipeline "Run to update" where `canRun`, persistent, keyboard
  reachable, computed-ARIA exposed.

## Impact

- Frontend only, no backend, schema or migration change.
- `frontend/src/features/toasts/state/toastsSlice.ts`, `frontend/src/shared/ui/Toast.tsx`,
  `frontend/src/shared/ui/toast.css`, `frontend/src/features/pipelines/services/deniedPipelinesToast.ts`,
  `frontend/src/features/panels/ui/form/FormPanelView.tsx` (the only caller), plus tests and an e2e spec.
- No pipeline page component is touched (HEL-1794 is in flight there).
