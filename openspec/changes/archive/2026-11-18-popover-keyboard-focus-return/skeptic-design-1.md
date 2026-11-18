## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 9054da2a66ffb76619400817afbb7cdce4c8a1c2 (the change dir is untracked planning artifacts only; no code diff yet).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/popover-keyboard-focus-return/HEL-1759`.
- **Hook current behavior (design Context)**: `frontend/src/hooks/usePortalPopover.ts:74-87` has a document `keydown` listener for Escape only. That listener is the only place that calls `triggerRef.current?.focus()`. At `:92-108` the `focusout` listener closes when `relatedTarget` is outside trigger and panel, returns early on `relatedTarget === null`, and never moves focus. Both listeners are mounted only while `isOpen`. Confirmed.
- **Editor current behavior**: `DashboardAppearanceEditor.tsx:322-328` Save is `disabled={isSaving}`. `:113-117` resets the draft when `isOpen` goes false. `:178-196` `handleSubmit` has no in-flight guard. Confirmed.
- **The "page body" mechanism differs from the design's account. The fix still holds.** `DashboardAppearanceEditor.tsx:210` renders its scrim as `<button type="button" className="popover__scrim" onClick={close} />` with **no `tabIndex={-1}`**. ActionsMenu (`ActionsMenu.tsx:144`), OutputSchemaDisclosure (`:67`) and ProvenancePopover all set `tabIndex={-1}`.
  - So Shift+Tab from the editor's first preset does not go to the portal's DOM predecessor (design Context). It lands on the scrim, which is outside the panel and the trigger, so the popover closes. The scrim then unmounts and focus falls to `<body>`. That explains the ticket's "page body".
  - Design D1's parenthetical "(scrim is `tabIndex=-1`)" is false for the editor.
  - D1 is still correct: `relatedTarget` is the scrim (non-null), so the new branch fires.
  - For ActionsMenu, Shift+Tab from a `tabIndex=-1` item goes to the previous tabbable element in the page, not to body. That is still not the trigger, so it is still red on main.
- **Consumer enumeration** (`grep -rln usePortalPopover`). These attach the hook's `panelRef`:
  - ActionsMenu (`:147`)
  - Select (`:206`)
  - ProvenanceTrigger → ProvenancePopover (`:203`)
  - DashboardAppearanceEditor (`:213`)
  - **OutputSchemaDisclosure (`:70`)**: not named in the proposal's Impact list. Task 2.1 asks for an exhaustive enumeration, so this is covered procedurally.
  - UserMenu uses the hook but keeps its own local `panelRef` (`UserMenu.tsx:79-80`), so it is unaffected. IconButton only forwards a ref.
- **Per-consumer safety of D1** (refocus only when focus left from inside the panel and the move was caused by Tab):
  - **Select**: real focus stays on the trigger (virtual focus; options are not Tab stops, `Select.tsx:237`). The "started inside the panel" gate excludes it. A pointer click on an option clears the Tab flag. Safe.
  - **ProvenancePopover**: its native panel `keydown` (`ProvenancePopover.tsx:108-129`) calls `stopPropagation()` on every key and traps Tab. The hook's document-bubble listener never sees a Tab from inside it, so the change is a no-op there. Safe, and `handleClose`'s opener-focus logic is untouched.
  - **ActionsMenu**: items are `tabIndex=-1`, so Tab or Shift+Tab leaves the menu. Returning focus to the trigger matches the WAI-ARIA menu-button pattern. Safe, including inside a modal `<dialog>`: a Modal Tab trap that moves focus during the Tab keydown still counts as keyboard-caused.
  - **OutputSchemaDisclosure / editor**: forward Tab out of a body-portalled panel usually reaches browser chrome (`relatedTarget === null`). That is unchanged and is an explicit non-goal.
  - I found no React ancestor of any ActionsMenu call site that calls `stopPropagation` on keydown (grep over panels/ui, pipelines spine/mobile, shared/chrome, app, dashboards/ui returned no hits). The document-bubble Tab listener will therefore see the Tab keydowns, the same as the existing Escape path.
- **Existing specs**: `openspec/specs/portal-popover-hook/spec.md` has no focus requirement, so the ADDED requirement contradicts nothing. `popover-viewport-fit` has no failed-save requirement, so the ADDED one is new. Existing e2e that Tab inside these popovers:
  - `hel1756` (`:333-335`, `:405`): Tab stays inside the form.
  - `hel1003` (`:162-178`): arrow keys, then Escape.

  None of them asserts where focus lands after Tabbing out, so I expect no regression assertion to flip. Task 5.2 re-runs them anyway.
- **D2 (`aria-disabled` + submit guard)** is the right fix. A focused `disabled` button drops focus to body with `relatedTarget === null`, which is exactly the path the hook ignores. `aria-disabled` keeps focus on Save. DESIGN.md already sets this precedent (`DESIGN.md:1489-1490`: "`aria-disabled` rather than `disabled` so focus survives"). The design names both CSS sites to twin: `DashboardAppearanceEditor.css:74` `:hover:not(:disabled)` and `:78` `:disabled`.
- **Red-first is feasible**:
  - (a) On main, a keyboard Save disables the focused button. Focus goes to body and the editor stays open, so "focus on Save" fails.
  - (b) On main, Shift+Tab from the first preset ends with focus on body, so "focus on trigger" fails.
  - (c) On main, focus lands on a page element, not the trigger, so the assertion fails.
  - The hook unit cases can be driven in jsdom (Tab keydown dispatched to document, then `.focus()` outside) and mutation-tested.
- **Premise D4 (HEL-1756 emails already plain): CONFIRMED.** `e2e/hel1756-popover-viewport-fit.spec.ts:13` uses prefix `hel1756`. Every label is one of:
  - `${size.name.replaceAll(" ", "-")}-${theme}`, where the sizes are `:16-18` "desktop short", "desktop very short", "phone short"
  - `focus`, `cache-miss`, `cap`
  - `editor-${height}-${theme}`, `editor-focus`, `editor-error-${theme}`, `editor-kbd-${theme}`

  `uniqueEmail` (`e2e/support/auth.ts:42-44`) builds `prefix-label-ts-rand@example.test`, and every such local part matches `PLAIN_EMAIL_LOCAL = /^[A-Za-z0-9._+-]+$/` (`e2e/support/userCleanupCore.cjs:20`). Spaces appear only in `displayName`, not the email. This was the only commit touching the file (1e0d610bb). Correct: no edit is needed.
- **Scope**: every AC maps to a task (AC1 → 1.1/2.2/3.1/5.1; AC2 → 4.1). There is no work beyond the ticket's Fix bullets. Frontend only, with no API or schema change, so no contract delta is missing.

### Verdict: CONFIRM

The design is sound and implementable. The shared-hook change is additive, correctly gated against the Select virtual-focus and pointer cases, and inert for ProvenancePopover. D2 is the established repo pattern. The notes below are corrections the executor should absorb; none blocks implementation.

### Non-blocking notes

1. **Correct the mechanism in design.md Context and D1.** The editor's scrim (`DashboardAppearanceEditor.tsx:210`) is a tabbable, unnamed `<button>` with no `tabIndex={-1}`, unlike its siblings. Shift+Tab lands on it, and focus reaches body when it unmounts. The executor's D1 probe (task 1.2) should test this exact case, focus moving onto an element that unmounts in the same close, because a deferred `trigger.focus()` must survive the scrim's removal.
   - Consider adding `tabIndex={-1}` to the editor scrim to match ActionsMenu, OutputSchemaDisclosure and Provenance. It is an unlabeled tab stop, which axe flags as `button-name`.
   - If you add it, re-check that (b) is still red-first on main: the red run is against unmodified source, so it is unaffected.
2. **The failed-save error is not announced today.** `InlineError`'s default text variant renders a bare `<p className="inline-error">` with no `role` or `aria-live` (`shared/chrome/InlineError.tsx`, the text branch). D2 says "verify it is announced" but gives no fallback.
   - With focus parked on Save and the label silently reverting from "Saving..." to "Save dashboard style", a screen-reader user gets no failure feedback.
   - Pick one mechanism and unit-assert it. Options: a local `aria-live="polite"` / `role="status"` wrapper around the editor's `InlineError`, or `aria-describedby` from Save to the error `id` (`InlineError` accepts `id`).
   - Do not change `InlineError`'s shared default, which has about 30 call sites.
   - The AC (focus on Save or the error) is met either way, so this is a quality note, not an AC gap.
3. **Tab-flag hygiene.** Clear the flag on every `focusout` exit path, including the early `relatedTarget === null` and `!panelRef.current` returns. Also clear it on any non-Tab keydown and in the effect cleanup when the popover closes. A ref survives close/reopen, so a stale flag must not survive into a later programmatic focus move.
4. **Submit guard.** Back the early return in `handleSubmit` with a ref (`savingRef`) in addition to the `isSaving` state, so two submits in the same tick cannot both pass a stale closure.
5. **Listener phase.** The Tab tracking piggybacks on the existing bubble-phase document `keydown`. It works for every current consumer, because no ActionsMenu ancestor stops keydown propagation. If an ancestor ever stops propagation, though, Tab tracking silently disappears. A capture-phase listener for the Tab flag alone would be more robust. That is the executor's call, but record the decision.
6. **Impact list.** Add OutputSchemaDisclosure to proposal.md's `panelRef` consumer list, and include its unit/e2e coverage in task 5.2.
