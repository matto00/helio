### Frontend — anchor, scrim and motion

- [x] 1.1 Read `theme.css`'s top-chrome comment and the current `DESIGN.md`; cite no rule you have not confirmed exists in the file.
- [x] 1.2 Strip the panel's own anchoring: remove `position: fixed`, `left`, `right`, `bottom: 0`, and the now-stale `padding-bottom: env(safe-area-inset-bottom)` (design D4 — it double-counts the inset D5 subtracts and floats the grabber off the bottom edge). The panel gets NO `top` of its own (design D1). Mirror the radius/border treatment to the bottom edge.
- [x] 1.3 Start the backdrop at the same seam instead of `inset: 0`, so the command bar is left undimmed (design D2).
- [x] 1.4 Wire the command-bar trigger to toggle the sheet closed, and make the bar's other controls inert while it is open (design D2).
- [x] 1.5 Set `max-height` to `calc(100dvh - var(--app-top-chrome-height) - var(--bottom-nav-height) - var(--space-3))`. Consume the aggregate `--bottom-nav-height` token, which already sums capsule height, inset and bottom safe-area inset — do NOT re-inline its three inputs (design D5).
- [x] 1.6 Keep `env(safe-area-inset-top)` out of the stylesheet and bottom-nav tokens out of the top anchor; bottom clearance may use them.
- [x] 1.7 Add the clip wrapper, which OWNS the anchor: `position: fixed`, `top: var(--app-top-chrome-height)`, `left: 0; right: 0` (a fixed element with only `top` is shrink-to-fit), `z-index: var(--z-popover)`, `clip-path: inset(0 -100vmax -100vmax -100vmax)`, `pointer-events: none`.
- [x] 1.8 Make the panel `position: relative` inside it with `pointer-events: auto` and a non-competing `z-index` — required so the wrapper's stacking context cannot let the scrim paint over the sheet (design D3). Do NOT also give it `top`: on a relative box that is an offset from an already-correct position and would push the sheet a second seam-height down.
- [x] 1.9 Invert the entrance keyframe to originate at the top edge, running on the panel inside the wrapper.
- [x] 1.10 Add the wrapper selector to the EXISTING `prefers-reduced-motion` block. That block already sits after the panel's animation and works today — extend it, do not "fix" it (design D12).

### Frontend — gesture and structure

- [x] 2.1 Invert the drag maths so an upward drag past the threshold dismisses.
- [x] 2.2 Move the grabber and its `touch-action: none` region to the sheet's bottom free edge; keep the title at the top as the dialog heading.
- [x] 2.3 Give the bottom drag strip a literal `44px` min-height (design D4).
- [x] 2.4 Keep the create action outside the pointer-tracked region so its tap is not swallowed by the drag handler.
- [x] 2.5 Target initial focus at the active item, else the first item, else the panel itself when the list is empty — never the create action or the empty-branch CTA (design D10).
- [x] 2.6 Flip or rotate `CommandBar`'s `ChevronDown` while the sheet is open, so the glyph encodes state as well as direction (design D9b).

### Frontend — create action

- [x] 3.1 Add `createAction` (header) and `emptyCreateAction` (empty-branch CTA) to `PickerSelection`, each `CreateActionResult | null`, mirroring `SidebarItemList`'s `onAdd` vs `emptyCta` split. Import one existing `CreateActionResult`; do not consolidate the four declarations (fenced).
- [x] 3.2 Set both slots for `dashboards`/`sources`/`pipelines`; set ONLY `emptyCreateAction` (to the create-pipeline action) for `registry`; set neither for `metrics`/`chat`/`other`. Do not edit any hook file (HEL-554 fence).
- [x] 3.3 Thread BOTH `createAction` and `emptyCreateAction` through `MobileShell` into `MobileNavSheet`.
- [x] 3.4 Render it in the sheet header below the title, hairline-separated, using DESIGN.md §5's Secondary recipe — not an `li` of the item list.
- [x] 3.5 Take its label and glyph from `cta.label`/`cta.icon`; author no local strings or `+` character (ticket AC3; spec scenario "Action label and glyph come from the hook").
- [x] 3.6 Give it a literal `44px` min-height at the mobile breakpoint.
- [x] 3.7 Suppress the header action whenever the empty branch renders its CTA, so exactly one create affordance is ever visible (design D6).
- [x] 3.8 Surface a failed create as error-intent `EmptyState` in the empty branch and the shared inline-error primitive beside the header action in the list branch; express pending via the hook's label swap and do NOT disable the control (design D9).
- [x] 3.9 Dismiss per design D9: sources/pipelines/registry dismiss on fire so their modal never opens behind the sheet; dashboards keeps the sheet open while pending, dismisses on success, stays open on failure. Implement entirely consumer-side — the hook exposes no reset and no success callback and is FENCED: keep a per-open-session "attempt fired" flag (reset when `open` flips true) gating whether `createAction.error` is shown, and infer success from an `isPending` true->false transition with `error === null`, using a ref to exclude the initial `false`.

### Frontend — empty branch (folded-in HEL-782 subset)

- [x] 4.1 Add a shared per-section empty-state table supplying `icon`/`title`/`description`, covering every `PickerId` member including the unreachable `other`, matching the desktop copy. Do NOT edit `SidebarBody`/`SidebarItemList`/`DashboardList` — escalate if that seems required.
- [x] 4.2 Replace the bare `<p class="mobile-nav-sheet__empty">` with `EmptyState variant="sidebar"` fed from that table, passing `emptyCreateAction.cta` (NOT `createAction.cta`) where non-null — registry sets only the empty slot.
- [x] 4.3 Retire the now-dead `emptyMessage` prop and all seven of its values in `usePickerSelection` (including `other`'s `""`), the `.mobile-nav-sheet__empty` rule, and the existing "shows the empty-state message" test that passes the prop; add no new hook and no new modal mount.
- [x] 4.4 Correct `EmptyState.css`'s 44px comment, which calls the floor defensive because "the sidebar column is not mounted at this breakpoint" — this change makes `variant="sidebar"` render at phone width for the first time, so that is now false.

### Tests

- [x] 5.1 Reproduce the pre-fix behaviour on the unfixed build first — bottom anchor, no create action, bare `<p>` — so every new probe is proven able to fail.
- [x] 5.2 Narrow the "no CRUD affordances" guard to assert the surviving prohibitions AND at most one create action; do not delete it (design D13).
- [x] 5.3 Update the CSS locks for the new anchor; lock no `env(safe-area-inset-top)` anywhere, no bottom-nav token in the `top` declaration specifically, and no lingering `padding-bottom: env(safe-area-inset-bottom)`. Add a positive ordering lock too, per `BottomNav.css.test.ts`'s precedent: assert each new 44px selector appears exactly once, so a later equal-specificity rule cannot silently shadow it (the HEL-535 defect class).
- [x] 5.4 Test that the create action opens the section's real modal from the sheet for sources/pipelines/registry — assert the modal appears, not that a redux flag was set. Dashboards has no modal: assert its POST instead (design D14).
- [x] 5.5 Test that a section with a create action renders exactly one create affordance whether or not it has items.
- [x] 5.6 Test upward drag-to-dismiss, backdrop tap, Escape, trigger-tap-to-close, focus trap, initial focus on the list, and focus restored to the trigger.
- [x] 5.7 Update `App.test.tsx`'s two assertions on retired `emptyMessage` strings ("No pipelines yet.", "No conversations yet.") rather than deleting them — they are the only App-level proof the empty branch renders end to end, which is AC8's real shape. Test the empty branch per section class: `EmptyState` with CTA where a create action exists, message-only where it does not.
- [x] 5.8 Lock the shared table's copy against the desktop sidebar's rendered copy for the five sidebar-owned sections only; exclude dashboards and comment why (HEL-554 owns that surface).
- [x] 5.9 Test the create-failure and pending presentations from 3.8, AND the dismissal timing from 3.9 — including that a failure leaves the sheet open and that reopening shows no stale error.
- [x] 5.10 Prove each new guard goes red against a deliberately broken variant before trusting it green.

### Tests — running application

- [x] 6.1 Launch your OWN headless Chromium (`~/.cache/ms-playwright/chromium-1208`); do not use the shared MCP Playwright session.
- [x] 6.2 Force `--app-safe-top` on `document.documentElement` ONLY (the seam is substituted at computed-value time on the declaring element, so setting it elsewhere silently no-ops), measure at 0/47/59px, and assert `sheetRect.top === commandBarRect.bottom` at each — plus that the three measured tops actually differ, so the probe cannot silently no-op (AC2).
- [x] 6.3 Measure with `getComputedStyle` at 430 and 768 that every row, the header action, the empty-branch CTA element, and the drag strip are all at least 44px — never by reading the CSS.
- [x] 6.4 Assert the command bar is neither overlapped nor dimmed at any frame, using `document.elementFromPoint()` at the bar's and trigger's centres, or sampled pixels — NOT `getBoundingClientRect`, which ignores `clip-path` and would show the panel above the seam mid-entrance even when correct, sending you to "fix" working CSS (design D3).
- [x] 6.5 Assert the drag strip's bottom edge sits above the floating bottom nav's top edge at 430px (design D5).
- [x] 6.6 Emulate `prefers-reduced-motion: reduce`; assert computed `animation-name: none` for panel, wrapper and backdrop. Apply 5.10's red-first discipline to whichever element actually carries the entrance (the panel, under D3-as-designed) — asserting it on an element that never animates is vacuous.
- [x] 6.7 Exercise the direction change on a create-action section and a no-action section, at 430px and 375px, in both themes (AC1/AC6).
- [x] 6.8 Run `npm run lint` and `npm test`; zero new warnings (AC7). Remove any non-PNG probe artifacts your run created.

### Delivery

- [ ] 7.1 At archive, correct the capability's stale "bottom-sheet picker" Purpose wording (design D13).
