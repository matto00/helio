## Context

`FormPanelView.tsx` decides owner vs non-owner once: `isFormOwner = formOwnerId != null && formOwnerId === currentUserId`
(`formOwnerId` is `panel.ownerId`, passed by `renderers/FormRenderer.tsx`; absent fails closed to non-owner). For a
non-owner it loads the schema via `fetchFormSchema(panelId)` and skips the aggregate reconciliation
(`onReconcileFailed` branch), so the compact counter's displayed value is a session-local tally (HEL-1784 design.md,
"A non-owner's counter shows a session-local tally"). The compact layout is `isCompactCounter` (exactly one field, a
counter) and renders `FormFieldControl immediate` → `CounterControl` (`role="spinbutton"`, `aria-describedby` from
`FormFieldControl`'s `describedBy`: error id, else help-text hint id).

## Goals / Non-Goals

**Goals:** a visible caption for a non-owner's compact counter tally, announced with the tally, in both themes and on
phone; owner rendering byte-for-byte unchanged; no new owner signal.

**Non-Goals:** see proposal.md Non-goals.

## Decisions

- **D1. Scope: compact counter only.** In a stacked form the counter's value is a draft delta seeded from
  `initialValue`, submitted by the form button and reset on success (`values.reset()`), identically for owner and
  non-owner. It never claims to be a total, so no caption there. The compact layout is the only place a non-owner sees a
  number that the owner sees as the dataset total.
- **D2. Owner signal reused.** The caption is shown iff `!isFormOwner` in `FormPanelView`'s compact branch. No new prop
  from `FormRenderer`, no new selector, no role lookup.
- **D3. Wording: "Your net change this session".** Each click moves the tally by `step * direction`
  (`handleImmediateStep` → `values.adjustNumericValue`), so the number is the net of the user's steps, not a count of
  clicks: with `step: 5` one `+` shows 5, and `-` subtracts. "Your clicks this session" (the ticket's example) would be
  false in both cases; the ticket allows the final wording to differ. "Your net change this session" stays true for any
  step and after decrements, says whose (yours, so not the dataset total) and for how long (this session, so a reload
  resets it). Plain language per DESIGN.md §0.5, sentence case, no trailing period (a caption, not a sentence).
  Defined once as an exported constant (`COUNTER_TALLY_CAPTION`) in the form folder and used by the jest tests; the e2e
  spec repeats the literal string.
- **D3a. A non-owner's compact tally starts at 0.** `useFormPanelValues.seedValueFor` seeds from `field.initialValue`,
  which a counter may carry (`FormFieldRow.tsx` offers "Initial value" for every control). A non-owner opening a
  counter with `initialValue: 10` would see "10" captioned as their own change, having made none. For a compact counter
  `initialValue` never reaches a submitted row (a compact submit sends only `step * direction`), so it is display-only;
  seeding it at 0 for a non-owner is what makes the HEL-1784 ruling ("a tally of their own clicks") and this caption
  true. Mechanism: `FormPanelView` passes `useFormPanelValues` a third argument, `zeroCounterSeed` (true iff
  `isCompactCounter && !isFormOwner`), which seeds a counter at 0 instead of `initialValue`. The re-seed key gains a
  `#zero` marker only while the flag is set, so if ownership resolves after mount (e.g. `currentUser` loads late) the
  counter re-seeds for the final role, and an owner's tally is never reset by an unrelated `initialValue` edit.
  Owner seeding is unchanged. Stacked forms are unchanged for everyone (D1).
- **D4. Where it renders.** `FormFieldControl` gains an optional `tallyCaption?: string` prop, meaningful only for
  `control: "counter"`. When set, the counter case renders the `CounterControl` followed by
  `<p id={captionId} className="counter-control__caption">{tallyCaption}</p>` (id from `useId`). The caption id is
  appended to the spinbutton's `aria-describedby` (space-joined with any existing error/hint id, never replacing it).
  DOM/reading order: label → Decrease → value → Increase → caption, and focusing the value announces the label, value,
  step and caption. `CounterControl`'s own markup and props are unchanged, so existing `.counter-control` selectors in
  e2e/jest stay valid. When `tallyCaption` is absent, `FormFieldControl` output is identical to today.
- **D5. Styling.** The caption matches the shared form hint (`.ui-form-field__hint`: `--text-xs`, 12 px,
  `--app-text-muted`, owner ruling at Delivery, 2026-11-20; it was `--text-sm` through the final gate), plus
  `text-align: center` from `.counter-control__caption`. Sans, since it is copy, not data (DESIGN.md §3 Typography: mono
  is for metadata/data). No new values. Tokens only, so light/dark parity is automatic. Must reach 4.5:1 on the panel surface in both themes
  (measured by the evaluator from rendered pixels, not computed). Wraps on a narrow phone card; no truncation.
- **D6. Test plan (red first, C12).** Jest in `FormPanelView.nonOwner.test.tsx`: caption visible for a non-owner compact
  counter; the spinbutton's accessible description contains it; no caption for the owner (`FormPanelView.test.tsx` or
  the owner block of the nonOwner file); no caption on a non-owner stacked counter; still no `/api/data-sources/*` call;
  a non-owner compact counter with `initialValue: 10` shows 0 and a `+` (step 5) shows 5; the owner's compact counter
  with `initialValue: 10` still shows 10; ownership resolving after mount re-seeds correctly.
  `FormFieldControl.test.tsx`: `tallyCaption` appends to (does not replace) an existing error/hint describedby. E2E:
  extend `e2e/hel1784-editor-form-submit.spec.ts`'s editor compact-counter test to assert the caption is visible and is
  the spinbutton's accessible description, and that the owner's counter has none. Red run recorded and committed before
  implementation; mutation probes: drop the `!isFormOwner` gate (owner test must go red), drop the describedby append
  (a11y test must go red), drop the `initialValue` strip (seed test must go red).

## Risks / Trade-offs

- An absent `ownerId` (panel list hides it from non-creator, non-dashboard-owner viewers) shows the caption — correct,
  since such a user is not the owner and gets a local tally.
- Muted text contrast at the hint size (`--text-xs`) must be checked in both themes; fall back to `--app-text` if it fails.

## Planner Notes

- Self-approved: wording (D3), non-owner zero seed (D3a; implements the owner's "counts only this person's clicks"
  ruling, display-only), compact-only scope (D1), placement in `FormFieldControl` rather than `CounterControl`
  (D4) to keep `CounterControl` presentational and its DOM stable.
- HEL-1787 may edit the archived HEL-1784 change; this change does not touch `openspec/changes/archive/**`.
- Design-gate round 1 note: the owner's compact counter is seeded (`initialValue` or 0), not fetched on mount; it only
  matches the dataset total after a click burst reconciles. Out of scope (owner unchanged); candidate follow-up.
- Contrast is measured at the panel's default opacity; a user-reduced panel opacity is outside the floor.
