## Context

- `FormPanel.css:5-10`: `.form-panel-view__fields` is `display: flex; flex-direction: column; gap: var(--space-3)`
  (12 px; `--space-2` under the `panel-card` container query at `PanelContent.css` max-height 179px). Its children, in
  `FormPanelView.tsx:420-470`, are the field controls, then `<p role="alert" class="form-panel-view__alert">`, then
  `<p role="status" class="form-panel-view__status">`, then the Submit button. Two empty zero-height flex items add two
  extra gaps between the last field and Submit.
- HEL-1804 (`CounterControl.css:38-53`) solved the same thing for `.form-panel-view__compact-counter`: the layout is
  `position: relative` and `> :is(alert, status):empty { position: absolute }`. Its guard test is
  `CounterControl.css.test.ts`; its real proof is `e2e/hel1791-compact-counter-stack-height.spec.ts`.
- Scope addition: `handleImmediateStep` (`FormPanelView.tsx:177-292`). A definite rejection calls
  `values.setExternalErrors({[field]: message})`. A success calls `values.setExternalErrors({})`. The indeterminate
  branch only calls `reconciliationTail(onReconcileFailed)`, whose success path applies the aggregate via
  `values.reconcileValue`, which by design (HEL-1169 D3a, `useFormPanelValues.test.ts:131`) never clears errors. Each
  click starts with `setAlertText("")`, and the counter's `errorDescriptionId` is the alert's id (HEL-1818), so a
  stale error leaves the control `aria-invalid`, red (`CounterControl.css:27`), with an empty description.

## Goals / Non-Goals

**Goals:** no blank band below the last field in a multi-field form while both regions are empty; messages still
render in flow and are announced from the same mounted elements; a stale cross-burst rejection error is cleared when
a later no-response burst reconciles successfully.

**Non-Goals:** HEL-1618 (min-height clipping); compact counter layout; any change to the success or rejection branches'
existing error handling; any change to `useFormPanelValues`.

## Decisions

### D1 — Same CSS pattern as HEL-1804, scoped to direct children of the field stack

Add `position: relative` to `.form-panel-view__fields` and a new rule
`.form-panel-view__fields > :is(.form-panel-view__alert, .form-panel-view__status):empty { position: absolute; }` in
`FormPanel.css`. An absolute element with auto offsets sits at its static position, is shrink-to-fit (zero size while
empty), and takes no flex slot. Its 0x0 box sits at the form's content-box start (over the first field's label), which is harmless; the CSS
comment says so, so nobody "fixes" it. `:empty` stops matching once React writes the text node, so the region returns to
flow. No `display`/`visibility` change keeps it in the accessibility tree. The child combinator keeps the compact
counter's own rule (`.form-panel-view__compact-counter > ...`) the only rule for that layout: the compact regions are
children of `.form-panel-view__compact-counter`, not of `.form-panel-view__fields`.
Before relying on `position: relative`, the executor greps the form subtree (`FormFieldControl.tsx` and the
`components/ui` controls it renders) for absolutely positioned descendants whose containing block would move; any hit
is reported in `files-modified.md` with why it is unaffected or escalated.
Alternative rejected: conditional mounting or `display: none` — loses the pre-mounted live region (HEL-1087 D8).

### D2 — Clear a stale field error on a successful indeterminate reconcile, guarded per burst

`reconciliationTail` gains an optional `onReconciled` callback, invoked only when the fetched aggregate is actually
applied (generation unchanged and pending set empty). The indeterminate branch passes a callback that calls
`values.setExternalErrors({})` unless a definite rejection settled during the current burst.
Burst tracking: a `burstRejectedRef` boolean, reset to `false` at the start of a click when the pending set is empty
(a new burst), set to `true` in the definite-rejection branch. This keeps the reconciliation requirement's clause ("applying the
reconciled total SHALL NOT clear any field-associated error the triggering (or any other) settle in the burst has
set", `openspec/specs/form-panel-submit/spec.md:339-341`) intact: it is scoped to "in the burst", and the new clear is
cross-burst only, so that clause and its "separate mechanisms" wording need no cross-reference (the new clear is a
deliberate `setExternalErrors` call, not an incidental side effect of `reconcileValue`). It DOES change the rollback
requirement's sentence at `:474-480` ("only a later request's own success clears it"): per the owner ruling that
sentence now names a second clearing path, carried as a MODIFIED delta in `specs/form-panel-submit/spec.md`; its
same-settle and same-burst non-clearing rules and the scenario "A rejected submit's own trailing reconciliation does
not clear its error" are kept unchanged.
Reset point: the burst flag is reset when `pendingDeltasRef.current.size === 0` is tested BEFORE
`pendingDeltasRef.current.set(token, delta)` (`FormPanelView.tsx:191`). A failed or stale-discarded fetch never
calls `onReconciled`, so it never clears. (Kept existing behaviour, not a new decision: after a failed reconcile the alert shows
"Couldn't confirm..." and the error stays; the PR says so.)
Colour: the counter's error colour is keyed solely on `[aria-invalid="true"]` (`CounterControl.css:27`), so the
jest tests assert `aria-invalid` and the e2e asserts the computed colour is not `--app-error` once cleared, if the
e2e covers that path; otherwise the PR cites `CounterControl.css:27`.
Out of scope: a non-owner's counter never reconciles (`FormPanelView.tsx:220-223`), so its stale error is unchanged;
reported as a possible follow-up.
The success branch already clears unconditionally (HEL-1169 CR3) and the rejection branch passes no `onReconciled`;
neither changes.
Alternative rejected: clear in `reconcileValue` itself — would erase a same-settle rejection's error (D3a).
Alternative rejected: clear at click start — the owner ruled on reconciliation success, and an indeterminate click
whose reconcile fails would then lose the association with the "Couldn't confirm" alert.

### D3 — Tests, red first

1. Jest guard `FormPanel.css.test.ts` (same shape as `CounterControl.css.test.ts`, labelled a GUARD — jsdom has no
   layout): the new `:empty` rule has `position: absolute`, no `display`/`visibility`; the field stack is
   `position: relative`.
2. Jest behaviour in `FormPanelView.test.tsx`: (a) owner's scenario: rejection, then a separate no-response step with
   a successful aggregate → no `aria-invalid`; (b) same-burst rejection + no-response with successful aggregate →
   stays `aria-invalid` and alert keeps the rejection text; (c) rejection then no-response with failed aggregate →
   still `aria-invalid`. (a) must be red on current code; (b)/(c) are guards, each shown failable by a named mutation
   (drop the burst guard → (b) red; call `onReconciled` in the catch → (c) red).
3. E2E geometry: a multi-field form card, light and dark, at 390/768/1100 (1100 with sidebar open): with both regions
   mounted with their roles and empty, `submit.top - lastField.bottom <= rowGap + 1` (rowGap read from computed
   style, no hardcoded px). Plus: a success status and a rejection alert render in flow in the same mounted elements
   (`position: static`, visible, between last field and Submit). The per-kind height table is recorded before and
   after; every card except the multi-field form is unchanged within 0.5 px. Location: extend
   `e2e/hel1791-compact-counter-stack-height.spec.ts` only after HEL-1826 has merged to main (merge main first);
   otherwise a small new spec `e2e/hel1819-form-live-region-gap.spec.ts`, called out in the PR.
4. The red run (jest + e2e against unmodified CSS/TSX) is committed before implementation code (as `.txt` evidence
   if the pre-commit hook refuses the red jest commit).

## Risks / Trade-offs

- A positioned field stack changes the containing block for any absolute descendant (D1 grep mitigates).
- `:empty` fails to match if React ever renders whitespace into the region; the regions render `{alertText}` only, so
  an empty string produces no text node (same as HEL-1804).
- The per-burst flag is a second piece of state beside the generation counter; kept as a ref, read only in D2's path.

## Planner Notes

- Self-approved: D2's burst guard. The owner ruling covers the cross-burst case; the guard preserves an existing spec
  requirement for the same-burst case rather than deciding a new product rule. Not a new dependency, API or scope.
- Frontend only; lane DB `helio_hel1819`; backend must start with `ANTHROPIC_API_KEY` exported empty.
