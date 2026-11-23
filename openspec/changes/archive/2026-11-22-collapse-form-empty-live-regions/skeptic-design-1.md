## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/form-empty-live-region-gaps/HEL-1819`.
- **Artifacts read:** ticket.md, proposal.md, design.md, tasks.md, specs/form-panel-rendering/spec.md, specs/form-panel-submit/spec.md. I found no TODO or TBD markers. Every AC maps to a task: AC1 to 1.3/3.4, AC2 to 3.2, AC3 to 3.3, AC4 to 1.2/3.1.
- **Live code, D1:** `FormPanel.css:5-10` confirms `.form-panel-view__fields` is a flex column with `gap: var(--space-3)` and no `position`. `FormPanelView.tsx:441-446` renders the two `<p>` regions as direct children of the `<form class="form-panel-view__fields">`, between the fields and Submit. That is 3 gaps from the last field to Submit today, and 1 after the fix. `CounterControl.css:43,51-53` is the HEL-1804 precedent the plan copies.
  - Containing-block reasoning holds. An abspos child of a flex container takes its static position as if it were the sole flex item, which is the start of the form's content box, not the slot between the last field and Submit. With auto offsets and auto width it is shrink-to-fit, so the box is 0x0 while empty. It is invisible, cannot be hit-tested, and its static position does not depend on which ancestor is the containing block.
  - `position: relative` on the form adds no stacking context because there is no z-index.
  - A grep of `features/panels/ui/form/` and `components/ui/*.css` for `position: absolute` returns only the HEL-1804 rule, so the D1 grep task is a sound check with no known hit.
  - The `:empty` premise holds. React's `setTextContent("")` assigns `textContent`, which leaves no text node.
  - The `PanelContent.css:400-406` compact query switches the gap to `--space-2`. D3.3 reads `rowGap` from computed style, so the metric stays correct under it.
- **E2E red-first claim (D3.3):** on current code the gap is 3 x rowGap, so `submit.top - lastField.bottom <= rowGap + 1` fails. After the fix it is 1 x rowGap, so it passes. `e2e/hel1791-compact-counter-stack-height.spec.ts:118` already seeds a "Multi-field form" panel, and `:251` already has the per-kind height table. Extending it, or a sibling spec, is realistic.
- **Live code, D2:** `useFormPanelValues.ts:177-179` shows `reconcileValue` only sets values. The indeterminate branch (`FormPanelView.tsx:287-289`) never calls `setExternalErrors`. So test (a) (rejection, then a later no-response click, then a successful aggregate) leaves `aria-invalid="true"` on current code. **Test (a) is genuinely red-achievable.** The mocks it needs (`fetchFieldAggregateMock`, `new Error("Network Error")`, `axiosErrorWith(400, ...)`) already exist in `FormPanelView.test.tsx:249,508,532,661`.
- **D2 burst guard:** I walked the orderings.
  - Rejection settles first, then indeterminate settles last: the flag is set, so no clear.
  - Indeterminate settles first, then rejection settles last: the rejection branch passes no `onReconciled`, so no clear.
  - A new click lands while the previous burst's fetch is in flight: the map is empty, so the flag resets, and the old fetch is discarded by the pending-size check.
  - The guard is not a new product rule. The existing spec requires it (`openspec/specs/form-panel-submit/spec.md:339-340` and `:477-479`).
- **Existing-spec consistency (this is where the plan fails):** I read the living `form-panel-submit` spec in full around the reconciliation and rollback requirements. See CR1.

### Verdict: REFUTE

### Change Requests

1. **Missing MODIFIED delta: the new requirement contradicts the living spec.** `openspec/specs/form-panel-submit/spec.md:474-480`, in the requirement "A counter's optimistic rollback is scoped to its own submit-request failure only", says the error "SHALL be cleared on the next successful immediate-submit settle". It then says "reconciling the displayed TOTAL is independent of, and SHALL NOT clear, this requirement's field-level error/invalid state; **only a later request's own success clears it.**"
   - The new ADDED requirement makes a later request's indeterminate failure plus a successful reconcile clear the error. That violates "only a later request's own success clears it" and the general "reconciling ... SHALL NOT clear".
   - design.md D2 and its Planner Notes cite only the `:339` clause ("in the burst") as preserved. They missed this one.
   - As planned, archiving would leave two contradicting SHALLs in `form-panel-submit`. The owner's ruling is the authority to change it, so this is a spec update, not an escalation.
   - **Required:**
     - Add a `## MODIFIED Requirements` entry to `specs/form-panel-submit/spec.md` that reproduces that requirement in full. Amend the clearing sentence to name both clearing paths: a later request's success, or a later burst's successful, applied reconciliation after an indeterminate settle. Keep the same-settle and same-burst non-clearing rule.
     - Keep the scenario "A rejected submit's own trailing reconciliation does not clear its error" unchanged.
     - Update D2's "keeps the existing requirement intact" wording so it cites `:474-480` and states that that sentence is being changed, per the owner ruling.
     - In the same pass, check whether the `:339-341` "separate mechanisms so that one can never incidentally clear the other" clause needs a cross-reference to the new deliberate clear. It may stay as is, because it scopes to "in the burst", but say so in design.md.

### Non-blocking notes

- AC4 and the new spec scenario say "not shown in the error colour". jsdom does not compute `CounterControl.css:27`. The jest test can assert only `aria-invalid`. Either state in the test or design that the colour is keyed solely on `[aria-invalid="true"]` (cite `CounterControl.css:27`), or add a computed-colour assertion to the e2e.
- Scenario (c) and the D2 sentence "a failed ... fetch never calls `onReconciled`, so it never clears" codify keeping a stale `aria-invalid` after a failed reconcile. The alert then shows "Couldn't confirm...", which is not the rejection text. That is today's behaviour and is defensible, but it goes slightly beyond the owner's literal ruling. Flag it in the PR as preserved existing behaviour, not a new decision.
- The non-owner path (`FormPanelView.tsx:220-223`) never reconciles, so a non-owner's stale rejection error still persists after a no-response click. This is out of scope per the ruling. Consider mentioning it as a possible follow-up.
- D2's "reset at the start of a click when the pending set is empty": tell the implementer to test emptiness before `pendingDeltasRef.current.set(...)` at line 191, or equivalently `size === 1` after it. The two are equivalent; this only removes a two-readings ambiguity.
- Because the empty regions' static position is the form's top-left, a 0x0 box overlaps the first field's label. This is harmless, but worth one sentence in the CSS comment so a future reader does not "fix" it.
