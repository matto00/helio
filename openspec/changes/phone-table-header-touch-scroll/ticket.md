# HEL-1692: Phone dashboards: a vertical drag starting on a Table column-resize handle (or a capped Table body) can't scroll the page

## Description

Follow-up from HEL-1682 (PR #1081, merged as edd3a028f), whose flake root cause was a real usability bug. On phone dashboards, every Table header column edge has an 8px resize handle (`span.ui-data-grid__resize-handle`) with `touch-action: none`. A vertical drag that starts on it never starts native scrolling, so the page doesn't scroll. At 375px a column edge sits at the screen centre (x = 187.5), right where a thumb drags.

Related, but not probed: a drag inside a height-capped Table body may scroll the body, not the page.

Fix options (from the ticket):

- Make resize handles `touch-action: pan-y` on touch devices, so they still resize horizontally but let vertical pans through.
- Hide or disable column resize on phones.
- Enlarge the handle and let it react only to horizontal movement.

## Acceptance Criteria

- On a phone (375 and 430, touch emulation), a vertical drag starting anywhere on a Table header, including a resize handle, scrolls the page.
- Column resize still works on desktop.
- e2e coverage that fails first.
- The capped-body case is triaged and fixed or documented.

## Driver context

- Reproduce at a phone viewport with real touch input (Playwright `hasTouch` + CDP `Input.dispatchTouchEvent`) before building anything.
- If the fix turns into a product/interaction decision (e.g. whether column resize should exist on phones), escalate with options and a recommendation.
- react-grid-layout stays at 2.2.4 (HEL-1728) — do not upgrade it.
- Use `e2e/support/panelGridReady.ts` `waitForPanelStack` (phone) / `waitForPanelGrid` (desktop) before measuring cards.

## Owner ruling (2026-11-17, escalation HEL-1692-1794878263254-f8fa5a): ship-pan-y-as-guard

The premise did not reproduce failing-first: with real CDP touch at 375 and 430 (fit table, horizontally overflowing table, each also under 4x CPU throttle plus a 400ms main-thread stall), a vertical drag from a `touch-action: none` resize handle scrolled the page 8/8 times. iOS WebKit is untested here. The owner accepted dropping the "e2e coverage that fails first" AC. Revised AC:

- `touch-action: pan-y` on `.ui-data-grid__resize-handle`; column resize still works on desktop.
- e2e coverage labelled as a GUARD (not failing-first proof), shown failable by mutation.
- The capped-body case is triaged in the e2e, using the live selector `.mobile-panel-stack__item--output .panel-content`.
- The PR states plainly: not reproduced in Chromium (8/8 scrolled, incl. throttled runs), iOS WebKit untested, owner accepted dropping the fails-first AC.
- The dead `.mobile-panel-stack__item--table` rule is deleted in this PR or filed as a follow-up (PR says which).
