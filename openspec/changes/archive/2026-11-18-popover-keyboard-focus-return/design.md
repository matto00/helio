## Context

See proposal.md - Why. Current state (main 9054da2a6):

- `usePortalPopover` closes an opted-in popover (`panelRef` attached) on a document `focusout` whose `relatedTarget` is outside trigger and panel, but never moves focus; only the Escape path calls `triggerRef.current?.focus()`. Panels are portalled to the end of `<body>` (or into an open `<dialog>`), so Shift+Tab from the panel's first focusable goes to the portal's DOM predecessor, unrelated to the trigger.
- `DashboardAppearanceEditor` Save is `disabled={isSaving}`. A focused button that becomes disabled loses focus to `<body>` with `relatedTarget === null`, which the hook deliberately ignores; the editor stays open with focus on body, and the next keyboard focus move lands outside and closes it, and the close effect resets the draft.

## Goals / Non-Goals

Goals: both ticket defects fixed, red-first e2e proof (keyboard only, real browser), additive shared-hook change.

Non-Goals: forward Tab from the last panel item when no focusable element follows in the document (`relatedTarget === null`, browser chrome) - unchanged; focus trapping; any change to Escape or open-focus behavior; any non-`panelRef` consumer.

## Decisions

D1. Hook: return focus to trigger only for keyboard-initiated focus-out that starts inside the panel.
In the existing focusout handler, when the close condition holds AND `panelRef.current.contains(event.target)` AND the focus move was caused by a Tab key (a ref set by a document `keydown` for `Tab` - extend the existing Escape keydown listener - and cleared by `pointerdown` and at the end of the focusout handling), call `setIsOpen(false)` and `triggerRef.current?.focus()`.
- Why gate on "started inside the panel": `Select` keeps virtual focus on its trigger; Shift+Tab off the trigger must move on, not bounce back (that would trap the user).
- Why gate on Tab: a pointer click on another control fires the same focusout; stealing focus back to the trigger would break that click target (e.g. an input the user is about to type in). The ticket's Fix bullet says "when a popover closes because focus left it"; the AC only names Shift+Tab. Keyboard-only scoping is the engineering reading of that bullet, not a product change. A scrim click is a pointer action and keeps today's behavior. Note (design-gate skeptic round 1): the editor's scrim (`DashboardAppearanceEditor.tsx` ~L210) is a tabbable unnamed `<button>` with no `tabIndex={-1}`, unlike ActionsMenu/OutputSchemaDisclosure/Provenance, so on main Shift+Tab from the first preset lands on the scrim, the popover closes, the scrim unmounts and focus falls to body. Add `tabIndex={-1}` to the editor scrim (matches siblings, removes an unnamed tab stop); the D1 refocus must survive an element that unmounts in the same close.
- Forward Tab out of the panel to a real element also returns to the trigger (same rule, both directions) - consistent with the Fix bullet, and the trigger is the user's last known place.
- Alternative rejected: per-consumer `onKeyDown` Shift+Tab interception in ActionsMenu and the editor. Duplicates logic, misses ProvenancePopover/Select-panel consumers, and the ticket names the hook as the fix site.
- Alternative rejected: always refocus trigger on any focus-out close. Breaks pointer and Select as above.
- Ordering: whether a synchronous `focus()` inside a `focusout` handler sticks while the browser is mid-move is not assumed. The executor MUST probe in a real browser whether a synchronous `trigger.focus()` inside `focusout` sticks; if not, defer with `queueMicrotask`/`requestAnimationFrame` or perform it on the subsequent `focusin`. Record the probe result in the change's notes.

D2. Editor: `aria-disabled` while saving, not `disabled`.
Save gets `aria-disabled={isSaving || undefined}` and keeps its "Saving..." label; `handleSubmit` returns early when `isSaving` (enforces the no-double-submit that `disabled` used to give, including Enter in a color input submitting the form). Focus stays on Save throughout, so a failure leaves the editor open with the pick intact and focus on Save; the error renders via `InlineError` (verify it is announced - role=alert or aria-live; do not move focus to it). Any `:disabled` CSS on the Save button gets an `[aria-disabled="true"]` equivalent so the visual state is unchanged (compare light+dark).
- Alternative rejected: keep `disabled` and refocus Save after failure. Focus still drops to body during the in-flight window, so a keyboard user who Tabs while saving closes the editor - the same defect, narrowed.

D2a. Announce the failed save without moving focus: tie the error to Save (`aria-describedby` from Save to the `InlineError` `id`) and/or a local `aria-live="polite"` wrapper around the editor's `InlineError`; pick one and unit-assert it. Do NOT change `InlineError`'s shared default (~30 call sites). Back the submit guard with a `savingRef` as well as `isSaving` state so two same-tick submits cannot both pass.

D1a. Tab-flag hygiene: clear the flag on every focusout exit path (including the `relatedTarget === null` and `!panelRef.current` early returns), on any non-Tab keydown, on pointerdown, and in the effect cleanup on close. Decide bubble vs capture phase for the Tab tracking (capture is more robust to an ancestor stopping propagation) and record the decision. ProvenancePopover traps Tab and stops propagation itself, so the hook change is expected to be inert there; verify.

D3. Tests.
- Unit (`usePortalPopover.test.tsx`): Shift+Tab-style focus-out from inside the panel focuses the trigger; focus-out from the trigger does not; pointer-initiated focus-out does not; no-`panelRef` consumer unaffected. Editor unit test: Save carries `aria-disabled="true"` while saving, a second submit while saving dispatches nothing, and after a rejected save focus is on Save.
- e2e (new `e2e/hel1759-popover-keyboard-focus.spec.ts`, keyboard only after login/navigation): (a) failed save via `page.route` failing the dashboard PATCH -> editor open, picked preset still `aria-pressed`, focus on Save, error visible; then Shift+Tab keeps it open; (b) Shift+Tab from the editor's first preset -> editor closed, focus on the editor trigger; (c) Shift+Tab from the actions menu's first item -> menu closed, focus on its trigger. Light + dark; desktop + phone viewport where the control exists on phone (if the editor trigger is not rendered at phone width, state that with evidence and cover the actions menu at phone). Each test shown RED against unmodified main source first, and each fix line recorded as a mutation that turns its test red.
- Run in full every existing unit and e2e spec that exercises a `panelRef` consumer (enumerate by grep: ActionsMenu, Select, ProvenanceTrigger/Popover, DashboardAppearanceEditor, OutputSchemaDisclosure; UserMenu keeps its own local panelRef and is unaffected), including `e2e/hel1756-popover-viewport-fit.spec.ts` and `e2e/hel1750-actions-menu-viewport-fit.spec.ts`.

D4. HEL-1756 spec emails: premise validation found every label in `e2e/hel1756-popover-viewport-fit.spec.ts` already plain on main (`size.name.replaceAll(" ", "-")`). Executor re-verifies by computing each label and checking it against `userCleanupCore`'s `PLAIN_EMAIL_LOCAL`; no edit if already plain.

## Risks / Trade-offs

- [Shared hook change affects concurrent lane HEL-1744 (provenance/citation chips)] -> change is additive and confined to the focusout handler + Tab tracking; the exact diff of `usePortalPopover.ts` is reported to the driver.
- [Tab flag leaks into a later, unrelated focus move] -> flag cleared on pointerdown and after each focusout; a non-Tab key does not set it.
- [Focus inside focusout may not stick] -> D1 probe requirement.
- [Shared Playwright browser/dev DB] -> verify URL/port are this lane's; throwaway users plain addresses, deleted by exact id via userCleanup.

## Migration Plan

None (frontend only, no data). Rollback = revert the commit.
