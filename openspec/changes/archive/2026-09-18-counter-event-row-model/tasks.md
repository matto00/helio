## 1. Domain model — `counter` control

- [x] 1.1 Add `"counter"` to `FormFieldSpec.ValidControls`; add `IntegerType -> ... :+ "counter"` and
      `FloatType -> ... :+ "counter"` to `FormFieldSpec.FittingControls` (numeric types only — do not add to
      String/Boolean/Timestamp/BinaryRef). Update the frontend `CONTROL_FITNESS` mirror
      (`frontend/src/features/panels/state/formConfigValidation.ts` or wherever HEL-1084's drift-guarded literal
      lives) identically, per the existing C4 drift-guard test — grep for `CONTROL_FITNESS` to find it.
- [x] 1.2 `FormSubmission.buildRow`: add a `counter` branch parallel to the existing `file`/`select` branches —
      the supplied value for a `counter` field must be a `JsNumber`; anything else is a `FieldError` with a
      "number is required" message. Zero is a legal delta.
- [x] 1.3 Implement design.md Decision 3a's injection: when `config.fields` contains any `control == "counter"`
      entry, for any declared field literally named `occurred_at`, inject the server-supplied timestamp
      (threaded in as a new `now: Instant` parameter to `buildRow` — pure function, caller supplies the value);
      for any declared field literally named `value`, inject `values.get("value")` if present else `JsNull`.
      Both are excluded from the "undeclared/unconfigured field" rejection path for this submission only.
      A client-supplied `values("occurred_at")` is read and then unconditionally discarded/ignored — verify this
      explicitly with a test that sends a spoofed `occurred_at` and asserts the stored row does not contain it.
- [x] 1.4 Wire the `now: Instant` parameter through `PanelService.submitForm`'s existing `build` closure call site
      up to `DataSourceRepository.appendBuiltRow`'s `build` argument — `Instant.now()` (or the service's existing
      clock, if one is already injected for testability; grep for `Clock`/`clock` in `PanelService`/tests first).
- [x] 1.5 Extend `FormSchemaConsistency.check` (`backend/src/main/scala/com/helio/domain/panels/FormSchemaConsistency.scala`)
      with the counter-specific structural rule from design.md's "Failure mode" note: when `config.fields`
      contains a `control == "counter"` entry, the bound declaration must also declare a `TimestampType` field
      named `occurred_at` and a numeric, non-required field named `value` — `Left` naming the missing/invalid
      field otherwise. Mirror the same rule in the client-side `computeFormIssues` equivalent (HEL-1084's
      drift-guarded counterpart) so the author-time builder catches it too, not only the write API.

## 2. Verification — append-not-mutate, rapid submissions, ordering, schema consistency

- [x] 2.0 Backend test for task 1.5's `FormSchemaConsistency.check` extension: a form config with a `counter`
      field checked against a dataset declaration missing `occurred_at` returns `Left` naming the missing field;
      a form config checked against a declaration where `value` is `required: true` returns `Left` (spec
      scenarios "Binding a counter to a dataset missing `occurred_at` is rejected" / "...with a required `value`
      is rejected").

- [x] 2.1 Backend test: a sequence of counter submissions (mixed +/- deltas) produces exactly one `dataset_rows`
      row per submission, and no prior row's `data` changes after a later submission (byte-for-byte comparison of
      earlier rows before/after).
- [x] 2.2 Backend test proving rapid/concurrent submissions are not coalesced: fire N concurrent
      `appendBuiltRow` calls for the same source (e.g. `Future.sequence`) and assert N distinct rows with N
      distinct `seq` values land — not fewer. This is the AC's "double-click/rapid-repeat" guarantee; a
      sequential-only test does not prove it (C7 — prove it red first: verify the test would catch a
      lock-skipping/single-row-reuse mutation before trusting it green).
- [x] 2.3 Backend test: two submissions whose `occurred_at` collide at millisecond precision (freeze/stub the
      clock to return the same `Instant` twice) remain distinguishable and correctly ordered via `seq` —
      sort by `(occurred_at, seq)` and assert order matches submission order.
- [x] 2.4 Backend/pipeline test: build a small counter dataset (a handful of rows with known deltas), run an
      `aggregate`/`sum` step over `delta` through the real pipeline engine (not a hand-rolled arithmetic check),
      and assert the result equals the true running total — independent of whatever `value` cells are stored
      (include at least one row where `value` is absent/null and one where a stale/wrong `value` was supplied, to
      prove the aggregate genuinely ignores `value` rather than coincidentally agreeing with it).
- [x] 2.5 Backend test: no code path performs an `UPDATE` on an existing `dataset_rows` row as part of a counter
      submission — assert via row `id`/`updated_at` stability across submissions (every prior row's `id` and
      `updated_at` unchanged), not merely "a new row appeared."
- [x] 2.7 Backend/pipeline test: build a pipeline Output over a counter dataset ordered by `(occurred_at, seq)`
      and assert the Output reflects one point per submitted event in submission order (spec scenario "A
      time-series Output renders the append sequence") — reuse the same real-pipeline-engine approach as 2.4
      rather than asserting against a hand-built row list.
- [x] 2.6 Confirm (read `MISTAKES.md` first, C7/C8 constraints) whether an existing e2e/UI test framework can
      exercise the submit path end-to-end for a counter-configured panel via `POST /api/panels/:id/submit`
      directly (no UI chrome exists yet — HEL-1088). If yes, add one; if only a plain integration test is
      feasible without the chrome, note that explicitly in the evaluator/skeptic evidence rather than silently
      skipping coverage.

## 3. Documentation / drift surfaces

- [x] 3.1 Update `schemas/panels/panel.schema.json`'s `FormFieldConfig.properties.control.enum` (lines ~211-213)
      to include `"counter"` alongside the existing seven controls.
- [x] 3.2 Update `CLAUDE.md`'s `POST /api/panels/:id/submit` row if its shape changes in an observable way for
      callers (it does not add a new endpoint — verify no update is actually needed, or make the update).
