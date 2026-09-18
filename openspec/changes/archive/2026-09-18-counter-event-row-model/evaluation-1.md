## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
- All ticket ACs addressed: append-only `{occurred_at, delta, value}` row shape; no coalescing under
  rapid/concurrent submit; occurred_at/seq ordering; running total independently pipeline-derivable
  (never stored authoritative); no UPDATE anywhere in the counter submit path.
- No AC reinterpreted. `value` remains an inert client pass-through per design.md Decision 2 (matches
  the AC's "MAY be recorded ... never source of truth").
- All tasks.md items (1.1-3.2) match the diff; `[x]` marks are accurate.
- No scope creep — changes are confined to `FormFieldSpec`/`FormSubmission`/`FormSchemaConsistency`/
  the `build` closure's `now: Instant` threading, plus the mirrored frontend validation and the two
  drift-guard doc updates (`CLAUDE.md`, `schemas/panels/panel.schema.json`).
- No regression to non-counter form submit paths: `now` defaults to `Instant.now()`, `injectedKeys`
  is empty unless a `counter` field is present, `required` gains the `counter` disjunct without
  touching the existing `configRequired || declared.required` logic for every other control.
- API contract (`schemas/panels/panel.schema.json`, `CLAUDE.md`) updated in lockstep.
- design.md/proposal.md/tasks.md all reflect the final implemented behavior — cross-checked against
  the diff line-by-line for Decisions 1/2/3/3a/4.
- `workflow-state.md`'s `CONSTRAINTS` is `[]` (nothing non-retired to honor).

### Phase 2: Code Review — FAIL

**Gates (fresh run, this worktree, non-clean):**
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (28/28 mcp suites, 271 tests; 332/332 frontend suites, 3608 tests)
- `npm --prefix frontend run build` — PASS
- `cd backend && sbt test` — PASS (314 suites, 4701 tests, 0 failed)

**C7 mutation-proof verification (independently reproduced, not merely trusted):**
`CounterEventRowModelSpec.scala`'s in-file comment (lines 129-137) claims `appendBuiltRowAction`'s
`lockSource(id)` call was replaced with a no-op and the concurrency test re-run, producing
`org.postgresql.util.PSQLException: duplicate key value violates unique constraint
"dataset_rows_data_source_id_seq_key"`. I independently repeated this exact mutation myself
(`DataSourceRepository.scala:663`, `_ <- lockSource(id)` → `_ <- DBIO.successful(())`) and re-ran
`sbt "testOnly ...CounterEventRowModelSpec -- -z \"never coalesce\""` against real EmbeddedPostgres.
Result: the test failed with the exact claimed exception (`duplicate key value violates unique
constraint "dataset_rows_data_source_id_seq_key"`). I then restored the file from a pre-mutation
backup and confirmed via `md5sum` that the restored file is byte-identical to the pre-mutation
version (also matches `git diff` showing no residual change against HEAD). **The C7 claim is real
and independently confirmed**, not merely asserted.

**Core AC guarantee — `value` never read back as authoritative:** confirmed. `FormSubmission
.buildRow`'s injected `value` is a verbatim pass-through of `values.getOrElse("value", JsNull)`
(FormSubmission.scala, injectedByName). No code path in the diff reads a prior row's `value` cell.
`CounterEventRowModelSpec`'s aggregate test deliberately supplies a wrong stored `value` (`999`) on
one row and an absent `value` on others, and the real `InProcessPipelineEngine`'s `aggregate`/`sum`
step over `delta` reproduces the true total (`1.0`) independent of those stored cells — this is a
real (not hand-rolled) reproduction via the pipeline engine, satisfying tasks.md 2.4's bar.

**occurred_at/seq millisecond-collision ordering:** confirmed real, not simulated — both submissions
in the collision test share a frozen `Instant`, going through the same lock-held `appendBuiltRow`
path production uses; `seq` (assigned inside the same lock) is the sole, correctly-ordering
tie-breaker.

**Write-path caution — a rejected submission writes nothing:** confirmed with a real row-count
assertion, not a design claim. `FormSubmitRoutesSpec`'s "reject a non-numeric delta ... write
nothing" test asserts `rowCount(src) shouldBe 0` after a `400` response.

**FormSchemaConsistency's new structural rule enforced both server- and client-side:** confirmed.
`FormSchemaConsistency.checkCounterRowShape` (backend, `FormSchemaConsistency.scala`) and
`checkCounterRowShape` (frontend, `formConfigValidation.ts`) implement the identical rule (missing
`occurred_at`, wrong-typed `occurred_at`, missing `value`, non-numeric `value`, required `value`) —
verified line-by-line, both message sets match. `FormSubmitRoutesSpec`'s "reject binding a counter
field to a dataset missing occurred_at/value at config time" test proves server-side enforcement via
`POST /api/panels` at config time, not only at submit time.

**Blocking finding (mechanical, not a design-judgment call):**

`frontend/src/features/panels/ui/form/FormFieldControl.tsx`'s `renderControl` switch
(`FormFieldControl.tsx:109-209`) has no `case "counter":` — it falls through to
`default: return null` (line 207-208). This diff makes `"counter"` a real, user-selectable value in
`CONTROL_FITNESS` (`formConfigValidation.ts:17-18`) and therefore in the field-control `<Select>`
options rendered by `FormFieldRow.tsx:118` (`options={fitting.map(...)}`) **today**, before HEL-1088
ships any chrome. The file's own header comment (`FormFieldControl.tsx:1-4`) states it maps "all
seven controls" — it is now stale at eight, and the eighth is silently unhandled.

Concretely: a user can, right now, configure a form field's control to `"counter"` in the panel
editor (a legal, saveable config per the diff's own `FormSchemaConsistency`/`CONTROL_FITNESS`
changes), and the resulting runtime submit form renders the field's `<FormField>` label with a
**completely empty `<div>`** in place of any control — no input, no placeholder, no explanatory
text (contrast with the `issue`-path at `FormFieldControl.tsx:49-54`, which at least renders a
disabled `TextField` with a hint). Since `FormSubmission.buildRow` makes a `counter` field's delta
**unconditionally required** (`FormSubmission.scala`: `required = configRequired || declared.required
|| field.control == "counter"`), this field can never be filled by any UI currently shipped, which
permanently blocks that form panel's submission with no visible explanation to the user.

This is not the same thing as "the compact +/-/step-size UI chrome" the ticket's Non-Goals defer to
HEL-1088 — the Non-Goals defer the *counter-specific stepper chrome*, not "a counter field is
silently unusable and blocks the whole form." A minimally safe interim (e.g. falling back to the
existing `"number"` case's numeric `TextField` for `"counter"` until HEL-1088 replaces it with real
chrome, or at minimum an `issue`-shaped disabled placeholder explaining the field isn't ready) was not
built, and no line in `design.md`/the skeptic rounds (`skeptic-design-1/2/3.md`) addresses this
specific runtime-render gap — a grep for "FormFieldRow"/"editor"/"dropdown"/"expos" across those
files and `design.md` returns nothing on point.

### Phase 3: UI Review — PASS (mechanical checks; the FormFieldControl gap above is filed as a Phase 2 code finding, not re-litigated here)
- Servers started cleanly via `scripts/concertino/start-servers.sh`; `assert-phase.sh servers` → PASS.
- App loads at `http://localhost:6521` with no console errors on initial load.
- No UI chrome exists yet for the counter control itself (ticket's own stated scope) — no dedicated
  end-to-end counter-click flow to exercise beyond what's covered above.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/panels/ui/form/FormFieldControl.tsx:207-208` — add a `case "counter":`
   to the `renderControl` switch (or otherwise handle it) so a counter-configured field is never a
   silent, permanently-unfillable required field once HEL-1089 makes `"counter"` selectable in the
   editor. At minimum, degrade gracefully (e.g. reuse the `"number"` case's numeric input as an
   interim, or render the same disabled/hinted shape the `issue` path already uses at
   `FormFieldControl.tsx:49-54`) until HEL-1088 ships the real stepper chrome. Update the stale
   "all seven controls" comment at `FormFieldControl.tsx:1-4` to match whatever is decided.

### Non-blocking Suggestions
- None beyond the above — the domain-layer/backend work (the ticket's actual owned scope) is thorough
  and well-tested; the finding above is scoped narrowly to the frontend runtime-render gap this diff
  itself newly exposes.
