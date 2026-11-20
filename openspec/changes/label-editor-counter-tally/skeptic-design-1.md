## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD a867001d7b1c4c1484fc587ef34291552403885f (change dir untracked; artifacts read from disk).

### What I verified (with evidence)

- **Owner signal (D2): holds.** `FormPanelView.tsx` defines `isFormOwner = formOwnerId != null && formOwnerId === currentUserId`,
  and already uses it to pick `fetchFormSchema` vs `fetchDatasetSchema` and to skip the aggregate fetch in
  `reconciliationTail` (`pendingDeltasRef.current.size === 0 && !isFormOwner`). Gating the caption on `!isFormOwner` in the
  `isCompactCounter` branch needs no new signal. An absent `ownerId` failing closed to "not owner" (caption shown) is correct.
- **Compact-only scope (D1): holds.** The stacked branch renders the counter `immediate={false}`; `+`/`-` go through
  `onChange(String(numericValue + direction * step))`, submitted by the form button via `buildSubmitValues` and reset by
  `values.reset()` on success (unless `resetOnSuccess === false`). No aggregate fetch exists on that path for owner or
  non-owner, so the stacked value is a draft, the same for both roles. No caption there is right.
- **a11y association (D4): sound.** `FormFieldControl` today sets `describedBy = error ? errorId : helpText ? hintId : undefined`
  and passes it to `CounterControl`'s `role="spinbutton"`. Appending a caption id (space-joined) keeps the error/hint and
  adds the caption. Putting the `<p>` inside `renderControl` (inside `FormField`'s children) keeps `CounterControl`'s DOM
  unchanged. The `FormFieldControl.test.tsx` append-not-replace test is the right guard.
- **Styling (D5): tokens exist and the plan is reasonable.** `--text-sm` and `--app-text-muted` are DESIGN.md §3 tokens.
  The 4.5:1 check is measured from rendered pixels in both themes, with a stated fallback to `--app-text`.
- **Test plan (D6):** red first, with two mutation probes. `FormPanelView.nonOwner.test.tsx` already has owner and
  non-owner describe blocks and a no-`/api/data-sources` assertion. `e2e/hel1784-editor-form-submit.spec.ts:213` is the
  editor compact-counter test to extend.
- **No contract delta needed:** frontend only, no API or schema change. Confirmed: no backend file is involved.

### Verdict: REFUTE

### Change Requests

1. **The caption wording is false for the e2e fixture this plan extends.** Each click moves the tally by `step`
   (`handleImmediateStep`: `delta = step * direction`, applied with `values.adjustNumericValue`). Clicking `-` subtracts.
   So the number is the net sum of the user's steps, not a count of clicks. The fixture at
   `e2e/hel1784-editor-form-submit.spec.ts:168` is `step: 5`: after one click the panel would show **5**, captioned "Your
   clicks this session". Ticket and spec allow the final wording to differ ("a caption such as ... final wording per
   DESIGN.md"), and DESIGN.md §0.5 asks for plain, accurate copy. Revise D3 and the spec requirement and scenario to
   wording that stays true when step is not 1 and after a decrement. For example: "Your changes this session", "Your
   total this session", or one that also says it is not the dataset total. Pick one and justify it in D3. The jest and
   e2e assertions should share the new literal.

2. **The tally is seeded from `initialValue`, so the caption can be wrong before any click.** `useFormPanelValues.seedValueFor`
   seeds the counter's value from `field.initialValue`. A counter `initialValue` is a valid config: the editor exposes
   "Initial value for <field>" for every control (`FormFieldRow.tsx:159-171`). The only check is
   `formConfigValidation.ts:177` (a typed-value check), with the same check server-side in
   `FormSchemaConsistency.checkInitialValue`. A non-owner opening a counter with `initialValue: 10` sees "10" captioned
   as their session clicks, having made none. This contradicts the HEL-1784 ruling ("a local tally of their own clicks")
   that the caption asserts. The design must address it explicitly. Either:
   (a) seed a non-owner's compact counter at 0, ignoring `initialValue`. That is a small behaviour change: state it in
   proposal/design/spec and add a red-first jest test with `initialValue` set. Or:
   (b) keep the seed and choose wording that is still true, then say so in D3.
   Silently leaving it is not acceptable. Add the `initialValue` case to D6's test list either way.

### Non-blocking notes

- The ticket's premise "the owner's counter, which shows the real total" is only partly true. The owner's compact counter
  also starts at `initialValue`/0 on load. It only reconciles to the aggregate after a click burst quiesces (there is no
  mount-time `fetchFieldAggregate`). That is out of scope here (the owner is unchanged), but the proposal's "Why" should
  not lean on it, and it may deserve a follow-up ticket.
- D5's sans choice is defensible: the caption is explanatory copy, not metadata. DESIGN.md §12's phone "Refreshed line"
  caption is mono, though, so the evaluator should judge it beside its siblings in both themes.
- Panels can be translucent (the transparency slider) over custom dashboard backgrounds. Measure muted-caption contrast
  at default opacity, and note that a user-reduced opacity is outside the floor.
- D3's sentence "so tests and e2e share the literal via the jest test only (e2e repeats the literal string)" is garbled.
  Restate it: an exported constant used by jest, with the literal repeated in e2e.
