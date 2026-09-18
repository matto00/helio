## 1. Counter control chrome

- [x] 1.1 Replace `FormFieldControl.tsx`'s `case "counter"` placeholder `TextField` with compact value/`+`/`-`
      chrome, computed ARIA state (`role="spinbutton"`, `aria-valuenow`, `aria-valuetext` naming the step,
      `aria-valuemin`/`aria-valuemax` where applicable), keyboard operability (Enter/Space on `+`/`-`, ArrowUp/
      ArrowDown on the control itself).
- [x] 1.2 Give the counter control an `immediate: boolean` mode (design.md Decision 1/2): when `immediate` (the
      compact single-field layout), `+`/`-`/arrow-key activation calls the existing `handleSubmit` path right
      away with `{delta: ±step}`; when not `immediate` (embedded in a multi-field form), activation only updates
      the field's local value — no submit call, participates in the form's single existing Submit button like
      any other field.
- [x] 1.3 For the `immediate` path only: optimistically update the displayed value by `±step` before the submit
      resolves; revert that same `±step` on a rejected/failed submit (design.md Decision 3) — this is an
      explicitly cosmetic, session-local tally, never read from or trusted as a server response value.
- [x] 1.4 Correct `FormFieldSpec.step`'s comment in `panel.ts` — no longer number-only/superseded; valid for
      `number` and `counter`, `counter` defaults to `1` when absent.

## 2. Compact single-field layout

- [x] 2.1 Add the `fields.length === 1 && fields[0].control === "counter"` render branch: compact chrome fills
      the panel body (rendered with `immediate: true`), no separate submit button.
- [x] 2.2 The compact layout's saved config SHALL always carry `submit.resetOnSuccess: false` (design.md
      Decision 3) — enforce this when the builder persists a single-counter-field form, not as a user-facing
      toggle. Verify this specifically: a single-counter form saved through the builder never carries
      `resetOnSuccess: true`/absent.
- [x] 2.3 Verify every other field-count/shape boundary keeps the standard layout (rendered with
      `immediate: false` for any counter field present): zero fields ("Form not configured"), one non-counter
      field, 2+ fields including one counter — write explicit test cases for each, not just the happy path
      (this is the exact defect shape HEL-1089's evaluator caught for a different control: a silent fallthrough
      rendering nothing).
- [x] 2.4 Verify a counter embedded in a multi-field form never triggers a premature whole-form submit: activate
      its `+`/`-` while a sibling field holds an invalid/in-progress value and confirm no request is sent and
      the sibling field is not marked touched/invalid as a side effect of the counter click (skeptic-design-1.md
      CR2's exact hazard).

## 3. Author-time step configuration

- [x] 3.1 `form-panel-builder`: show the step input for `control: "counter"` fields (currently `number`-only),
      persist `step` on save.
- [x] 3.2 Update the author-time mismatch check ("`step` on a non-number control is an error") to allow `step` on
      `counter` too.

## 4. Verification

- [x] 4.1 Mutation-prove (C7) that `+`/`-` actually submits the configured step as a delta: mutate the step
      handling (e.g. hardcode delta to a wrong constant) and confirm the relevant test goes red, then restore.
- [x] 4.2 Mutation-prove computed ARIA exposure is real, not vacuous: assert against the live accessibility tree
      (Playwright snapshot / computed role+value), not DOM attribute presence alone (C8 — MISTAKES.md HEL-1084
      precedent).
- [x] 4.3 Verify a rejected/failed increment writes nothing: row counts before/after against the bound
      `dataSourceId` only (standing write-path caution from the ticket).
- [x] 4.4 Verify keyboard-only operability end-to-end for the compact layout (Tab reaches the control, Enter/
      Space/ArrowUp/ArrowDown all increment or decrement, focus never traps).
- [x] 4.5 Compare the compact chrome against the running app in both light and dark theme (DESIGN.md binding);
      confirm token/spacing compliance and visual cohesion, not just presence of the controls.
- [x] 4.6 If `PanelPacker` clamp bounds are changed for this layout, add the corresponding spec/test case; if
      unchanged, state explicitly that the existing `minW=3,minH=5,maxH=24` clamp was evaluated and kept.

## 5. Docs

- [x] 5.1 Update `CLAUDE.md`'s counter-field API-contract entry (added by HEL-1089) if this change affects any
      client-observable contract detail (it should not — verify and note explicitly either way).
