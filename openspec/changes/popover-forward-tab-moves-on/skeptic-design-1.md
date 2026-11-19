## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 108c04b7f71c110ba6a7f82d89f93c0c28de383c (the change dir is untracked planning output).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/actions-menu-forward-tab/HEL-1776`.
- **Artifacts read:** ticket.md, proposal.md, design.md, tasks.md, specs/portal-popover-hook/spec.md.
- **Live code read:** `frontend/src/hooks/usePortalPopover.ts` (all of it), `shared/chrome/ActionsMenu.tsx:60-200`,
  `shared/ui/Modal.tsx:50-70, 200-282`, `shared/motion/BottomSheet.tsx:85-106`,
  `features/pipelines/ui/mobile/MobileStepSheet.tsx:36-100`, `features/panels/provenance/ProvenancePopover.tsx:60-130`,
  `features/dashboards/ui/DashboardAppearanceEditor.tsx:135-200`, `shared/chrome/MobileNavSheet.tsx:205-240`,
  `e2e/hel1759-popover-keyboard-focus.spec.ts` (all of it), plus a grep for every `"Tab"` key handler in `frontend/src`.

#### (1) Bubble-phase keydown + `defaultPrevented` guard vs the Modal Tab trap: BROKEN in the phone step sheet

Here is the event path for forward Tab on the **last** actions-menu item inside the phone step sheet:

1. `MobileStepSheet` renders `ActionsMenu` as `headerActions` of `BottomSheet`, which wraps `Modal`
   (`BottomSheet.tsx:94-101`). `ActionsMenu.handleToggle` portals the panel into `trigger.closest("dialog[open]")`
   (`ActionsMenu.tsx:103`), so the panel is appended as the **last child of the dialog**.
2. `Modal`'s HEL-716 trap is a native `keydown` listener on the `<dialog>` (`Modal.tsx:240`). It collects
   `FOCUSABLE_SELECTORS` (`Modal.tsx:53-54`). That selector is an OR list that begins with `button:not([disabled])`.
   A menu item is `<button tabIndex={-1} role="menuitem">` (`ActionsMenu.tsx:166-176`), so it **matches**: the
   `[tabindex="-1"]` exclusion applies only to the `[tabindex]` arm. The portalled scrim is a button too.
3. So the last enabled menu item is the trap's `last`. On forward Tab, the trap calls `preventDefault()` and
   `first.focus()` (`Modal.tsx:232-236`) **at the dialog**, before the event reaches a `document` bubble listener.
4. The design's hook listener sees `event.defaultPrevented === true` and skips, as D2 intends ("the Modal trap on the
   dialog wins and nothing double-moves focus"). The focusout path then sees direction `"forward"` and only closes.
5. Focus ends on the dialog's first focusable. The Modal header renders title text, then `headerActions`, then the
   close button (`Modal.tsx:263-271`). So that first focusable is most likely the actions-menu trigger itself, which is
   exactly the behaviour the owner overruled. Even if it isn't the trigger, it is not "the next control after the
   trigger".

The repo already documents this hazard. `ProvenancePopover.tsx:103-106` puts its own trap on the panel itself because
"it is deeper than any enclosing native `<dialog>` Modal, so its own Tab trap never sees these events (it would
otherwise wrap focus out of the popover)". D2 treats "Modal trap wins" as safe. It is the failure mode.

Net effect: the design meets AC 1 and its own spec scenario "Forward Tab inside an open modal dialog" for
non-last items, but not for the last enabled item in the sheet, which is the ticket's literal case ("forward Tab off
the **last** item"). That is an internal contradiction between D2 and spec.md.

React portal delegation itself is fine. React's handlers for the portal run at the portal container (body or dialog),
before `document`. `ActionsMenu.handleMenuKeyDown` does not touch Tab, and ProvenancePopover stops propagation on its
panel, so a `document` bubble listener never sees its keys anyway. The `defaultPrevented` guard is therefore not what
protects ProvenancePopover. Its `stopPropagation` is, and task 2.4(iii)'s mutation would not turn anything red for
that reason. No other `document`-level Tab handler preventDefaults (grep: only `Modal`, `MobileNavSheet` (its own
panel), `ProvenancePopover` and `DatasetRowGrid` handle `"Tab"`).

#### (2) AC-3 consumer decision: NOT an escalation

The ticket explicitly delegates this decision: "Check whether the other popovers ... should follow the same rule, and
**say which ones change**." Applying the ruling's principle (behave as if the panel sat right after its trigger) to the
appearance editor is a consistent reading, not a new product fork. The editor is a non-modal disclosure whose content
belongs logically after its trigger. Data-loss behaviour is unchanged: an unsaved pick is discarded on any close, both
before and after this change, because HEL-1759's forward Tab also closed the editor. So the delegated decision does
not need an ESCALATION, provided the PR body states it as the design says. I checked the consumer split against the
code:

- Select keeps virtual focus.
- ProvenancePopover wraps Tab inside its own panel.
- UserMenu, IconButton and OutputSchemaDisclosure never attach `panelRef`.

That matches proposal.md.

#### (3) Does the e2e plan prove the AC red-first?

Partly.

- **(a) desktop and (c) appearance editor go red on main.** On main, forward Tab out of the panel either refocuses
  the trigger (HEL-1759 microtask) or, when the panel is the document's last tabbable, gets `relatedTarget === null`
  and leaves the menu open. Both fail a "closed and focused on the next control" assertion.
- **(b) phone sheet does not pin which item is Tabbed from.** The existing phone case starts with focus on the
  **first** item (`hel1759...spec.ts:191-198`). A forward-Tab copy of it would Tab from a non-last item, where the
  Modal trap does not fire. It would go red on main and **green after the D2 implementation**, while the
  last-item-in-sheet defect above ships unobserved. That is a test that passes without exercising the failing path.
- **The independently located target is unnamed.** Tasks 1.3 do not name the concrete "next control after the
  trigger" for each case. The risk section promises it but leaves it implicit.

### Verdict: REFUTE

### Change Requests

1. **design.md D2: resolve the Modal-trap pre-emption.** A Modal (and any other ancestor-of-panel trap) pre-empts
   the hook whenever the focused menu item is the dialog's `last` under `FOCUSABLE_SELECTORS`. Choose and document a
   mechanism that yields the next-after-trigger target in that case, and state why it does not also pre-empt
   ProvenancePopover's own panel trap. Two options:
   - Attach a native keydown listener to the panel element itself, the same depth trick ProvenancePopover uses, and
     skip panels that already handle Tab (ProvenancePopover stops propagation on the same element; check the ordering).
   - Handle the "Modal moved focus out of the panel on a forward Tab" case in the focusout path.

   Delete the sentence presenting "the Modal trap on the dialog wins" as the desired outcome. Changing `Modal.tsx` is
   out of bounds per D3; if the chosen mechanism needs it, say so explicitly and justify it.
2. **tasks.md 1.3(b) and spec.md: press Tab from the last enabled item in the step sheet.** Move to it with `End`,
   assert it is focused, then press Tab. Assert the menu closed and focus is on a concrete, independently located
   control that is not the trigger. Prefer the last enabled item in (a) too, to match the ticket's literal wording.
   The red evidence must show this case failing on main, and it must stay a case a "Modal wins" implementation fails.
3. **tasks.md 1.3: name the concrete expected target per case,** or the rule the executor uses to locate it without
   re-running the D3 algorithm: the desktop list row's next control, the sheet control after the header actions
   trigger, and the appearance editor's next header control. Also assert `not.toBeFocused()` on the trigger and that
   `document.activeElement !== document.body`.
4. **tasks.md 2.4(iii): fix the mutation's premise.** Dropping the `defaultPrevented` guard cannot turn the
   ProvenancePopover wrap test red, because ProvenancePopover stops propagation on its panel and a `document` bubble
   listener never receives its keys. Re-target the mutation at the guard's real job, for example a unit test where
   an ancestor listener preventDefaults a Tab and the hook must not move focus. Alternatively, state that the guard is
   defensive and has no live consumer. Add a mutation for CR 1, re-introducing the "skip when the Modal trap
   handled it" behaviour, which must turn the new last-item sheet case red.

### Non-blocking notes

- The AC-3 decision (appearance editor follows the rule) is correctly treated as delegated by the ticket. No
  escalation is needed; keep it stated in the PR body.
- The HEL-1736 and HEL-1762 non-interaction claims are plausible from the code paths read (the Escape registry and
  placement), but I did not trace them exhaustively. The executor should keep the diff to the hook, the helper and
  tests, as planned.
- `MobileNavSheet` has its own panel-level Tab trap but hosts no `panelRef` popover, so it is out of scope.
