## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD f70faaa62c5464b287d10894007d3128c8ef4d6e against live-resolved base 2e98eba9287d61a47957129f1f097ea039125d92 (resolve-review-base.sh, exit 0).

### What I verified (with evidence)

- **Diff read in full.** The change is in `shared/ui/panelFit.ts` (new `fitPanelVertically`), `shared/ui/selectPanelFit.ts` (now a wrapper), `shared/chrome/ActionsMenu.tsx` (placement via `usePortalPopover({ place })`, `visibility: hidden` until placed, inline `maxHeight`, first-item focus gated on `placed`), `ActionsMenu.css` (`overflow-y: auto`) and `hooks/usePortalPopover.ts` (shared `VIEWPORT_MARGIN` import only). On base, the panel was placed once at `top: rect.bottom + 8` with no collision handling (visible in the removed lines of `handleToggle`). That is the root cause, and it matches the probe in files-modified.md: no clipping ancestor, a fixed panel past the viewport edge.
- **Unmodified tests.** `ActionsMenu.test.tsx` only has a new describe block appended after line 193, so the HEL-719 align tests (~139-156) are untouched. `selectPanelFit.test.ts` is not in the diff at all.
- **Select behaviour.** For naturalHeight > 0, `fitPanelVertically` with prefer "below" follows the old `fitSelectPanel` branches exactly: fits below, flips when above > below, otherwise below capped at max(below, 0). The only divergence is naturalHeight 0, which used to give maxHeight 0 and now gives Infinity. `Select.tsx:148` returns early on `scrollHeight === 0` before it calls `fitSelectPanel`, so Select cannot reach that path.
- **SidebarItemList.** `SidebarItemList.tsx:440` renders ActionsMenu only when `onDelete !== undefined`. Its only production consumer, `AssistantContextList.tsx:66`, passes no `onDelete` (comment at line ~81). The claim holds.
- **Jest (fresh run):** `npm --prefix frontend test -- --maxWorkers=3 --testPathPatterns='ActionsMenu|PanelFit|panelFit|Select|usePortalPopover'` gave 13 suites and 103 tests passed.
- **typecheck / eslint (--max-warnings=0) / prettier --check** on the changed files: all clean.
- **e2e (fresh run):** `DEV_PORT=7182 ... playwright test e2e/hel1750-actions-menu-viewport-fit.spec.ts --workers=2` gave 2 passed (9.4s), and teardown deleted 2 recorded throwaway users (exact-id harness). The desktop case runs without `hasTouch` (fine pointer). `hasTouch` is applied only inside the nested `phone` describe.
- **Red-first:** I read the recorded red in `.concertino/scratch/HEL-1750/e2e-red-unfixed-cycle2.txt`. Desktop: last item "Delete" bottom 554 > 400, panel 394-559, hitIsItem false (a 165px panel, which is the fine-pointer size). Phone: "Add output" bottom 342 > 300, hitIsItem false. I did not re-run the red myself, because the skeptic is read-only and cannot revert code. The red does follow directly from the base code's `rect.bottom + 8` with no fit, which is shown in the diff's removed lines. Disclosure: this rests on the recorded artefact plus that analysis, not on a fresh red run of mine.
- **Live app, desktop, owner-reported surface (rail dashboard list, mouse, `(pointer: fine)` true):**
  - At 1280x500, I opened the ⋮ menu on the last row (trigger bottom 345). The menu flipped above, with inline `bottom: 187px` (= 500 - (321 - 8)), panel 148-313. I checked all 5 items (Rename to Delete) and each was hit at its own centre by `elementFromPoint`. Focus landed on Rename. `scrollHeight == clientHeight` (163), so no spurious scrollbar.
  - Screenshots, dark: `/home/matt/Development/helio/.concertino/runs/HEL-1750/evidence/.concertino/runs/HEL-1750/evidence/skeptic-final-dashlist-dark.png`; light: `.../skeptic-final-dashlist-light.png`. Styling (surface, border, danger Delete, radius, shadow) is the same shared popover in both themes, with nothing new or hardcoded.
- **Regression, room below:** at 1280x800 the same trigger's menu opens below at `top: 353px` (= trigger bottom 345 + 8), with its right edge aligned to the trigger's right (291). This is identical to the base behaviour.
- **Live app, phone (390x300, in-dialog MobileStepSheet "Step actions"):** the panel portals into the dialog (`closest('dialog')` true) and is capped at `max-height: 219px` (panel 73-292, scrollHeight 272 > clientHeight 217, so it scrolls inside). After focusing the last item ("Add output", 243-287), it is hit at its centre. Screenshots: `.../skeptic-final-phone-dark.png` and `.../skeptic-final-phone-light.png` (same evidence dir). Parity is fine in both.
- **Console:** the only error was a 404 on `/api/pipelines/:id/schedule` (that pipeline has no schedule; pre-existing and unrelated).
- **AC trace:**
  1. Whole menu visible and clickable from any row, including the last and a scrolled list, on desktop and phone, light and dark: met by the e2e plus my live probes. On phone, the dashboard list has no ⋮ (MobileNavSheet uses a Share button). This was confirmed at the design gate and is recorded in files-modified.md.
  2. Cause from a probe, not a guessed bigger container: met (premise-validation/probe report; the fix is collision-aware placement, not container resizing).
  3. Other ActionsMenu sites audited: met. The table covers all 13 sites; they share the component, so all inherit the fit. Other popovers are listed as follow-up candidates.
  4. e2e red first with an `elementFromPoint` last-item assertion: met (spec present, green now, recorded red).

### Verdict: CONFIRM

### Non-blocking notes
- When the menu is capped and scrolling inside itself (phone short viewport), nothing shows that it scrolls beyond the partly visible first or last row (no persistent scrollbar on overlay-scrollbar platforms). It is reachable by touch-scroll and End/arrows, so this is cosmetic. A fade affordance could be a follow-up.
- `placeActionsMenu` measures width via `getBoundingClientRect()` while the open animation may still be scaling the panel. Any left-clamp error would be a few px at most, and the hook's existing clamp still backs it up.
- `fitPanelVertically`'s `top` for an "above" result is computed but unused by ActionsMenu (it uses `bottom`). This is harmless.
