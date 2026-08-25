## 1. Frontend — measurement baseline (before any CSS change)

- [x] 1.1 With a Playwright/browser session at 430px and 768px viewport widths, measure
      `.panel-list__add`'s `getBoundingClientRect().height` on current `main` (before any
      change) — confirm the ~28px figure the ticket states, and measure `.panel-list__count`
      (should NOT be floored) as the discriminating control.
- [x] 1.2 At a 500px viewport width (inside the 431–768px band where the zoom widget is visible),
      measure `.panel-list__zoom-button` and `.panel-list__zoom-reset`'s
      `getBoundingClientRect().height` AND `.width` on current `main` — confirm both are ~22px.

## 2. Frontend — fix `.panel-list__add`

- [x] 2.1 Add a `@media (max-width: 768px) { .panel-list__add { min-height: 44px; } }` rule to
      `frontend/src/features/panels/ui/PanelList.css`, placed AFTER the base `.panel-list__add`
      rule (not before — see HEL-535 lesson in design.md), following the `EmptyState.css:219-228`
      convention.

## 3. Frontend — sibling audit

- [x] 3.1 Audit every other selector in `PanelList.css` for interactive controls reachable at
      mobile widths with no 44px floor (design.md Decision 2 already identifies
      `.panel-list__zoom-button` / `.panel-list__zoom-reset` as in scope, on BOTH axes — that
      selector block also sets `width: 22px`, not just `height: 22px`).
- [x] 3.2 Add `min-height: 44px` AND `min-width: 44px` to `.panel-list__zoom-button` /
      `.panel-list__zoom-reset`, scoped to the viewport range in which the widget is actually
      visible/reachable (`@media (max-width: 768px)` — the widget is already `display: none`
      below 430px via its own existing rule, so no extra viewport-range logic is needed beyond
      reusing the same 768px breakpoint as `.panel-list__add`).

## 4. Frontend — verification (measurement, not CSS reading)

- [x] 4.1 Re-measure `.panel-list__add` at 430px and 768px viewports via
      `getBoundingClientRect().height` — confirm >= 44px at both.
- [x] 4.2 Re-measure `.panel-list__zoom-button` / `.panel-list__zoom-reset` at a viewport width
      WITHIN the 431–768px band where they are actually rendered (e.g. 500px and 768px — NOT
      430px, where the widget is `display: none` and would give a false-failure 0×0 reading) via
      `getBoundingClientRect().height` AND `.width` — confirm both >= 44px.
- [x] 4.3 Re-measure the discriminating control from 1.1 (`.panel-list__count`) at the same
      viewports — confirm it is UNCHANGED, proving the probe discriminates rather than trivially
      passing.
- [x] 4.4 Visual check (screenshot): confirm no layout regression in `.panel-list__header` (which
      stacks via `flex-direction: column` below 768px) and confirm the enlarged zoom-widget
      capsule still reads as a coherent control and doesn't collide with `BottomNav` or run
      off-screen at its fixed bottom-right position (design.md Risks).

## 5. Scope call

- [x] 5.1 Do not build the mechanical guard (static CSS test / runtime sweep) the ticket raises
      as "worth considering" — per design.md Decision 3, this is out of scope for this ticket.
      Flag it as a recommended follow-up in the final report for the orchestrator to escalate.
