## Why

`e2e/hel958-join-step-editor` fails intermittently (1 of 7 on main, more under HEL-1288's sharding). The CI trace
(run 37357274199) shows the editor body of a just-added step mounting, then vanishing: the card was expanded while
it still carried its client temp id, and the post-create resync swapped in the persisted id. Step cards are keyed
by `step.id`, so the card remounted collapsed. A real user who opens a just-added step during that window loses the
open editor, and any edit made inside it is silently dropped (`persist` no-ops on a temp id). The 5s PATCH wait is
only the first timer to fire.

## What Changes

- Probe-confirm the root cause first (deterministic latency probe on the post-create steps resync, plus a
  contention repro with a recorded before rate). If the probes refute it, stop and re-plan.
- A step card whose optimistic create is still in flight (temp id, create + resync not yet settled) cannot be
  expanded: its expand toggle is disabled until the persisted step replaces it. It becomes expandable again if the
  create fails, so the existing failure path (keep the local step, toast, Remove from the body) still works.
- Applies to both optimistic temp-id create paths: append/insert (`handleInsertStep`) and lane add
  (`handleAddLaneStep`). AI drafts that are created on config completion are unaffected (they stay editable).
- An RTL test that is red without the fix.
- No change to `e2e/hel958-join-step-editor.spec.ts` assertions or timeouts, `playwright.config.ts`, or `ci.yml`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-editor-page`: adds a requirement that a step card is not expandable while its create is in flight.

## Impact

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`, `ui/StepCard.tsx`, and the render sites that
  pass step props (`PipelineRiverView.tsx`, `LaneColumn.tsx`, `RootColumn.tsx`, `PipelineDetailPage.tsx`).
- Tests: new or extended RTL tests under `frontend/src/features/pipelines/`.

## Non-goals

- Quarantining, retrying, loosening, or lengthening timeouts in the hel958 spec.
- Other contention-only specs (HEL-1298) and the HEL-1289 seed-while-`/`-live class (HEL-1300).
- The AI-draft create-on-completion swap, which also changes the key. It is noted as a follow-up and not fixed here.
- Editing `playwright.config.ts` or `ci.yml` (owned by HEL-1288).
