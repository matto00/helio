## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round-1 CR1 (spec header byte-match)** — verified against the actual OpenSpec CLI, not just
   the claim. `sed -n '404p' openspec/specs/form-panel-submit/spec.md | cat -A` and
   `sed -n '3p' openspec/changes/.../specs/form-panel-submit/spec.md | cat -A` byte-match
   (`### Requirement: A counter's optimistic rollback is scoped to its own submit-request failure
   only$`), likewise for the reconciliation requirement header (base line 330 / delta line 51).
   `npx openspec validate form-submit-network-reconcile --type change --strict` passes. I also went
   further than a mere header diff: I loaded the CLI's actual `findSpecUpdates`/`buildUpdatedSpec`
   from `~/.local/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js` and ran them
   programmatically against this change dir (the same functions `openspec archive` calls, including
   the `MODIFIED failed for header "..." - not found`/`- header mismatch in content`/`- current spec
   contains scenario(s) not present in the modified block` checks round-1 cited). Result:
   `counts: {"added":0,"modified":2,"removed":0,"renamed":0}`, `warnings: []`, no exception thrown.
   This is a closer-to-ground-truth check than `openspec validate` alone, since `validate.js` does
   not call `specs-apply.js` at all — a strict-validate pass does not by itself prove archive would
   succeed. Confirmed: **CR1 is closed**, verified against the real archive matching code path, not
   just the claim.

2. **Round-1 CR2 (reconcile-tail wired into all 3 branches)** — design.md D2 and tasks.md 2.1–2.4 now
   call the shared tail unconditionally from success, definite-rejection, and indeterminate branches,
   and the spec delta's MODIFIED reconciliation requirement + new scenario ("A burst that quiesces on
   a definite-rejection settle still reconciles an earlier sibling's indeterminate outcome") state
   this. The gap CR2 identified is closed on paper. **But this fix creates a new, unaddressed
   defect — see Change Request 1 below.**

3. **Round-1 CR3 (setExternalErrors clearing plan)** — read
   `frontend/src/features/panels/ui/form/useFormPanelValues.ts` directly (lines 118–126, 149–155):
   confirmed `adjustNumericValue` never touches `externalErrors`, and `setValue` unconditionally
   deletes `externalErrors[sourceField]` as a side effect. design.md D3 / tasks.md 2.5 now specify an
   unconditional `values.setExternalErrors({})` on the success branch, independent of that settle's
   own reconciliation-fetch outcome. This closes the specific gap CR3 named (a stale rejection error
   surviving a later success whose own refetch fails). **But see Change Request 1 — the fix for CR2
   reintroduces essentially the same class of bug CR3 fixed, one settle earlier.**

### Change Requests

1. **D2's "call the shared tail unconditionally, including from the definite-rejection branch" and
   D3's "definite rejection calls `values.setExternalErrors`" directly conflict via the existing,
   unmodified `setValue` side effect — the design does not resolve this, and as literally specified
   it defeats AC #1 in the single most common case (an isolated rejected click, no sibling in
   flight).**

   Ground truth: `useFormPanelValues.ts:118-126` —
   ```
   function setValue(sourceField: string, value: FormFieldValue) {
     setValues((prev) => ({ ...prev, [sourceField]: value }));
     setExternalErrorsState((prev) => {
       if (!(sourceField in prev)) return prev;
       const next = { ...prev };
       delete next[sourceField];
       return next;
     });
   }
   ```
   `setValue` **unconditionally clears `externalErrors` for that field** as a side effect, whenever
   it is called — this is the exact mechanism design.md D3 itself cites (lines 99-101) as "the only
   existing clear path."

   Per D2 (design.md lines 66-87) and tasks 2.1/2.3, the shared reconcile-tail helper is called
   *unconditionally* from the definite-rejection branch too, and — when the settle empties the
   pending map — fetches the aggregate and "applies it" (the only mechanism specified or existing in
   the codebase for "applying" a fetched aggregate is `values.setValue(field.sourceField,
   String(aggregate.value))`, per the current code at `FormPanelView.tsx:200-202`, which design.md
   does not propose replacing).

   Walk the primary AC #1 scenario exactly as tasks.md specifies it (2.3, in order): a single counter
   click, no sibling in flight, server returns a definite rejection.
   - Rollback: `adjustNumericValue(field.sourceField, -delta)`.
   - `values.setExternalErrors({ [field.sourceField]: message })` — sets `aria-invalid="true"`.
   - THEN (task 2.3: "THEN call the shared reconciliation-tail helper") — the pending map is now
     empty (no sibling), so the tail fetches the aggregate. This GET is unrelated to the POST
     rejection and will typically succeed. On success, the tail applies it via `values.setValue(...)`
     — which, per the code quoted above, **deletes `externalErrors[field.sourceField]` as a side
     effect**, silently clearing the very `aria-invalid`/`aria-describedby` association the
     rejection branch just set, on the *same settle*, before the user (or a test awaiting
     `waitFor`) ever observes a steady state.

   This is not a hypothetical: it is the literal, described happy-path sequence of tasks 2.3 → 2.1,
   and it fires whenever the reconciliation GET succeeds — the overwhelmingly common case, since the
   GET is a separate, unrelated, normally-healthy endpoint. It directly contradicts:
   - AC #1 itself ("A definite server rejection ... still rolls back with a visible, associated
     error (computed `aria-invalid`/`aria-describedby`)"),
   - the spec delta's own scenario "A rejected submit rolls back with a visible error" (asserts
     `aria-invalid="true"` with no other request in flight — exactly the case that breaks), and
   - the spec delta's own "clears on next successful click" scenario, which describes the clear
     trigger as *"a later immediate-submit request for the same field succeeds"* — a **distinct,
     subsequent submit**, not the same rejected settle's own read-only reconciliation GET.

   Design.md's own text for D2 (lines 80-82) claims "A definite rejection's own field-level
   error/rollback ... is unaffected by this reconciliation — the two are independent," but that
   claim is only argued for the *value* (optimistic delta vs. displayed total); it does not account
   for `setValue`'s incidental `externalErrors`-clearing side effect, which the design's own D3
   section (two paragraphs earlier) explicitly names as existing and load-bearing. D2 and D3 were
   each fixed against round-1's isolated complaint without re-checking against each other.

   **Required revision:** design.md/tasks.md must explicitly resolve how the reconcile-tail's
   "apply the fetched aggregate" step avoids clearing a same-settle definite-rejection's
   `externalErrors` entry — e.g., a value-apply path that does not delete `externalErrors` (skip the
   incidental clear when the settle that triggered this tail run was itself a rejection), or an
   explicit re-assertion of `setExternalErrors` after the tail resolves for that branch, or
   splitting `setValue`'s two side effects (value write vs. error clear) into separate calls the
   tail can invoke selectively. Whichever is chosen, add an explicit scenario/test for "a rejected
   submit's own trailing reconciliation fetch succeeds — the field-associated error must still be
   present," since this is the primary AC #1 path, not an edge case, and neither task 1.2 nor 2.3 as
   written currently forces an implementer to notice the conflict.

2. **Unresolved scope ambiguity: does the "couldn't confirm" announcement (D4) live inside the now-
   shared, unconditional reconcile-tail (all 3 branches), or is it wired only into the indeterminate
   branch as tasks.md 2.4's literal text reads?** The MODIFIED reconciliation requirement's body text
   is unscoped by settle-kind ("When the reconciliation fetch itself fails, ... the assertive region
   SHALL announce that the current value could not be confirmed") — read literally, this also covers
   a *definite-rejection-triggered* tail's own failed refetch, and a *success-triggered* tail's own
   failed refetch (today silent — see `FormPanelView.tsx:203-209`'s comment "Never ... surfacing a
   spurious error for a persisted write"). But:
   - Task 2.4 only describes the announcement for the indeterminate branch.
   - Task 2.1 asserts "no behavior change to the existing success path" for the extraction — which
     would be violated if the shared tail's failure-announcement fires uniformly (the success path's
     silent-on-refetch-failure behavior would change).
   - If a definite rejection's own trailing fetch fails and the shared tail announces "couldn't
     confirm," that would overwrite the single `alertText` state the rejection branch itself just
     set (a specific field-error message) with a generic "couldn't confirm" message — misrepresenting
     what actually happened (a definite rejection, not an unconfirmed write) via the very
     alert-text-conflation D4 exists to prevent, just from the opposite direction.
   This needs an explicit design decision (which branches get the announcement, and what "no behavior
   change to the success path" is actually claiming), not left for the implementer to infer from two
   documents that currently point in different directions.

### Non-blocking notes

- D1's classification rule and its citation of existing codebase idiom (`err.response` presence, not
  status code) is sound and consistent with `panelService.ts`/`classifyRequestError.ts`/
  `httpClient.ts` usage I would expect from the codebase's existing conventions.
- Tasks 1.1/1.2's red-before-green discipline and 2.6/2.7's mixed-burst and HEL-1096-regression
  coverage are well-specified and traceable to spec scenarios.
- The `unaccountedContent` warnings returned by the programmatic `buildUpdatedSpec` dry-run (CR1
  verification) are pre-existing multi-line-scenario-wrapping artifacts present across the whole spec
  file, unrelated to this change's delta, and did not block the simulated apply (`warnings: []`,
  no thrown error) — noted for completeness, not a defect of this change.

### Verdict: REFUTE
