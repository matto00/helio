# Mutation evidence

## Backend — C7/C8: no-write-on-rejection (`FormSubmission.buildRow`'s D3(v) required check)

**Guard under test:** design.md D3(v) — a configured field that is required (form `required: true`
OR the dataset's own declared `required`) with no supplied value is rejected with `400` and
`fieldErrors`, and the append writes nothing (proven by a row count before/after, never a `400`
alone — C8).

**Cycle-1 finding, corrected in cycle 2 (evaluation-1.md CR2):** `FormSubmission.buildRow`
enforces "required" in two places — a per-field check (layer 1, the early
`if (required) Left(...)` branch) and, separately, `DatasetRowValidator`'s own `required` check on
the row `buildRow` hands it (layer 2). Cycle 1 mutated layer 1 alone, stayed GREEN, and wrongly
concluded from that green run that the guard was "load-bearing at either layer" — that conclusion
did not follow: no test at the time observed layer 1 in isolation, because every FORM-tightened
required field (the only case then under test) is COPIED into `effectiveDeclaration` with
`required = true, default = None` before layer 2 runs — layer 2 alone already rejects that case,
so layer 1's own check was never exercised.

**The distinguishing case (added this cycle):** a field the DATASET declares `required: true`
**with a declared default**, configured by the form but with no form-level `required` override.
This field is never form-required, so it is never copied into `effectiveDeclaration`'s
required-copy — layer 2 sees `required = true, default = Some(v)` exactly as declared, and
`DatasetRowValidator.validateRowStructured`'s own logic (`case Some(d) => Right(d)`, checked
BEFORE the `required` branch) fills the default and returns `201`. Only layer 1's own check,
evaluated before any row is even built, rejects it. Added to both `FormSubmissionSpec` ("reject a
declared-required field with a declared default, left unsupplied — layer 1's own check, not layer
2's") and `FormSubmitRoutesSpec` ("reject a declared-required field with a declared default, left
unsupplied — layer 1's own check", with a row-count assertion).

**Command:**
```
cd backend && sbt "testOnly com.helio.domain.panels.FormSubmissionSpec com.helio.api.routes.panels.FormSubmitRoutesSpec"
```

**Mutation 1 ALONE, re-run with the new distinguishing tests in place — `FormSubmission.scala`'s
per-field `supplied.isEmpty` branch:**
```scala
if (supplied.isEmpty) {
  if (required) Left(FieldError(field.sourceField, "required"))
  else Right(None)
}
```
changed to:
```scala
if (supplied.isEmpty) {
  Right(None)
}
```

**RED (mutation 1 alone):**
```
[info] - should collect multiple errors across different fields, not short-circuit on the first *** FAILED ***
[info]   Left(Vector(FieldError("bogus", "not part of this form"), FieldError("status", "not one of the configured options"))) was not equal to
[info]   Left(Vector(FieldError("bogus", "not part of this form"), FieldError("quantity", "required"), FieldError("status", "not one of the configured options")))
[info] - should reject a declared-required field with a declared default, left unsupplied — layer 1's own check, not layer 2's *** FAILED ***
[info]   Right(Vector("open")) was not equal to Left(Vector(FieldError("status", "required")))
[info] - should reject a declared-required field with a declared default, left unsupplied — layer 1's own check *** FAILED ***
[info]   201 Created was not equal to 400 Bad Request (FormSubmitRoutesSpec.scala:314)
[info] Total number of tests run: 36
[info] Tests: succeeded 33, failed 3, canceled 0, ignored 0, pending 0
[info] *** 3 TESTS FAILED ***
```
Both new distinguishing tests (unit + route) go red on mutation 1 ALONE, plus one pre-existing
"collect multiple errors" unit test that incidentally also exercises a form-required field with no
declared default (where layers 1 and 2 happen to coincide) — this is exactly what makes layer 1
independently observed now: dropping ONLY the per-field check, with no change to layer 2, produces
a real failure.

**Restore + GREEN:**
```
cd backend && sbt "testOnly com.helio.domain.panels.FormSubmissionSpec com.helio.api.routes.panels.FormSubmitRoutesSpec"
...
Total number of tests run: 36
Tests: succeeded 36, failed 0, canceled 0, ignored 0, pending 0
All tests passed.
```

**Revised conclusion:** the two layers are NOT redundant — layer 1 catches a declared-required
field with a declared default (which layer 2 alone would silently default-fill and accept); layer
2 catches every other required violation, including ones layer 1 alone would miss if it were the
only check (e.g. an UNCONFIGURED declared-required field with no default, which layer 1's
per-field loop never even visits, since it only iterates `config.fields`). Both mutated cases
assert a repository row count of `0` both before AND after the rejected submit
(`rowCount(src) shouldBe 0`), never inferring "nothing written" from the `400` alone — C8.

## Frontend — C7: preserved input on rejection (`FormPanelView`'s two rejection branches)

**Guard under test:** design.md D8 — on any rejection (client-side, `400` field errors, or
transport), every control keeps the value the user entered; `reset()` runs only on success.

**Mutation:** in `frontend/src/features/panels/ui/form/FormPanelView.tsx`'s `handleSubmit`,
added `values.reset();` at the end of BOTH `catch` sub-branches (the server-field-error branch and
the transport/non-field-error branch) — the exact defect this guard exists to prevent.

**Command:**
```
cd frontend && npx jest --config jest.config.cjs --testPathPatterns=FormPanelView
```

**RED (mutated):**
```
FAIL src/features/panels/ui/form/FormPanelView.test.tsx
  ● FormPanelView › associates a 400 field error with its control, shows the alert, and preserves values
    expect(element).toHaveValue(hello)
    Expected the element to have value: hello
    Received:

  ● FormPanelView › a network error announces, preserves values, and leaves focus on the submit button
    expect(element).toHaveValue(hello)
    Expected the element to have value: hello
    Received:

Test Suites: 1 failed, 1 total
Tests:       2 failed, 10 passed, 12 total
```
Exactly the two preserved-input tests go red; every other test (success/reset, client-side block,
double-activation, Enter-submits, unrendered-field-focus) stays green — the mutation is scoped to
the two rejection branches and nothing else observes it.

**Restore + GREEN:**
```
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
```

## Frontend — evaluation-1.md CR1: repeated identical client-blocked failure must re-announce

**Guard under test:** `specs/form-panel-submit/spec.md` — "Regions SHALL be emptied when the next
attempt starts." A user pressing Submit twice on an unchanged, still-invalid form must produce a
SECOND observable DOM text mutation on the assertive region, or a screen reader announces nothing
on the second attempt.

**Root cause (systematic-debugging.md, probe-confirmed by the evaluator, reproduced here):** on
the client-blocked path, `setAlertText("")` and `setAlertText(summary)` both run synchronously in
the same React event-handler invocation, so React batches them into ONE commit whose final DOM
value is `summary`. When `summary` is identical to the text already on screen (the common
repeated-failure case), the region's DOM text never changes between the two attempts — no
`characterData`/`childList` mutation for an observer (or a screen reader) to pick up.

**Fix:** `handleSubmit`'s leading `setAlertText("")`/`setStatusText("")` now run inside
`flushSync(() => { ... })` (from `react-dom`), forcing that clear to commit to the DOM as its own
render BEFORE any new text is set — on every path, not only the async ones (which already
naturally committed their own clear before the subsequent `await`).

**Command:**
```
cd frontend && npx jest --config jest.config.cjs --testPathPatterns=FormPanelView -t "SECOND identical"
```

**RED (mutation: reverted `flushSync` to a plain `setAlertText("")`/`setStatusText("")`, i.e. the
pre-fix code):**
```
FAIL src/features/panels/ui/form/FormPanelView.test.tsx
  ● FormPanelView › mutates the alert region's DOM text on a SECOND identical client-blocked submit (CR1)
    Timed out retrying after 1000ms: expect(observed.length).toBeGreaterThan(0)
    Expected: > 0
    Received: 0
Test Suites: 1 failed, 1 total
Tests:       1 failed, 12 skipped, 13 total
```
A `MutationObserver` on `.form-panel-view__alert` recorded ZERO mutations after the second
identical failing submit — exactly the defect CR1 names.

**Restore (`flushSync`) + GREEN:**
```
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```
Every other `FormPanelView` test (success/reset, single-attempt client block, server field errors,
transport failure, double-activation, Enter-submits) stays green — the fix and its regression test
are scoped to the repeated-identical-failure case CR1 identified.
