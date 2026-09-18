# Mutation evidence

## Final-gate round 1 — skeptic-final-1.md CR1: error-to-control ARIA association (C8, frontend)

**Root cause (systematic-debugging.md):** design.md D7 promises `aria-invalid`/`aria-describedby`
on an invalid control, in addition to the `FormField`'s `role="alert"` error paragraph. The shared
`frontend/src/shared/ui/FormField.tsx` (pre-existing, untouched until this fix) rendered its error
`<p>` with no `id` and offered no way for a caller to reference it; `FormFieldRow.tsx` passed
`error={error}` into `FormField` but never wired `aria-invalid`/`aria-describedby` onto the control
it wraps. Live-measured by the skeptic: `document.querySelectorAll('[aria-invalid="true"]')`
returned an empty NodeList across the whole open builder with an orphaned-field error visibly
showing — `role="alert"` is a one-shot live-region announcement, not a durable programmatic
association a screen-reader user tabbing directly to the control can discover.

**Fix:** `FormField.tsx` gained an `errorId` prop (falls back to an internally `useId()`-generated
id when omitted, so every pre-existing call site's behavior — none of which reference the error
`<p>`'s id — is unchanged) and now stamps that id onto the error `<p>`. `Select.tsx` (also shared,
also pre-existing) gained `ariaInvalid`/`ariaDescribedBy` passthrough props onto its trigger button
(previously absent — the trigger had no way to carry either attribute at all).
`FormFieldRow.tsx` generates one `useId()`-derived id per row and threads it as both
`FormField`'s `errorId` and the sourceField `Select`'s `ariaDescribedBy`, plus
`ariaInvalid={Boolean(error)}`.

**C8 (new standing constraint, promoted from this verdict):** error-to-control association must be
asserted by computed ARIA state (`aria-invalid="true"` on the control, `toHaveAccessibleDescription`
resolving to the error text) — never by a `role="alert"` node's mere presence. Both prior review
cycles (evaluation-1.md, evaluation-2.md) checked `role="alert"` presence and the error TEXT, but
never checked the specific `aria-invalid`/`aria-describedby` wiring design.md D7 committed to — this
is precisely the gap C8 exists to close going forward.

**Command:** `npx jest FormFieldRow.test.tsx` (run from `frontend/`)

**RED (mutated `FormFieldRow.tsx`'s `ariaInvalid={Boolean(error)}` to `ariaInvalid={false}` —
`aria-describedby` was left correctly wired, isolating the assertion to the `aria-invalid` half):**
```
FAIL src/features/panels/ui/editors/FormFieldRow.test.tsx
  ● FormFieldRow › marks the sourceField control aria-invalid and describes it by the error text (C8)

    expect(element).toHaveAttribute("aria-invalid", "true")

    Expected the element to have attribute:
      aria-invalid="true"
    Received:
      null

Test Suites: 1 failed, 1 total
Tests:       1 failed, 9 passed, 10 total
```

**Restore + GREEN:**
```
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

Regression suite run after the fix (unaffected call sites): `FormField.test.tsx` (8),
`Select.test.tsx` (10, both pre-existing, both green — the `errorId`/`ariaInvalid`/
`ariaDescribedBy` props are all optional and additive) plus `FormEditor.test.tsx` (5).

## Cycle 2 — evaluation-1.md CR1: focus after Remove (frontend)

**Root cause (systematic-debugging.md):** `FormEditor.tsx`'s field-row `.map()` used `key={index}`
and `onRemove` had no explicit focus call except for the empty-list case. Removing a row that was
NOT the DOM-last row happened to "work" only because React reconciled the same button DOM node
(same `key`) into the next field's shifted-up position — an artifact of keying strategy, not
intentional focus management. Removing the LAST row of a 2+-field list has no surviving DOM node
to reconcile into (nothing shifts into a position past the end of the array), so focus fell to
`document.body`. Confirmed live by the evaluator (cycle 1, Phase 3 UI review, Playwright):
`document.activeElement` was `<body>` after removing the last field of a 2-field list.

**Fix, two parts:**
1. `useFormEditorState.ts` now tracks a `rowIds: string[]` array parallel to `fields`, assigned
   once per row at add/reset time and updated in lockstep on remove/move — never derived from
   array index or from `sourceField` (which can collide on an orphaned/duplicate stored config).
   `FormEditor.tsx`'s row `.map()` now keys on `editor.rowKeys[index]`, so DOM node identity no
   longer depends on incidental array-index reuse.
2. `focusTargetIndexAfterRemove(removedIndex, newLength)` (pure, exported from
   `useFormEditorState.ts`) computes the correct post-removal focus target — `null` (focus the Add
   control) when the list is now empty, else `Math.min(removedIndex, newLength - 1)` (the row that
   now occupies the removed position, or the new last row when the removed row was last).
   `FormEditor.tsx`'s `onRemove` calls this BEFORE dispatching the removal and explicitly focuses
   that row's first control via a `pendingFocusRowIndex` effect (mirroring the existing
   `focusNewRow` effect's deferred-microtask pattern) — no longer relying on any DOM-reuse
   accident.

**Why jsdom cannot be the evidence for this class of defect (C6):** the underlying defect IS
React's real reconciliation choosing which DOM node to keep vs. destroy based on `key` — jsdom
runs real React reconciliation against a real (if synthetic) DOM, so in principle a jsdom test
COULD reproduce the wrong-node-reused symptom. What jsdom cannot be trusted for is asserting the
CONSEQUENCE (`document.activeElement`) as proof of correct behavior in this repo's test
environment/harness (per this run's binding C6 and MISTAKES.md) — a jsdom `toHaveFocus()`/
`document.activeElement` assertion is not accepted as evidence here, only a rendered/Playwright
measurement is. This is why the regression test added below is a **pure-function** unit test
(`focusTargetIndexAfterRemove`) proving the TARGET INDEX computation is correct for every edge
case (list-emptying remove, middle-row remove, last-of-2+ remove — the exact defect case), plus a
`rowKeys` structural test proving row identity travels with the row through move/remove — not a
jsdom focus assertion. The actual `document.activeElement` claim still requires a rendered
(Playwright) re-verification by the evaluator/skeptic, same as cycle 1's original finding.

**Command:** `npx jest useFormEditorState.test.ts` (run from `frontend/`)

**RED (mutated `focusTargetIndexAfterRemove` to `return removedIndex;`, i.e. the actual pre-fix
defect's effective behavior — targeting the removed row's own now-out-of-bounds index instead of
clamping to the new last row):**
```
FAIL src/features/panels/ui/editors/useFormEditorState.test.ts
  ● focusTargetIndexAfterRemove › targets the new last row when the removed row WAS the last of 2+ (the defect case)

    Expected: 0
    Received: 1

Test Suites: 1 failed, 1 total
Tests:       1 failed, 14 passed, 15 total
```

**Restore + GREEN:**
```
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

## Task 4.4 — C2: the `update` effective-config hook (backend)

**Mutation.** In `backend/src/main/scala/com/helio/services/panels/PanelService.scala`'s
`update`, replaced the call `rejectInconsistentForm(effectiveFormConfig(existing, spec), user)`
with `Future.successful(Right(()))` — the schema-consistency check no longer runs on PATCH at all.

**Command:**
```
cd backend && sbt "testOnly com.helio.api.routes.panels.FormPanelRoundTripSpec"
```

**RED (mutated) — the re-bind test fails, every other test (including the create-time
consistency tests) stays green:**
```
[info] - should reject a form bound to a csv-kind source, naming csv
[info] - should reject an undeclared sourceField, naming it
[info] - should reject checkbox on a declared string field, naming the fitting controls
[info] - should accept text on a declared integer field
[info] - should reject wrongly typed options, naming the offending value
[info] - should reject empty-array options
[info] - should reject non-array options
[info] - should reject a wrongly typed initialValue on a timestamp field
[info] - should reject a PATCH that re-binds dataSourceId only to a dataset lacking an existing field — panel unchanged *** FAILED ***
[info]   200 OK was not equal to 400 Bad Request (FormPanelRoundTripSpec.scala:269)
[info] - should accept a config whose every field is declared, fits, and carries valid typed options/initialValue
...
[info] Total number of tests run: 21
[info] Tests: succeeded 20, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

**Why exactly this test goes red and no other**: every create-time consistency test (csv-bound,
undeclared field, unfit control, bad options, bad initialValue) goes through `buildForCreate`,
which still calls `rejectInconsistentForm` unconditionally — the mutation only touched the
`update` call site. Only the PATCH re-bind test exercises the mutated path: it PATCHes
`dataSourceId` alone to a dataset lacking the panel's existing `quantity` field, which is exactly
what C2 exists to catch (a `dataSourceId`-only PATCH must still re-validate existing fields against
the new dataset) — with the hook removed, the PATCH silently succeeds.

**Restore + GREEN:**
```
cd backend && sbt "testOnly com.helio.api.routes.panels.FormPanelRoundTripSpec"
...
[info] Total number of tests run: 21
[info] Tests: succeeded 21, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

## Task 4.5 — C4: the control-fitness drift guard (frontend)

`frontend/src/features/panels/state/controlFitnessDriftGuard.test.ts` — mutated
`CONTROL_FITNESS.string` in `formConfigValidation.ts` from
`["text", "textarea", "select"]` to `["text", "textarea"]` (dropping `"select"`).

**Command:** `npx jest controlFitnessDriftGuard` (run from `frontend/`)

**RED (mutated):**
```
    Object {
-     "string": Array [
-       "text",
-       "textarea",
-       "select",
-     ],
+     "string": Array [
+       "text",
+       "textarea",
+     ],
      ...
    }
  ● CONTROL_FITNESS matches FormPanel.scala's FittingControls in content and order (C4) › mirrors every entry, in order
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
```

**Restore + GREEN:**
```
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

## Task 4.11 — C5: `PanelDetailModal`'s if-chain arms (frontend)

`frontend/src/features/panels/ui/detailModal/PanelDetailModal.test.tsx` — removed the
`isFormPanel` arm from `renderSubtypeEditor` (one of the two if-chains task 3.4 added; both are
if-chains, not switches — not typecheck-protected, C5), so a `form` panel fell through to
`return null` again, matching HEL-1083's original (pre-this-ticket) shape.

**Command:** `npx jest PanelDetailModal.test` (run from `frontend/`)

**RED (mutated — `renderSubtypeEditor`'s `isFormPanel` arm removed):**
```
FAIL src/features/panels/ui/detailModal/PanelDetailModal.test.tsx
  ● PanelDetailModal — form panel › renders the form builder as the kind-specific section, not an empty body

    Unable to find role="heading" and name "Form"
```

**Restore + GREEN:**
```
Test Suites: 1 passed, 1 total
Tests:       38 passed, 38 total
```
