## Files modified

- `backend/src/main/scala/com/helio/domain/panels/FormPanel.scala` — adds `"counter"` to `FormFieldSpec.ValidControls`/`FittingControls` (Integer/Float only)
- `backend/src/main/scala/com/helio/domain/panels/FormSubmission.scala` — `buildRow` gains a `now: Instant` parameter, a `counter` value-shape branch (delta must be a `JsNumber`, always required), and the Decision 3a `occurred_at`/`value` injection (server-assigned timestamp, client-supplied `occurred_at` ignored, `value` passed through verbatim)
- `backend/src/main/scala/com/helio/domain/panels/FormSchemaConsistency.scala` — adds the counter row-shape structural rule (`occurred_at`: timestamp, `value`: numeric non-required) to `check`
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — `appendBuiltRow`/`appendBuiltRowAction`'s `build` closure now takes `(declaration, now)`, reusing the same `updatedAt` instant already assigned inside the lock
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `appendFormRow`'s `build` closure type updated to match
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — `submitForm`'s two `build` closures (no-file and file paths) now thread `now` through to `FormSubmission.buildRow`
- `backend/src/test/scala/com/helio/domain/panels/FormSubmissionSpec.scala` — unit coverage for the counter value-shape branch, required-delta override, occurred_at injection/spoofing-ignored, value pass-through
- `backend/src/test/scala/com/helio/domain/panels/FormSchemaConsistencySpec.scala` — coverage for the new counter row-shape structural rule (missing/wrong-typed `occurred_at`, missing/required `value`)
- `backend/src/test/scala/com/helio/domain/panels/FormPanelSpec.scala` — updates the pre-existing "unknown control" fixture's expected valid-controls list to include `counter`
- `backend/src/test/scala/com/helio/api/routes/panels/FormSubmitRoutesSpec.scala` — new "counter control" describe block: HTTP-level submit tests (server-assigned occurred_at, value pass-through, non-numeric delta rejection, zero-delta acceptance, mixed +/- sequence with no-mutation proof, config-time schema-consistency rejection)
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/CounterEventRowModelSpec.scala` — new file: repository-level coverage against real EmbeddedPostgres for append-not-mutate, concurrent-submission non-coalescing (C7 mutation-verified — see file comment), millisecond-collision ordering via `seq`, and two real-pipeline-engine tests (`aggregate`/`sum` over `delta` independent of stored `value`; `sort` by `(occurred_at, seq)` reproducing submission order)
- `frontend/src/features/panels/types/panel.ts` — adds `"counter"` to `FormFieldControl`; updates the now-stale `step`-discriminator doc comment
- `frontend/src/features/panels/state/formConfigValidation.ts` — mirrors `CONTROL_FITNESS` (Integer/Float + `"counter"`) and adds `checkCounterRowShape`, the client-side mirror of the backend's counter structural check, wired into `computeFormIssues`
- `frontend/src/features/panels/state/formConfigValidation.test.ts` — updates the pre-existing fitting-controls fixture to include `counter`
- `frontend/src/features/panels/ui/editors/FormFieldRow.test.tsx` — updates the pre-existing control-picker fixture to include `counter`
- `schemas/panels/panel.schema.json` — adds `"counter"` to `FormFieldConfig.properties.control.enum`; updates the now-stale `step` description
- `CLAUDE.md` — documents the counter control's delta-only submit shape on the `POST /api/panels/:id/submit` line
- `frontend/src/features/panels/ui/form/FormFieldControl.tsx` — cycle-2 fix (evaluation-1.md blocking finding): adds a `"counter"` case to `renderControl`, a plain numeric input mirroring `"number"`, always `aria-required`
- `frontend/src/features/panels/ui/form/FormFieldControl.test.tsx` — coverage for the new counter render case
- `frontend/src/features/panels/state/formFieldValidation.ts` — `isFieldRequired` treats `"counter"` as always-required (mirrors `FormSubmission.buildRow`'s server override); `validateFieldValue`'s numeric-parse check extended to `"counter"`
- `frontend/src/features/panels/state/formFieldValidation.test.ts` — coverage for the counter always-required/numeric-parse rules

## Root cause / probe (C7, systematic-debugging.md)

Task 2.2's "rapid/concurrent submissions are not coalesced" claim is proven, not merely asserted:
`appendBuiltRowAction`'s `lockSource(id)` call was temporarily replaced with a no-op
(`DBIO.successful(())`) and `CounterEventRowModelSpec`'s concurrency test re-run against real
EmbeddedPostgres. It failed with `org.postgresql.util.PSQLException: duplicate key value violates
unique constraint "dataset_rows_data_source_id_seq_key"` — concurrent transactions raced
`maxExistingSeq`, computed the same next `seq`, and the DB's own `UNIQUE (data_source_id, seq)`
constraint (V106) caught it as a loud exception. The lock was restored (file diffed byte-identical
against the pre-mutation backup) before this handoff. See the in-file comment in
`CounterEventRowModelSpec.scala` for the full record.
