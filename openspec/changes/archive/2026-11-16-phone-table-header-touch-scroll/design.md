## Context

See proposal.md (Why). Current state, measured from the tree at d60b1f799:

- `.ui-data-grid__resize-handle` (DataGrid.css) is `position: absolute`, 8px wide (`--space-2`), centred on the column's right edge, `touch-action: none`. Rendered for `variant === "full"` and non-inert columns (DataGrid.tsx ~1136).
- The resize gesture is mouse-only: `onMouseDown` installs window `mousemove`/`mouseup` listeners (DataGrid.tsx ~755). `onPointerDown` only stops propagation. There is no touch/pointer resize path, so on a phone the handle never resized anything — `touch-action: none` only blocks panning.
- Phone stack: a Table panel is a `PanelKind` `output` panel, so its card is `.mobile-panel-stack__item--output` and the live 60dvh cap is `.mobile-panel-stack__item--output .panel-content`, but that cap never overflows (skeptic live measure: 487/487 at 375, 559/559 at 430); the element that actually scrolls vertically is `.ui-data-grid` inside it (2854/418 at 375, 2854/490 at 430), which also contains the sticky header (HEL-451 no-scroll invariant). The `.mobile-panel-stack__item--table .panel-content--table` rule (MobilePanelStack.css ~102) matches nothing: `PanelKind` is `output | text | markdown | image | divider | form` and the stack class is `--${panel.type}`.
- Measured (executor, cycle 1): the bug does NOT reproduce failing-first in Chromium. Real CDP touch, `elementFromPoint` confirmed on the handle (`touch-action: none`), 120px vertical drag, page scrolled away from the top: the page scrolled 8/8 (375 and 430; fit table and horizontally overflowing table; each also under 4x CPU throttle + 400ms main-thread stall). Control: `touch-action: none !important` injected on Notes cards DID block the pan, so the harness honours touch-action. Only the 3-4px left half of the 8px handle is hittable (the `th` is `overflow: hidden`). HEL-1682's single STUCK sighting (probe-busy-chain.log, 1/8 under load) remains unexplained. Owner ruling: ship `pan-y` as a guarded defensive change. `.app-content[data-pull-refresh]` has `overscroll-behavior-y: contain`, which governs chaining *past* `.app-content`, not chaining *into* it from a nested scroller.

## Goals / Non-Goals

**Goals:** no element of a Table header restricts vertical panning; desktop mouse/keyboard resize unchanged; GUARD e2e with real touch at 375 and 430, each guard shown failable by mutation; the capped-body case measured and either fixed or documented; dead `--table` CSS removed.

**Non-Goals:** adding touch column resize on phones (it never existed; a capability addition is a product call — at most a follow-up); changing the Table cap or making the phone Table body non-scrolling; any change to pull-to-refresh logic; react-grid-layout (stays 2.2.4).

## Decisions

### D1. `touch-action: pan-y` on the handle, at every width (ticket option 1)

`touch-action` affects only touch and pen input, never mouse, so desktop mouse resize is untouched by construction. `pan-y` lets the browser take vertical pans while still withholding horizontal panning, so a pen's horizontal drag keeps producing the compat mouse events the mouse-driven resize already relies on.

Alternatives:
- `touch-action: auto` — also fixes the bug, but a horizontal pen drag on the handle would then be consumed as a horizontal table pan, losing pen resize on touch-capable laptops. Rejected: no gain over `pan-y` for the bug.
- Hide/disable the handle on phones (`pointer: coarse` or width media query) — removes a keyboard-focusable control on touch laptops/tablets with keyboards and is a product call (capability removal). Not needed: with `pan-y` the handle stops blocking anything. Rejected.
- Enlarge the handle and react only to horizontal movement — means writing a touch resize path, i.e. adding a capability. Out of scope (Non-Goals).

Because none of the chosen behaviour removes or adds a capability (touch never resized before and does not now), this is not a product decision and is not escalated.

### D2. Guard e2e with real touch, two widths (owner dropped "fails first")

New spec `e2e/hel1692-table-header-touch-scroll.spec.ts`, `test.use({ isMobile: true, hasTouch: true })`, real touch via CDP `Input.dispatchTouchEvent`. At 375x812 and 430x932: seed a dashboard with a Table (output) panel bound to a small Output plus enough content for the page to scroll; `waitForPanelStack`; settle and scroll `.app-content` away from the top; locate a handle's hittable point and assert `elementFromPoint` hits `.ui-data-grid__resize-handle`.

Two guards, both labelled GUARD in the spec and PR (neither was red before the fix, because the bug did not reproduce):

- **G1 static guard:** every element on the hit chain from the handle up to `.app-content` has a computed `touch-action` that permits vertical panning (`auto`, `manipulation`, or contains `pan-y`). Failable by mutation: restoring `touch-action: none` on the handle must turn it red.
- **G2 behavioural guard:** a vertical drag from the handle, and from header text, scrolls the page. Because Chromium ignores the handle-level `none` here, restoring it does not turn G2 red; G2's failability is shown with a mutation on G2's OWN drag path (C3): inject `touch-action: none !important` climbing from the hit `th` through header ancestors up to the Table card `.mobile-panel-stack__item--output` (the card-level injection the Notes control showed Chromium honours) and show the drag no longer scrolls. A control on another element (the Notes card) does not count. If nothing on the Table's own path blocks the pan, stop and report — G2 cannot then be claimed failable.

Desktop guard (G3): one desktop-width test mouse-drags a handle horizontally and asserts the column width grew; failable by neutralising the mousedown path.

Mutation transcripts (red then green) are kept as evidence.

### D3. Capped body: measure, then fix or document

With a Table whose `.ui-data-grid` scroller (inside the live cap) overflows vertically — asserting on `.ui-data-grid` `scrollHeight > clientHeight` and `scrollTop === 0`, and on `.panel-content` `scrollTop === 0`, immediately before the drag (C1) — at body `scrollTop = 0` and the page scrolled away from the top, a downward touch drag started inside the body must chain to the page. Expected (standard nested-scroll semantics, no `overscroll-behavior` on the DataGrid scrollers): it chains, so this is documented as intended — body first, then page — in the spec requirement and covered by an e2e assertion. If measurement shows the gesture is swallowed, find the probe-confirmed root cause (`.concertino/laws/systematic-debugging`) and fix it; if the fix requires an interaction choice (e.g. header drags should bypass the body scroller), escalate rather than decide.

### D4. Delete the dead `--table` cap rule only

`table` is not a `PanelKind`, so `.mobile-panel-stack__item--table` never renders. Delete only the cap rule `.mobile-panel-stack__item--table .panel-content--table` (~102) after a repo-wide grep shows no producer of that class, and repoint the `mobilePanelHeights.ts` (~39-41) citation at the live cap (`.mobile-panel-stack__item--output .panel-content`, scroller `.ui-data-grid`). No test entry targets the ~102 rule (`intrinsicKinds`'s `"table"` entry tests the ~54 selector list via first-match `findRuleBody`). The ~54 intrinsic-kind list (`--table/--collection/--timeline` dead names, already documented by HEL-1022's comment) is out of scope and left untouched.

## Risks / Trade-offs

- [The e2e touch point misses the 8px handle (sticky header offsets, virtualised rows)] → assert `elementFromPoint` hits `.ui-data-grid__resize-handle` immediately before touchStart; fail with the hit chain otherwise.
- [Page scroll measured before layout settles (HEL-1633/1724 skeleton, HEL-1682 anchoring)] → `waitForPanelStack`, then require scrollHeight/scrollTop stable over several animation frames before the drag, as hel1656 does.
- [Shared DataGrid used outside dashboards (Output editor tables)] → change is a touch-only property; desktop guard plus existing DataGrid unit tests cover mouse resize.
- [Shipping a fix for an unreproduced bug] → owner-accepted; the change is one touch-only property with no capability change; the PR states the non-reproduction plainly.
- [Horizontal touch drag on the handle still neither resizes nor pans] → same as today; acceptable and out of scope (Non-Goals).

## Gate-Chain Implications Checklist

Not applicable: this change touches no `.husky/**` file and no script the pre-commit hook invokes.
