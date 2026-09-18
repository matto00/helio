## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS
Unchanged from cycle 1 (backend untouched); cycle 2's fix is scoped entirely to the frontend
runtime-render gap flagged in evaluation-1.md's Change Request 1. No new AC-relevant scope
introduced. No regression to the domain model reviewed in cycle 1.

### Phase 2: Code Review — PASS

**Fix reviewed:** `ad72c146` on top of `cba321b1` (evaluation-1.md's reviewed commit).
- `frontend/src/features/panels/ui/form/FormFieldControl.tsx:155-176` — adds `case "counter":`
  to the `renderControl` switch: a plain numeric `TextField` (`type="number"`, integer/float step
  inference mirroring the existing `"number"` case), `aria-required="true"` unconditionally (not
  derived from the `required` prop) — correctly reflecting that a counter's delta is always
  required regardless of `field.required`/`declared.required`.
- `frontend/src/features/panels/state/formFieldValidation.ts` — `isFieldRequired` now returns
  `true` unconditionally for `field.control === "counter"`, mirroring the backend's
  `FormSubmission.buildRow`'s own unconditional override (`FormSubmission.scala`: `required =
  configRequired || declared.required || field.control == "counter"`). `validateFieldValue`
  extends its numeric-parse branch to also cover `"counter"`, so a non-numeric typed value is
  caught client-side the same way `"number"` already is.
- New test coverage (`FormFieldControl.test.tsx`, `formFieldValidation.test.ts`) exercises the
  new branch and the `isFieldRequired`/`validateFieldValue` changes.
- The stale "all seven controls" doc comment noted in evaluation-1.md was not explicitly touched,
  but is a cosmetic nit, not something that reopens the FAIL — no change request reissued for it.

**Gates (fresh run, this worktree):**
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (28/28 mcp suites, 271 tests; 332/332 frontend suites, **3613/3613** tests,
  matching the executor's reported count exactly)
- `npm --prefix frontend run build` — PASS
- Backend untouched this cycle (`git diff cba321b1...HEAD --stat` touches only frontend + this
  evaluation report) — re-running `sbt test` was unnecessary; cycle 1's fresh 4701/4701 green run
  against the reviewed backend commit (`cba321b1`, unchanged since) still stands as current
  evidence for that surface.

**Live verification (not just unit tests) — done in the running app, not merely trusted:**
1. Created a new "Manual" dataset (`eval-counter-src`) via the Data Sources UI with fields
   `delta` (integer, required), `occurred_at` (timestamp, required), `value` (integer, not
   required) — the exact row shape the AC requires.
2. Added a `form` panel bound to it via the dashboard "Add panel" flow, added the `delta` field,
   and set its Control dropdown to `counter` (confirmed the dropdown genuinely lists `"counter"`
   as a real, selectable option today, per evaluation-1.md's finding).
3. Saved the panel. The rendered runtime panel now shows a real `spinbutton "delta"` (a
   functional numeric input) — **not** the empty `<div>` evaluation-1.md documented.
4. Typed `1` into the field and clicked Submit. Result: `status: "The row was added."` — a
   genuinely successful end-to-end submission through the real HTTP route, not a mock.
5. `browser_console_messages` (warning level, all messages) — 0 errors, 0 warnings across the
   whole flow.

This closes evaluation-1.md's Change Request 1 for real: the counter control is now genuinely
fillable and submittable in the currently-shipped UI, not merely legal-but-broken.

### Phase 3: UI Review — PASS
- Servers verified healthy (`assert-phase.sh servers` → PASS, same worktree/ports as cycle 1).
- Live counter-field flow (above) is a real happy-path exercise: field renders, accepts input,
  submits successfully, no console errors.
- No other UI regressions observed — the pre-existing `eval-file-src` form panel (file control)
  remained rendered and unaffected throughout.
- Accessible name and required-state wiring (`aria-required="true"`) reviewed directly in the
  diff and matches the always-required semantics confirmed in Phase 2.

### Overall: PASS

### Non-blocking Suggestions
- `frontend/src/features/panels/ui/form/FormFieldControl.tsx:1-4`'s header comment ("all seven
  controls") is now stale at eight controls (counter makes eight) — a one-line comment update,
  not blocking.
