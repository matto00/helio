## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 108c04b7f71c110ba6a7f82d89f93c0c28de383c. The change dir is untracked planning output.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/actions-menu-forward-tab/HEL-1776`.
- **Artifacts read:** ticket.md, proposal.md, design.md, tasks.md, specs/portal-popover-hook/spec.md, skeptic-design-2.md.
- **Live code read:**
  - `shared/ui/Modal.tsx:200-282` (the HEL-716 trap and the header order)
  - `hooks/usePortalPopover.ts`: the focusout effect at 118-148, keyed on `[isOpen]`, and `handleOpen`/`close` at 236-249
  - `shared/chrome/ActionsMenu.tsx:69-160`
  - `features/panels/provenance/ProvenancePopover.tsx:1-20, 95-200`
  - `features/dashboards/ui/DashboardAppearanceEditor.tsx:82-154, 200-235`

#### Round-2 CR1 (`stopPropagation` rationale, synchronous move): RESOLVED
- D2 now requires the focus move to happen synchronously inside the panel listener. A microtask is also allowed.
  `setTimeout` is forbidden.
- `stopPropagation` is labelled DEFENSIVE and explicitly "not what defeats the Modal trap". Under the mandated
  synchronous move that is correct. The trap at `Modal.tsx:218-236` is gated on `document.activeElement === last`,
  and that is already false when the event reaches the `<dialog>`.

#### Round-2 CR2 (mutation 2.4(v)): RESOLVED in form
- The mutation is now "defer the focus to `setTimeout`", "expected red", recorded whichever way it lands. It is no
  longer a mandated red, so it no longer invites shaping. See non-blocking note 1: the stated expectation is probably
  wrong.

#### Round-2 CR3 (Provenance test shape, `event.target` vs `activeElement`): RESOLVED
- D2 decides "last" from `event.target`.
- **Loading state.** "Close provenance" is the only `FOCUSABLE` match (`ProvenancePopover.tsx:163-170`; the status `<p>`
  is not focusable). Provenance's listener sees `active === last`, calls `preventDefault()` and focuses the same
  button.
  - With the guard, the hook stands down.
  - Without the guard, the hook reads `event.target` (the button), finds nothing tabbable after it, and closes.
  - So the guard removal is observably red.
- **Ready state.** Provenance wraps to first. Without the guard, the hook still reads `event.target`, which is the
  last element, and closes. So this is red too.
- Mutation 2.4(iii) can therefore go red with either pinned test. Tasks 1.4 and 2.4(iii) pin both.

#### Listener order and attachment: SOUND
- `handleOpen` sets `panelPos` and `isOpen` in one batch (`usePortalPopover.ts:238-245`).
- ActionsMenu and the appearance editor render their portal on `isOpen && panelPos` (`ActionsMenu.tsx:142`,
  `DashboardAppearanceEditor.tsx:218`). So the panel exists in the commit where an effect keyed on `isOpen` runs, and
  `panelRef.current` is non-null.
- Provenance's `useEffect([])` is a child passive effect, so it registers before the host hook's. D2 keeps a passive
  effect, which preserves this order.

#### Interaction with ActionsMenu's own keys: none
- `handleMenuKeyDown` (`ActionsMenu.tsx:122-139`) handles only arrows, Home and End, so the `stopPropagation` on the
  forward-Tab path hides nothing it uses.
- The initial-focus layout effect (`ActionsMenu.tsx:88-96`) runs only on open/placed, so closing does not pull focus
  back to the trigger.
- `close()` (`usePortalPopover.ts:247-249`) only sets state and does not refocus anything.

#### Spec vs design: consistent
- A forward Tab off the document's last tabbable panel is intercepted at keydown, so the "focus leaving the document"
  clause (no move) stays true for genuine window blur.
- Shift+Tab stays on the HEL-1759 focusout path.

#### Scope and AC coverage: complete
- AC1 is covered by e2e cases (a) and (b), red first (tasks 1.3).
- AC2 is covered by the unchanged Shift+Tab cases and the unit test.
- AC3 is covered by the D4 consumer split, which is stated in proposal.md.
- AC4 is covered by tasks 1.3 and 3.1. The ticket's premise note that the case is *added*, not updated, is reflected.
- Nothing is out of scope.
- No placeholders: the only "e.g." is the helper module's filename, which is not a decision that blocks
  implementation.

### Verdict: CONFIRM

### Non-blocking notes

1. **2.4(v) will most likely stay GREEN, and D2's counterfactual sentence ("a deferred move would leave the menu item
   focused, so the trap would wrap...") is inaccurate.**
   - While the hook calls `stopPropagation()` on the `ul`, the keydown never reaches the `<dialog>` listener, so the
     trap does not run at all.
   - Even with propagation allowed, the trap would move focus to the trigger. The `focusout` would then stay inside
     trigger+panel and would not close the menu. The deferred `setTimeout` focus would still land on "Close" last, and
     the e2e asserts final focus.
   - The executor should record the green honestly and must not reshape the implementation to manufacture a red.
   - The evaluator must not treat a green (v) as a failed gate. The task text ("record the result whichever way it
     lands") already permits this.
   - The real protection against a deferred move is D2's explicit prohibition plus code review.
2. **Defensive-label precision.** The Modal trap is technically a live bubble-phase listener that would observe the
   Tab. It is inert because of its `activeElement === last` gate. The doc comment could say "no ancestor acts on it"
   rather than "no live consumer observes it".
3. **Carry-over from round 2, recorded in D2.** The hook's "tabbable after" test differs from ProvenancePopover's
   `FOCUSABLE`. The planned doc-comment note is sufficient.
