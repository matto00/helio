## Why

The pipeline detail page still PATCHes every step edit (400 ms debounce) and refetches a saved-config preview from the server (500 ms), so an edit costs two requests, the preview can lag the PATCH, and nothing can be explored without being written. Every building block for a client-only draft is now merged and unwired: the client evaluator (HEL-1581), the source sample store (HEL-1628/HEL-1648), the draft-preview NDJSON transport and scheduler (HEL-1630) and the atomic Save & run endpoint (HEL-1629). This change is the user-facing draft mode that wires them together (`docs/live-draft-preview.md` §5, §8, §12 item (e)).

## What Changes

- **Draft mode on the pipeline detail page (desktop and phone).** Step config edits, enabled toggles and step deletes become a client-only draft overlaid on the saved pipeline. Nothing is written until Save & run.
  - Desktop header: "Draft · unsaved changes" chip, Discard (secondary) and Save & run (primary, the only accent) replace Dry run / Run while a draft exists.
  - Phone: the reserved `draft-status` slot of the floating action bar shows "Draft · unsaved changes", and the pills become Discard / Save & run.
  - Structural operations not carried by the draft (add/insert/duplicate step, reorder, lane and root changes, shape instantiation, Output create/edit/delete) are disabled while a draft exists, with a "Save or discard your draft first" reason.
- **Removed per-edit traffic.** The per-edit `PATCH /api/pipeline-steps/:id` from the focused editor and its unmount flush are removed; the dead `useStepCardPreview` hook is deleted; `GET .../analyze` is not dispatched while a draft exists; the saved-config step preview request is not used for a step the client can evaluate.
- **Live recompute.** Per-step frames come from the client evaluator over the cached source samples, recomputed from the edited step down. Spine counts show the draft count, and "saved → draft" ("104 → 92") when they differ. The preview table shows the selected step's draft rows, and rows that changed flash once (static highlight under motion Off).
- **Per-step status** `ok | error | needsServer | stale` (plus "not previewed (AI step): runs on Save & run"). Server-only steps go through the HEL-1630 scheduler (debounced, single-flight, honours `429 Draft preview busy`), show pending while in flight, and keep their previous frame visible marked stale. A step in error freezes downstream steps at their last good frames, marked stale.
- **Discard** drops the draft with zero requests and the page shows exactly the saved pipeline.
- **Save & run** reads the saved definition once, verifies the draft's base, and posts one `POST /api/pipelines/:id/draft/save` with `runAfterSave: "run"`.
  - Stale base (409, or a base mismatch found before posting): a notice offering only "Reload the saved pipeline"; reload keeps the draft as a diff and re-applies it where its steps still exist.
  - Cascade (422): a confirmation listing the steps, Outputs, panels and alert rules the save would remove; confirming resends with `confirmCascade`.
  - Run refused after the save committed: "Saved. Run not started: rate limit, retry in N s" with a Run now action.
  - Success: a toast with Undo for the save's journal row; an undo refused with 409 shows the panels and alert rules that block it.
- **Sample label**: the existing per-source label (HEL-1628) stays; non-static sources always show the label with its age.

## Capabilities

### New Capabilities
- `pipeline-draft-mode-ui`: the client-only draft on the pipeline detail page: draft lifecycle, live per-step recompute and statuses, server-only step transport use, Discard, Save & run outcomes (stale base, cascade, refused run, undo), and the zero-request guarantee for client-evaluable edits.

### Modified Capabilities
- `pipeline-detail-spine-layout`: the header's primary action and the accent rule change while a draft exists (Save & run replaces Run; Discard replaces Dry run; draft chip).
- `pipeline-detail-mobile-layout`: the floating action bar's `draft-status` slot is filled and the pills become Discard / Save & run while a draft exists.

## Impact

- Frontend only: `frontend/src/features/pipelines/` (hooks, spine and mobile UI, step editor persistence seam, preview table), plus small reuse of `features/sources` sample selectors and `features/patchSets` undo.
- No backend, schema or migration change. Uses existing endpoints: `GET /api/pipelines/:id?definition=true`, `POST /api/pipelines/:id/draft/save`, `POST /api/pipelines/:id/draft-preview`, `POST /api/patch-sets/:id/undo`, `POST /api/pipelines/:id/run` (Run now, the existing run action).
- e2e: a new `e2e/hel1631-*.spec.ts`; `e2e/hel1579-pipeline-spine-layout.spec.ts`'s PATCH-on-step-switch assertion changes to assert no PATCH.
- Out of scope: the live Output column rendered from draft rows (HEL-1632), HEL-1677's backend loose ends, HEL-1676.
