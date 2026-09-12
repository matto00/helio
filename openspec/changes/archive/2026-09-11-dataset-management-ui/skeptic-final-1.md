## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: `15a3c93c873dd527657bea53fb48da32da4b4644` (worktree clean apart from the
evaluator's own untracked `evaluation-2.md`). Review base resolved LIVE via
`resolve-review-base.sh` → `d3c8e4ae2c021b3a7b97853c4f95d51d76bbf193`.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio
branch=feature/dataset-management-ui-schema/HEL-1079`.

**Gates — all re-run fresh by me, not taken from either report.**
- `npm run lint` → clean, exit 0.
- `npm run typecheck` → clean, exit 0.
- `npm test` (FULL) → frontend `315 suites / 3331 tests` passed; helio-mcp `25 suites / 248 tests`
  passed; exit 0. (Note: my first attempt used a wrong `--config` path and silently ran nothing
  while reporting `JEST_EXIT=0` because the exit code was masked by a `tail` pipe — re-run
  correctly before relying on it.)
- `npx playwright test e2e/hel1079-dataset-management-ui-live.spec.ts e2e/focus-presence-guard.spec.ts`
  (DEV_PORT=6511 BACKEND_PORT=9418) → **5 passed (2.2m)**. Focus guard measured 246 focusable
  elements across 10 views (both themes), 0 findings.
- `assert-phase.sh servers` → `PASS servers`.

**Scope / drift.** `git diff --name-only` = 24 files; zero under `backend/`, `schemas/`, `infra/`
— confirmed no backend or migration change, as intended. `files-modified.md`'s file list matches
the actual diff. No scope creep found.

**Canonical types.** `CANONICAL_FIELD_TYPES` = the 7 canonical values in backend order; verified
against `model.scala:735-747`'s `CanonicalWireValues`/`fromString` directly. The drift guard genuinely
parses the Scala source (not a hand-copied twin) and additionally greps `frontend/src` for any other
7-type array literal. No `"double"` used as a value anywhere.

**Cycle-1 defect CR1 (state-resync race) — genuinely fixed for the SUCCESS path.** Verified live:
the fix builds `rows` from the PATCH response's own `fields`, so a successful confirmed drop updates
the on-screen table immediately. Corroborated by the e2e assertions and by my own live driving.
**But see Change Request 1 — the FAILURE path of the same flow is broken, and neither report tested it.**

**Cycle-1 defect CR2 (Decision 6 confirm-focus) — genuinely fixed.** Verified live twice: after
confirming a drop, `document.activeElement` was `Field 1 name` (never `<body>`). Unit tests cover
the middle-field, sole-remaining-field, and zero-remaining ("Add field") sub-cases.

**Two-mechanism split (Decision 3).** Predicted-blocked (add-required-no-default) is gated on
`totalRows` — the DATASET's row count from `datasetRowsSlice`, never per-field — and disables Save
with an inline reason before any request (verified live and by e2e, which asserts zero PATCHes sent).
Drop-confirmation triggers on `totalRows > 0` for ANY removed field, per Decision 3a. Retype and
tighten-to-required submit and surface inline. Structural 400 → single banner. All as designed.

**Visual cohesion.** Opened all 8 evidence screenshots (create-flow editor, CSV tab, 409 rejection,
drop-confirm; light + dark). Modal chrome, accent discipline (accent only on the primary button),
and neutral borders are cohesive with the neighbouring `AddSourceModal` CSV tab in both themes.
**But see Change Request 2** — the new components ship no stylesheet at all.

### Verdict: REFUTE

### Change Requests

1. **A rejected confirmed-drop is presented as applied — the UI shows the field gone while the
   server kept it, and the user is left in a dead end only a reload escapes.** This violates the
   change spec's requirement *"A rejected multi-field edit applies nothing"* and the ticket's core
   premise ("make it visible rather than failing at write time later").

   Root cause: `DatasetSchemaEditor.tsx:212-223` `handleConfirmDrop` calls `setRows(nextRows)`
   **before** `submitSchema(nextRows, true)`, and `submitSchema`'s `catch` never reverts `rows`.
   The comment at `DatasetSchemaEditor.tsx:193-195` — *"the caller's `rows` state is left exactly as
   it was passed in (never advanced past this point on failure)"* — is **false for this path**: the
   confirm path advances `rows` before the call, so a 409/400 leaves the drop applied on screen.

   Reproduced live **twice** (identical both times), on a dataset with one row
   (`label="not-a-number"`, `drop_me="doomed"`):
   - Retype Field 1 → `integer` (incompatible), then Remove field 2 → confirm "Delete field data".
   - Server response: `409 {"rejectedFields":[{"name":"label","reason":"1 existing row(s) do not
     satisfy the new type"}]}`.
   - On screen afterward: only `label` remains, typed `integer`; `drop_me` and its remove button are
     **gone**.
   - Server, independently re-queried at that same moment: `GET .../schema` → `200 {"fields":
     [{"name":"label","type":"string"},{"name":"drop_me","type":"string"}]}` — **both fields still
     present, nothing applied**.
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1079/evidence/skeptic-hel1079-rejected-drop-divergence.png`

   Follow-on dead end (verified directly against the API): once `drop_me` has been erased from the
   editor, "Save schema" remains **enabled** and `handleSaveClick` submits with `confirmDrop: false`.
   That request is rejected: `PATCH` omitting `drop_me` without `confirmDrop` →
   `409 "drop_me: dropping a field with existing rows requires confirmDrop: true"`. The user has no
   field row left to re-trigger the confirm dialog, so the drop can never be re-confirmed — the
   surface is stuck until a full page reload.

   Fix: do not advance `rows` until the submit succeeds (submit the computed `nextRows` while
   leaving displayed state intact until `200`), or explicitly restore the pre-drop `rows` in
   `submitSchema`'s failure branch for this path. Correct the now-false comment at lines 193-195.

   Test gap that let this ship: **no test pairs a confirmed drop with a rejected PATCH.** Both
   `mockRejectedValue` tests in `DatasetSchemaEditor.test.tsx` (lines 246, 266) go through "Save
   schema"; every drop-confirm test mocks a *resolved* PATCH. Add a test asserting that after a
   rejected confirmed drop the dropped field is still rendered and the rejection reason is shown,
   plus a real-backend e2e case for the same (the combined retype+drop request above is a
   ready-made fixture).

2. **The new components ship no CSS at all — every class they introduce is undefined.** Verified by
   repo-wide grep over `frontend/src/**/*.css`: `dataset-schema-editor` → **0 hits**,
   `field-declaration-table` → **0 hits**, `schema-edit` → **0 hits**, `block-reason` → **0 hits**;
   and `git diff --name-only | grep css` → **NONE**. The borrowed `add-source-modal__*` classes do
   exist (`AddSourceModal.css`), which is the only reason the surface renders acceptably at all.

   Consequences visible in the evidence screenshots: the rejection text
   (`dataset-schema-editor__field-error`) and the predicted-block reason
   (`dataset-schema-editor__block-reason`) render as **plain unstyled body text**, not using the
   `--app-error` intent token that DESIGN.md reserves for error states — an error message that does
   not read as an error; the reorder/remove action cell (`field-declaration-table__actions`) has no
   layout rules, so the three icon buttons stack cramped in a column; and the new "Schema" section
   (`source-detail-panel__schema-edit`) has no spacing rhythm of its own.

   This diverges from DESIGN.md §1 (*"plain CSS, organized as co-located CSS Modules — one `.css`
   file per component"*) and §Spacing's **[mechanical]** rule that *"All margin/padding/gap use a
   `--space-*` token"* — a rule that cannot be satisfied by a component that ships no stylesheet.
   Fix: add the co-located `DatasetSchemaEditor.css` / `FieldDeclarationTable.css` these class hooks
   already imply, using `--space-*` for the action-cell layout and section rhythm and `--app-error`
   for the two error/blocked messages; or route those two messages through the shared `InlineError`
   primitive already imported in this very file, which carries the correct treatment for free.

### Non-blocking notes

- The create flow no longer prevents removing the **last** field (the old `StaticSourceForm`
  disabled the remove button at `columns.length <= 1`; `FieldDeclarationTable` has no equivalent
  guard). Reaching zero fields is recoverable — "Next: Add rows" then reports "All fields must have
  a name" — so this is a minor UX regression, not a defect.
- Carried over from both evaluations: the read-only "Field / Type / Nullable" summary
  (`SchemaFieldViewer`, driven by `source.inferredSchema`) sits directly above the editable schema
  panel and does not refresh on the same cadence, so the two can disagree on screen after an edit.
  Pre-existing and not introduced here, but it is now much more visible because the editor was
  placed immediately beneath it. Worth a follow-up ticket.
- `parseDefault` is duplicated near-verbatim in `DatasetSchemaEditor.tsx:35-47` and
  `StaticSourceForm.tsx` (the `default`-string → typed-value conversion). Minor DRY nit; a shared
  helper would suit, given Decision 1's stated reuse rationale.

### Gate-defect check

No report in this run rests on mtime-ordering or positional evidence, and none disclosed an
unsound evidence directory — so the mtime-acceptance gate defect does not apply here. My own
load-bearing evidence is self-authenticating (command output with exit codes, API responses
quoted verbatim, and a persisted screenshot).
