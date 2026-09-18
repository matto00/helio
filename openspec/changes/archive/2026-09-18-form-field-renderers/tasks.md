## 1. Backend

- [x] 1.1 Add `PanelKind.Form -> ClampBounds(minW = 3, minH = 5, maxH = 24)` to `PanelPacker.Bounds`; verify `sbt "testOnly *PanelPackerSpec*"` passes with the new form-clamp case (task 4.1)

## 2. Frontend — shared primitives

- [x] 2.1 Extend `TextField`'s `type` union with `"date"`; verify `npm run typecheck` passes and a date-typed field renders `input[type=date]`
- [x] 2.2 Add `hintId?: string` to `FormField` (applied to the hint `<p>`, never to the error); verify existing `FormField.test.tsx` still passes and a new case asserts the hint `<p>` carries the id
- [x] 2.3 Add `ariaRequired?: boolean` to `Select` (→ `aria-required` on the trigger); verify a test asserts the trigger's computed `aria-required`
- [x] 2.4 Add `ariaInvalid`/`ariaDescribedBy`/`ariaRequired` to `Toggle` (→ the native input); verify a test asserts computed `aria-invalid` and `toHaveAccessibleDescription` on the switch

## 3. Frontend — form rendering

- [x] 3.1 Create `state/formFieldValidation.ts` (D5: required-empty, integer/float typing via `parseTypedValue`/`isValidTypedValue`, message naming the label); verify unit tests in task 4.2
- [x] 3.2 Create `ui/form/useFormPanelValues.ts` (D6: seed from `initialValue`, touched/errors, `setValue`/`touch`/`reset`, re-seed on field-list change); verify unit tests in task 4.3
- [x] 3.3 Create `ui/form/FormFieldControl.tsx` (D3/D4: control switch inside `FormField`, control id via `useId`, `required`/`aria-invalid`/`aria-describedby` wiring, issue/`file` surfacing per D7); verify RTL tests in task 4.4
- [x] 3.4 Create `ui/form/FormPanelView.tsx` + `FormPanel.css` (D2 schema fetch with skeleton/`InlineError`+Retry; `<form aria-label={title}>` with prevented submit; no submit button); verify RTL tests in task 4.5
- [x] 3.5 Create `ui/renderers/FormRenderer.tsx` and point `PanelContent.tsx`'s `form` branch at it, keeping "Form not configured" for empty fields and correcting the D10 comment; verify `PanelContent.test.tsx` form case (task 4.6)
- [x] 3.6 Add `.panel-content--form` to `PanelContent.css` (D8: F-038 scroll recipe, column stack, gap, textarea min-height, `@container panel-card (max-height: 179px)` density); verify visually against the running app in BOTH themes and record screenshots under the run's evidence
- [x] 3.7 Run `npm run lint`, `npm run typecheck`, `npm run format:check`; verify all three exit zero

## 4. Tests

### Backend
- [x] 4.1 `PanelPackerSpec`: `clamp("form", 1, 2, 12)` yields `(3, 5)`; verify RED with the `Bounds` entry removed (record the mutation), then GREEN

### Frontend
- [x] 4.2 `formFieldValidation.test.ts`: required-empty (config flag and declared flag), integer non-integer, float NaN, valid values → no error; verify `npm test -- --testPathPatterns=formFieldValidation`
- [x] 4.3 `useFormPanelValues.test.ts`: prefill from `initialValue`, control-appropriate empties, touched gating, `reset`, re-seed on field-list change; verify via `npm test`
- [x] 4.4 `FormFieldControl.test.tsx`: for each of the six controls `getByRole(role, {name})` + `toHaveAccessibleName` (label and sourceField fallback), `toHaveAccessibleDescription(helpText)`, required-empty on blur → `aria-invalid="true"` + `toHaveAccessibleDescription(error)`, correction clears, no error before blur, `aria-required` from declared-required, select lists exactly the typed options, `file`/orphaned/unfit/bad-options surfaced with label + description; verify via `npm test` — NO `getByText`/presence-only assertion for any of these claims (C1)
- [x] 4.5 `FormPanelView.test.tsx`: skeleton while loading, `InlineError` + Retry on failure (retry re-fetches), fields render in authored order after load, Enter in a text field does not submit; verify via `npm test`
- [x] 4.6 `PanelContent.test.tsx`: a configured form panel dispatches to `FormRenderer`, an empty one renders "Form not configured"; verify RED with the `isFormPanel` branch removed (record the mutation), then GREEN (C4)
- [x] 4.7 `PanelDetailModal.test.tsx`: view mode of a form panel renders the form fields (D1); verify via `npm test`

### E2E (real browser, C1)
- [x] 4.8 `e2e/hel1085-form-field-renderers-keyboard.spec.ts` (D9): seed dataset + dashboard + form panel via API, Tab through all six controls completing each by keyboard only, assert `toHaveAccessibleName`/`toHaveAccessibleDescription` per control, blur an empty required field → `aria-invalid="true"` + error description, capture light and dark screenshots; verify with `DEV_PORT=<port> npx playwright test e2e/hel1085-*.spec.ts` against this run's servers, teardown in `finally`
- [x] 4.9 Full gates: `npm test`, `npm run lint`, `npm run typecheck`, `sbt test` (backend), then commit with `timeout: 600000` (C2); verify Husky exits zero

## 5. Fold-in — MISTAKES.md trap entries (Phase 4 follow-up; design.md D11; docs-only)

### Docs
- [x] 5.1 Add the "`git commit` without a ~600000 ms tool timeout is backgrounded mid-hook" entry under `## Tooling`, immediately after the epic-cascade entry (D11a: what the chain runs, the failure shape, recovery via `await-sentinel.sh` on `.git/worktrees/<name>/COMMIT_EDITMSG`, never re-run mid-hook, HEL-1087 evidence); verify `npm run format:check` exits zero and `grep -c 'backgrounded mid-hook' MISTAKES.md` is 1
- [x] 5.2 Add the "unanchored `pgrep -f` poll matches itself" entry immediately after 5.1's (D11b: mechanism, the leaked shell holding the worktree open against `cleanup.sh`, anchored pattern or `await-sentinel.sh`, seven-hit field evidence); verify `npm run format:check` exits zero and `grep -c 'matches itself' MISTAKES.md` is 1
- [x] 5.3 Confirm the diff against the live merge base (`scripts/concertino/resolve-review-base.sh`) touches only `MISTAKES.md` and `openspec/changes/form-field-renderers/**`, then commit with `timeout: 600000` (C2); verify Husky exits zero and `git diff --stat <base>...HEAD` lists no other path

## Standing Constraints

- [C1] A11y claims are asserted by computed accessible name/description and computed ARIA state (`aria-invalid="true"`, `toHaveAccessibleDescription`), never by DOM/role presence; focus, visibility and size claims need Playwright measurement against the running app — jsdom is not evidence. (HEL-1084 C6+C8, driver brief.)
- [C2] Every `git commit` carries an explicit 600000 ms tool timeout and is never re-run mid-hook; no bespoke poll shells — anchored `pgrep` patterns (`pgrep -c -f '^bash .*<script>'`) or `await-sentinel.sh` only.
- [C3] Never silently drop or coerce a config field: an orphaned, unfit, malformed-options or `file` field renders its label and a visible, associated reason.
- [C4] If-chain dispatch sites (`PanelContent`) are not typecheck-protected — enumerate by hand and prove by mutation.
- [C5] The merge gate is ruleset `ci-complete` present AND SUCCESS plus `mergeStateStatus` CLEAN; `check-pr-mergeable.sh`'s empty-rollup pass (CON-207) is not the gate; never `gh pr merge --auto`.
- [C6] DESIGN.md is binding for `frontend/**`: tokens only, shared primitives, and visual cohesion compared against the running app in both themes.
