## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **DatasetRowGrid.css precedent claim.** Read
   `frontend/src/features/sources/ui/DatasetRowGrid.css:145-151`. The
   `.dataset-row-grid__draft-checkbox` rule exists exactly as quoted in
   ticket.md/design.md/tasks.md: `width: 18px; height: 18px; accent-color:
   var(--app-accent); align-self: flex-start; margin-top: var(--space-1);`.
   Also confirmed (`DatasetRowGrid.tsx:856,865`) that this checkbox lives
   inside a `<div className="dataset-row-grid__draft-field">` flex parent,
   which is why `align-self: flex-start` is meaningful there.

2. **FieldDeclarationTable.tsx current state.** Read
   `FieldDeclarationTable.tsx:161-167`. The "Required" checkbox is a bare
   `<input type="checkbox" aria-label={...} checked={...} onChange={...}>`
   with no `className`, confirming the "unstyled, ~13px native" premise.
   Confirmed it sits directly inside a `<td>` with no flex parent (line 158),
   which correctly supports design.md's Decision 3 (omit `align-self:
   flex-start` here since it would be a no-op) — this is not hand-waved, it's
   grounded in the actual DOM structure.

3. **FieldDeclarationTable.css current state.** Read the full file (17
   lines). Confirmed it has zero checkbox rule today, consistent with the
   proposal's claim that a new rule needs to be added, not modified.

4. **aria-label pattern.** Confirmed `aria-label={`Field ${index + 1}
   required`}` at line 164 matches the ticket's AC text exactly ("Field {n}
   required").

5. **Test-file baseline.** Read `FieldDeclarationTable.test.tsx` (98 lines).
   Zero existing references to "checkbox" or "required" — confirms task 2.1's
   premise that there is no existing coverage for this control, and the
   proposed `getByRole("checkbox", { name: /required/i })` + keyboard-focus
   assertion is consistent with this suite's existing conventions
   (`getByRole`/`getByLabelText` + `fireEvent`, e.g. lines 53-55, 72-80).

6. **DESIGN.md cross-check on Decision 1.** Read the Control metrics section
   (`DESIGN.md:227-237`): "Every button, input, and select uses a
   control-height token" (`--control-sm/md/lg`). The proposed 18px checkbox
   does not use one of these tokens, and 18px isn't a `--space-*` multiple of
   4 either. However, this is not a new deviation this ticket introduces —
   it exactly mirrors the already-shipped, already-skeptic-reviewed
   `DatasetRowGrid.css` precedent (HEL-1080), and design.md's Decision 1
   explicitly weighs and rejects the token-based alternative for a sound,
   specific reason (checkbox glyphs are conventionally smaller than control
   heights; the sibling precedent already validated this exact value).
   Non-blocking: relitigating HEL-1080's shipped choice is out of this
   ticket's scope, and the design proposal doesn't invent a new pattern
   in that regard — it reuses one that has already cleared review.

7. **Scope / impact section accuracy.** Confirmed the two files listed
   (`FieldDeclarationTable.tsx`, `FieldDeclarationTable.css`) are the only
   ones that need touching for this change; no backend/schema/API surface is
   implicated, consistent with "No migration required."

### Assessment

No placeholders, no TBDs, no deferred decisions that block implementation.
No internal contradictions between ticket/proposal/design/tasks — every
concrete value (18px, `accent-color: var(--app-accent)`, the omission of
`align-self`/`margin-top`) is justified against the actual DOM/CSS structure
rather than copied blindly. Tasks map 1:1 onto the design's decisions and
the ticket's ACs (sizing/accent AC → 1.2; CSS-only/no-behavior-change AC →
1.1; accessible-name/keyboard AC → 2.1; light+dark visual verification AC →
called out explicitly in task 1.2 and the design's Risks section pointing
at evaluator/skeptic final-gate verification). No scope drift — the
proposal explicitly declines to touch `DatasetRowGrid.css` or build a shared
component, matching the ticket's "CSS-only" constraint. No missing
contract/schema updates are needed (pure frontend CSS/markup).

### Verdict: CONFIRM

### Non-blocking notes

- The 18px checkbox size does not use a `--control-*` token and sits below
  the 44px touch-floor guidance elsewhere in DESIGN.md — this is an
  inherited property of the HEL-1080 precedent this ticket is explicitly
  asked to mirror, not a new defect this design introduces. Flagging for
  awareness only; not a reason to block this ticket, which is scoped to
  parity with an already-shipped sibling treatment.
