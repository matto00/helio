## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 28fe1068cfc9c07d8448cfaf49a3434cd360ffd7. The base was resolved live with resolve-review-base.sh: 9054da2a66ffb76619400817afbb7cdce4c8a1c2 (exit 0). The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=bug/popover-keyboard-focus-return/HEL-1759`.

### What I verified (with evidence)

**Diff read in full.** I read `git diff 9054da2a6...HEAD -- frontend` and the whole of `usePortalPopover.ts` at HEAD. The diff covers:
- the hook: a capture-phase Tab flag that expires after one `setTimeout(0)` tick, plus a refocus via `queueMicrotask` in the focusout handler, gated on `viaTab && panelRef.current.contains(event.target)`;
- the editor: `aria-disabled` while saving, a `savingRef` guard, `aria-describedby` pointing to an `aria-live="polite"` wrapper, and `tabIndex={-1}` on the scrim;
- the CSS: the `:disabled` selectors now target `[aria-disabled="true"]`.

**Every consumer that attaches `panelRef`, checked by grep and by reading the source:**
- **ActionsMenu.** Its items are `tabIndex=-1`, so Tab or Shift+Tab leaves the panel. The menu now closes and focus returns to the trigger. The panel is portalled into `dialog[open]` when one is open.
  - Inside the Modal: the Modal's Tab trap only acts when `activeElement` is the dialog's first or last tabbable. A menu item never is, so the browser's default move happens and the hook refocuses the trigger inside the dialog. The phone e2e case covers this in the step sheet.
- **Select.** It uses virtual focus: real focus stays on the trigger and the options are `tabIndex=-1`. The `contains(event.target)` gate therefore never refocuses, and Shift+Tab off the trigger moves on, so the user is not trapped.
- **ProvenancePopover.** It traps Tab inside its own panel with `preventDefault` and refocus at both ends, so focus never leaves the panel and the change has no effect there. The capture-phase flag still gets set, which is harmless.
- **OutputSchemaDisclosure.** Its panel is portalled. Keyboard Tab from the trigger leaves from the trigger, so there is no refocus. Only a pointer-entered focus inside the panel followed by a keyboard Tab would refocus the trigger, which is the specified rule.
- **DashboardAppearanceEditor.** Verified live (below).

**Live keyboard checks on this lane's own servers.** I checked that 7191 and 10098 are served from this worktree's `frontend/` and `backend/` (via `/proc/<pid>/cwd`), and that the served `usePortalPopover.ts` contains `tabbingRef`. The browser URL was http://localhost:7191 throughout. Results at 1280x900:
- **Editor, light: Shift+Tab from the first preset.** Opened with Enter on the trigger. Focus went Default → trigger with no stray body focus in between. The form closed and the trigger shows `:focus-visible` true. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/skeptic/desktop-light-shifttab-trigger.png`.
- **Editor, light: failed save.** I picked Twilight with Tab+Space, then pressed Tab 14 times to reach Save and Enter. The PATCH was forced to fail with an in-page XHR rewrite. Afterwards:
  - focus stayed on Save;
  - `aria-describedby` was `dashboard-appearance-editor-error` and the region has `aria-live="polite"`;
  - the error text showed and Twilight was still `aria-pressed`;
  - the next Shift+Tab moved to the grid colour input with the editor still open and the pick intact.

  Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/skeptic/desktop-light-failed-save.png`.
- **Editor, dark: request held in flight.** With the request held, two Enter presses on Save. Save kept focus with `aria-disabled="true"` and showed "Saving...". Computed style was opacity 0.7, cursor wait, background rgb(249,115,22), the same visual state the old `:disabled` rule produced, plus the focus ring. After I released the request it failed and focus was still on Save, with the error shown.
  - In flight: `/home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/skeptic/desktop-dark-saving.png`
  - After the failure: `/home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/skeptic/desktop-dark-failed-save.png`
- **Editor, dark: Shift+Tab from the first preset.** Focus landed on the trigger with `:focus-visible` true, and the form closed.
- **Actions menu, light: forward Tab from the first item** (a case the e2e does not cover). Focus went Rename → trigger and the menu closed. This matches design D1.
- **Pointer path.** A scrim click closed the menu and did not refocus the trigger, which is unchanged from before.

**e2e, run by me.** The command was `DEV_PORT=7191 BACKEND_PORT=10098 npx playwright test hel1759 hel1756 hel1750 --project=dev --workers=2`. Result: 34 passed, 4 skipped, EXIT 0. The 4 skips are the phone editor cases. Teardown deleted the 34 recorded users. Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/skeptic/e2e.txt`.
- The phone skip is justified. The per-theme "trigger hidden at 390" test passed, and the editor's only mounts are `CommandBar.tsx` and `DashboardMetaRow.tsx`.

**Jest, run by me.** I ran the unit suites for every consumer plus the hook and the editor (pattern usePortalPopover|DashboardAppearanceEditor|ActionsMenu|Select|Provenance|OutputSchemaDisclosure, maxWorkers 3): 27 suites, 202 tests passed, EXIT 0.

**Red-first.** I read the executor's red transcripts rather than re-creating a main checkout.
- The desktop failed-save case fails on main because focus is on `BODY` where `BUTTON` is expected while the save is in flight. That is the `disabled`-drops-focus defect.
- The Shift+Tab editor and menu cases fail because the trigger is "inactive". The phone step-sheet menu case is red in red-run3-phone.txt at the trigger-focus assertion.
- These are the right reasons.
- The earlier red-run.txt phone failures were for setup reasons, not the defect. The spec was then restructured: red-run3-phone gives the menu case a right-reason red, and the editor phone cases are now skipped with stated evidence.
- The unit mutations M1–M7 each turn exactly one targeted test red (mutations.txt). That includes M7, which removes the timer expiry and fails the "Tab that moved no focus" test.
- The evaluator's timing probe (tab-timing-probe.txt) shows the order keydown → microtask → focusout → timer. My live run is consistent with it: the refocus lands and focus never rests on body.

**AC2 (HEL-1756 emails).** The HEL-1756 spec is unchanged in the diff. All 18 hel1756 throwaway emails printed in my run are plain addresses with no spaces.

**Cleanup.** I deleted my own throwaway user e80b2f1c-ee52-4f3f-a09e-82c5c8f55c00 by exact id through `buildUserDeleteSql`/`psql`. `/api/auth/me` returns 401 afterwards.

### AC trace
- AC1, failed save: the editor stays open with focus on Save. Code: `DashboardAppearanceEditor.tsx`, Save `aria-disabled` and the `savingRef` guard. Verified by e2e and live in both themes.
- AC1, Shift+Tab from either popover lands on its trigger. Code: the `usePortalPopover.ts` focusout refocus. Verified by e2e at desktop and phone in both themes, and live for both popovers.
- AC1, red first: transcripts as above.
- AC2: re-verified true on main and unchanged.

### Verdict: CONFIRM

### Non-blocking notes
- Forward Tab off the last menu item now returns to the trigger, not to the next page element. This is the documented design (D1, and the ticket's Fix bullet). The WAI-ARIA menu-button pattern prefers that Tab moves on. If owners prefer that, a follow-up could limit the refocus to Shift+Tab.
- `PHONE_EDITOR_REASON` mentions 768, but only 390 is asserted. The evaluator raised this too.
- The pointer scrim click still leaves focus on `<body>`. This predates the change and is out of scope.
- No gate defect: none of the evidence I relied on rests on mtime ordering.
