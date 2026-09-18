## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/counter-event-row-model/spec.md`, `specs/form-panel-submit/spec.md`) in full.
- Confirmed `FormFieldSpec`/`ValidControls`/`FittingControls` live in
  `backend/src/main/scala/com/helio/domain/panels/FormPanel.scala:17-58` (design.md correctly
  identifies this, though it calls it `FormFieldSpec.ValidControls` without naming the enclosing
  file — verified `ValidControls = Set("text", "textarea", "number", "date", "select", "checkbox",
  "file")` and `FittingControls` map both exist and lack `"counter"` today).
- Confirmed `FormSubmission.buildRow`
  (`backend/src/main/scala/com/helio/domain/panels/FormSubmission.scala:49-148`) is a pure function
  of `(config, declaration, values)` with `file`/`select` branches at lines 94-111 — the described
  `counter` branch insertion point exists as claimed.
- Confirmed `DataSourceRepository.appendBuiltRowAction`
  (`backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala:655-683`)
  calls `build(declaration)` at line 669, then reads `existingRows` at line 672 — design.md's
  "line 669 vs 672" citation for Decision 2's rejected alternative is accurate.
- Confirmed `dataset_rows.seq` monotonic per-source assignment
  (`insertAppendedRowsAction`, `maxExistingSeq + 1 + idx`, lines 618-625) and that no `Clock`
  abstraction currently exists in `PanelService` (grepped — none found), consistent with tasks.md's
  "grep for Clock first" hedge.
- Confirmed `PipelineAnalyzeService.inferAggregate` exists
  (`backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala`) — the "no new
  pipeline capability needed" claim is accurate.
- Confirmed the frontend `CONTROL_FITNESS` drift guard
  (`frontend/src/features/panels/state/controlFitnessDriftGuard.test.ts`) parses
  `FittingControls` (not `ValidControls`) out of `FormPanel.scala` directly — task 1.1's citation is
  correct and the guard will genuinely fail if the frontend mirror isn't updated alongside the
  backend `FittingControls` entries.
- Checked `FormSchemaConsistency.check` (`.../FormSchemaConsistency.scala`) — it only validates
  `config.fields` (configured fields) against the declared dataset schema; it has no knowledge of,
  or check for, the convention-named `occurred_at`/`value` declared fields design.md Decision 3a
  depends on.
- Checked `schemas/panels/panel.schema.json:205-213` — the actual wire-level `control` enum lives
  here (`"enum": ["text", "textarea", "number", "date", "select", "checkbox", "file"]`), not at
  `schemas/panels/form-panel.schema.json`, which does not exist anywhere in the repo (confirmed via
  `find schemas -iname "*form-panel*"` — no hit).

### Verdict: REFUTE

### Change Requests

1. **A spec scenario has no corresponding verification task.** `specs/counter-event-row-model/spec.md`'s
   "A time-series Output renders the append sequence" scenario (and the matching ticket AC bullet)
   is not traced to any task in `tasks.md` §2. Every other requirement/scenario in the spec has a
   matching test task (2.1–2.5 cover append-not-mutate, rapid submission, ordering, aggregate
   derivation, no-UPDATE); this one does not. Either add a task that builds a pipeline Output over a
   counter dataset ordered by `(occurred_at, seq)` and asserts it renders one point per event, or
   explicitly justify in design.md why this scenario needs no new test (e.g. "purely a consequence
   of existing Output/ordering machinery, already covered by X") — right now it is silently
   uncovered.

2. **Decision 3a's convention-named-field mechanism has no failure-mode handling.** The entire
   `{occurred_at, delta, value}` shape guarantee depends on a counter-configured dataset happening to
   declare fields literally named `occurred_at` and `value`. Nothing in `design.md`/`tasks.md` adds a
   validation step (e.g. in `FormSchemaConsistency.check`, which is exactly the existing mechanism
   for config/declaration consistency and is not extended here) that rejects a counter-configured
   form whose bound dataset lacks those declared columns. Today that misconfiguration would silently
   produce rows missing `occurred_at` entirely (nothing throws — the field would just never be in
   `declaration`, so nothing gets injected and the AC's row-shape guarantee quietly fails) rather than
   a clear rejection at form-save or submit time. Add a task to detect and reject this case (or, at
   minimum, an explicit design.md decision arguing why silent omission is acceptable — it currently
   isn't discussed at all).

3. **Task 3.1 cites a file that does not exist.** `tasks.md` §3.1 says to update
   `schemas/panels/form-panel.schema.json` — no such file exists in the repo. The actual `control`
   enum requiring the `"counter"` addition is `schemas/panels/panel.schema.json:211-213`. Correct the
   citation so the executor isn't left to discover this only via the task's own "or wherever" hedge.

### Non-blocking notes

- Decision 2 (reject server-computed `value`) is well-reasoned and the rejected-alternative citation
  is verifiably accurate against the current lock-ordering in `DataSourceRepository`.
- Task 2.2's concurrent-append test and 2.5's UPDATE-absence-via-`id`/`updated_at`-stability test are
  appropriately rigorous (C7-style "prove it red first" framing).
- Design correctly scopes out a new `PanelKind` per the v0.8 spec's Decision 4/5 — consistent with
  the ticket's own non-goals.
