## Files modified

- `frontend/src/shared/chrome/MobileNavSheet.tsx` — full rewrite: top-anchored clip wrapper, inverted drag (upward-dismiss), header/empty-branch create action with D9 dismiss/error/pending logic, D10 initial-focus targeting, `EmptyState` empty branch.
- `frontend/src/shared/chrome/MobileNavSheet.css` — anchor moved to the clip wrapper (`--app-top-chrome-height`), backdrop starts at the seam, panel loses its own `top`/`position:fixed`, entrance keyframe inverted, drag strip + header create-action 44px floors.
- `frontend/src/shared/chrome/usePickerSelection.ts` — added `createAction`/`emptyCreateAction` (calls the three HEL-548 hooks unconditionally, D8), retired `emptyMessage`.
- `frontend/src/shared/chrome/pickerEmptyState.tsx` — new: the shared per-`PickerId` empty-state icon/title/description table (design.md D11).
- `frontend/src/shared/chrome/pickerEmptyState.test.tsx` — new: locks the table's copy against `SidebarBody`'s rendered copy for the five sidebar-owned sections.
- `frontend/src/app/MobileShell.tsx` — threads `emptyState`/`createAction`/`emptyCreateAction` from `usePickerSelection`/`pickerEmptyState` into `MobileNavSheet`.
- `frontend/src/app/CommandBar.tsx` — trigger's chevron flips open/closed (D9b); non-trigger command-bar controls go `inert` while the sheet is open (D2), via a `display:contents` wrapper so `inert` doesn't disturb `.app-command-bar__left`'s flex layout.
- `frontend/src/app/App.css` — `.app-command-bar__inert-group { display: contents; }`; chevron rotation CSS.
- `frontend/src/app/App.tsx` — the mobile-nav-sheet trigger callback now toggles (`!wasOpen`) instead of always opening (D2).
- `frontend/src/shared/ui/IconButton.tsx` — cycle 1 added an unused `inert` passthrough prop here; removed in cycle 2 (CR3, evaluation-1.md). `CommandBar.tsx`'s `display: contents` inert-group wrappers (and `.app-command-bar__right` directly) are what actually implement D2 — the phone "New chat" `IconButton` goes inert via being inside one of those wrappers, not via a prop on itself.
- `frontend/src/shared/ui/EmptyState.css` — corrected the stale 44px-floor comment (it called the mobile floor defensive-only because the sidebar column wasn't mounted at phone width; `MobileNavSheet` now renders `variant="sidebar"` there for real).
- `frontend/src/shared/chrome/MobileNavSheet.css.test.ts` — rewritten CSS regression locks for the new top anchor, clip-wrapper stacking, scrim-stops-at-seam, inverted entrance, D5 height clamp, reduced-motion coverage, and 44px ordering locks (`BottomNav.css.test.ts` precedent).
- `frontend/src/shared/chrome/MobileNavSheet.test.tsx` — rewritten: narrowed CRUD guard (permits exactly one create action), create-action label/icon/44px/dismiss-timing/error/pending/stale-failure coverage (a stateful harness component faithfully reproduces the real hook's same-tick pending flip — see its docblock), inverted drag-to-dismiss, D10 focus targeting.
- `frontend/src/app/App.test.tsx` — updated the two retired-`emptyMessage`-string assertions (pipelines/chat empty branches) to assert the shared `EmptyState` shape instead (CTA present vs. message-only, per section).
- `frontend/src/test/jest.setup.ts` — added a minimal `PointerEvent`/`setPointerCapture` polyfill (jsdom implements neither; needed for the new drag-to-dismiss tests).
- `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts` — new: live-browser verification of the safe-area-tracking anchor (0/47/59px), computed 44px floors at 430/768, command-bar non-overlap/non-dim via `elementFromPoint`, bottom-nav clearance, reduced-motion, and the direction change at 430/375px in both themes (tasks 6.1-6.7).

## Root cause note (systematic-debugging, e2e probe defect)

- **Symptom:** the e2e 44px test initially measured the empty-branch CTA at 28px instead of >=44px.
- **Root cause:** the probe's `document.querySelector(".ui-empty-state__cta")` matched the desktop sidebar's own (CSS `display:none` at phone width, but still-mounted) `SidebarItemList` empty-state CTA — not the sheet's portaled one. A `display:none` subtree never runs layout, so its `min-height` clamp never applies and `getComputedStyle().height` falls back to the raw specified `height` (28px, `--control-sm`).
- **Probe:** scoped the query to `document.querySelector('[role="dialog"] .ui-empty-state__cta')` and re-measured.
- **Probe output:** `{"dialogHeight":"44px","dialogBoundingHeight":44}` — the sheet's own CTA was correct all along; only the test's selector was unscoped.
- **Fix:** scoped the e2e query to `[role="dialog"]`; no production code changed for this specific finding.

## Cycle 2 (evaluation-1.md change requests)

- `frontend/src/shared/chrome/MobileNavSheet.tsx` — CR1 fix + CR1 test-support comments.
- `frontend/src/shared/chrome/MobileNavSheet.test.tsx` — CR2 regression test.
- `frontend/src/shared/ui/IconButton.tsx` — CR3: removed the unused `inert` prop.
- `openspec/changes/top-anchored-mobile-nav-sheet/files-modified.md` — corrected the CR3 claim (this file).

### CR1 — root cause note (systematic-debugging)

- **Symptom:** after firing any create action from the sheet, the very next tap on the
  command-bar trigger appeared to do nothing — the sheet opened and closed again within
  ~14ms, requiring a second tap. Reported by the evaluator with a `MutationObserver` trace
  on both hook classes (dashboards, sources).
- **Root cause (component layer, `MobileNavSheet.tsx`'s dismissal-effect lifecycle):** the
  "attempt fired" reset effect only cleared `attemptFired` `if (open)` — i.e. on *opening*,
  never on *closing*. `attemptFired` therefore survived a close. Separately, the dismissal
  effect's dependency array includes `onClose`, which `App.tsx`'s `AppShell` recreates as a
  fresh closure on every render (an inline arrow, not memoized) — so the dismissal effect
  re-evaluates on renders where `attemptFired`/`isPending`/`error` haven't actually changed,
  including the render where the sheet has just reopened. On that reopen render the effect
  read the still-`true`, never-reset `attemptFired`, saw the same settled
  `isPending:false, error:null` from before, and called `onClose()` immediately — closing
  the session the user had just (re)opened.
- **Probe:** added `frontend/src/shared/chrome/MobileNavSheet.test.tsx`'s "does not call the
  reopened session's onClose after a create action fired in a prior session, even with a
  fresh onClose identity every render" — fires a flag-flip create action, rerenders with
  `open:false` and a fresh `onClose`, then rerenders with `open:true` and *another* fresh
  `onClose` (mirroring `App.tsx:199`'s per-render closure), and asserts the reopened
  session's own `onClose` is never called.
- **Probe output (pre-fix, `git show HEAD:...MobileNavSheet.tsx` swapped in against the
  new test):**
  ```
  expect(jest.fn()).not.toHaveBeenCalled()
  Expected number of calls: 0
  Received number of calls: 1
  ```
  Confirmed red. Restored the fix and re-ran: `28 passed, 28 total`.
- **Fix:** (1) the reset effect now unconditionally calls `setAttemptFired(false)` on every
  `open` transition, not just when opening, so the flag can never outlive its session even
  for one render; (2) the dismissal effect's guard gained `!open` (and `open` was added to
  its dependency array) so a stale read can never act while the session it belongs to isn't
  the current one. Both changes are in `MobileNavSheet.tsx`; `App.tsx`'s `onClose` callback
  was not touched — not because it is fenced (it isn't; HEL-554's fence covers the HEL-548
  hooks and the sidebar/onboarding surfaces, not this file), but because it was simply the
  wrong layer for the fix: the session lifecycle stays entirely consumer-side, per design.md
  D9 (skeptic-final-1.md, non-blocking correction).

## Cycle 3 (skeptic-final-1.md change requests)

- `frontend/src/shared/chrome/MobileNavSheet.css` — CR1: icon sizing fix.
- `frontend/src/shared/chrome/MobileNavSheet.tsx` — CR2: corrected the `renderCreateActionIcon`
  docblock to state the sizing mirror explicitly (it was previously true for markup only).
- `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts` — new permanent regression case for CR1
  (icon size, both themes, `getBoundingClientRect` on the rendered `<svg>`, scoped to the
  sheet's own dialog).
- `openspec/changes/top-anchored-mobile-nav-sheet/files-modified.md` — corrected the cycle-2
  "fenced" claim about `App.tsx` (this file).

### CR1 — root cause note (systematic-debugging)

- **Symptom:** the header create action's `+` glyph rendered at 24×24px next to a 14px label —
  2.1x the app's shipped treatment of the identical icon elsewhere in the same component
  (the empty-branch CTA, 9.59px) and 2.5x the desktop `EmptyState` CTA using the same hook.
  Reported by the skeptic with computed measurements in both themes and side-by-side
  screenshot crops.
- **Root cause (CSS layer, `MobileNavSheet.css`):** the three HEL-548 hooks pass a lucide
  `ReactNode` (`<Plus />`) whose `<svg>` carries literal `width="24" height="24"` attributes.
  `EmptyState.css` neutralises this with a `.ui-empty-state__cta-icon svg { display: block;
  width: 1em; height: 1em; }` descendant rule; `MobileNavSheet.css` had no equivalent — its
  `.mobile-nav-sheet__create-action-icon { font-size: 0.9em; }` rule could only ever affect the
  FontAwesome branch of `renderCreateActionIcon` (a path no hook actually exercises), so it
  silently computed to nothing for every real consumer.
- **Probe:** a scratch Playwright script (not committed) measuring
  `document.querySelector('[role="dialog"] .mobile-nav-sheet__create-action').querySelector("svg")
  .getBoundingClientRect()` at 430px in both themes, plus the same measurement folded into a
  new permanent case in `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts`.
- **Probe output (pre-fix, `git show HEAD:...MobileNavSheet.css` swapped in against the
  running dev server):**
  ```
  dark  {"labelFontSize":"14px","svgWidth":24,"svgHeight":24}
  light {"labelFontSize":"14px","svgWidth":24,"svgHeight":24}
  ```
  Confirmed red — matches the skeptic's reported measurement exactly. The new permanent e2e
  case was also confirmed red against the same pre-fix CSS (`Expected: < 16, Received: 24`).
  Restored the fix and re-ran: both themes measure `svgWidth === svgHeight === 11.1875px`
  (identical to the desktop main `EmptyState` CTA using the same hook, per the skeptic's own
  reference table), and the full e2e suite (11/11) passes.
- **Fix:** added `.mobile-nav-sheet__create-action-icon svg { display: block; width: 1em;
  height: 1em; }` to `MobileNavSheet.css`, mirroring `EmptyState.css`'s rule verbatim, and
  aligned the wrapper's `font-size` from `0.9em` to `0.8em` to match
  `.ui-empty-state__cta-icon` exactly (no remaining deliberate divergence).
