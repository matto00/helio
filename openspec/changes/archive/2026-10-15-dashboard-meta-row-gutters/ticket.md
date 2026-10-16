# HEL-1576: Dashboard meta bar replaces the page title; tighten grid gutters and empty gaps

## Description

The owner finds a dashboard title redundant, because the name already appears in the tab, context list and ⌘K. Today, though, nothing on the page says when data refreshed or where the main actions are, and undo/redo hold prime top-bar space. Separately, with auto-compaction turned off (`noCompactor`) the grid shows large vertical gaps (e.g. ~200px of empty canvas on "Workouts" between the form panel and the next panel).

## What

* A slim meta row under the tab strip, no title: panel count, a refresh dot plus relative time, source(s), then Edit layout, Share and the primary **Add panel**. Undo/redo move into edit mode, plus `⌘Z` / `⇧⌘Z`.
* Desktop grid gutter of about 12px, matching the B2 board.
* Investigate the empty gaps. Options include opt-in vertical compaction while not editing, a one-click "tidy layout" action, or leaving `noCompactor` alone and fixing seeded layouts. Pick one with the owner in the PR. Do not silently change saved layouts.
* Reference: "B2 · Dashboard" on the epic's canvas (local copy: `/home/matt/Development/helio/.concertino/design/HEL-1570/screenshots/B2Dashboard.png`, `canvas/project/B2Dashboard.dc.html`; mockup only, sample data/hex/orange accent are illustration).

## Acceptance criteria

- [ ] The dashboard page renders no page title. The meta row shows panel count, last refresh and source(s), and the actions work
- [ ] Undo/redo still work through edit mode and keyboard shortcuts, with existing undo tests passing
- [ ] The grid gutter is a token value and matches the DESIGN.md v3 desktop spec
- [ ] The chosen fix for large empty layout gaps is implemented and demonstrated on a dashboard that has them today, without rewriting any user's saved layout unprompted

## Binding inputs and precedence

Ticket ACs and owner rulings, then DESIGN.md v3 (§0, §9 Shell "No dashboard title" / "Meta row", appendix), then the design HANDOFF.md ("No dashboard title ... A slim mono meta row (panel count · refreshed · source) plus actions replaces it."), then the board.

Owner rulings inherited from HEL-1574 (events log): `keep-768-as-phone` (exactly 768px is the phone shell; JS uses `useIsPhoneShell()`), Home points to dashboards (HEL-1578 moves it), per-user folders.

## Open escalation (raised 2026-10-15 by the orchestrator, `--raise-only`)

Gap fix (AC4): options `tidy-layout` (recommended) / `compact-while-viewing` / `fix-seeded-layouts` / `leave-gaps`. Not built until the owner answers.

## Concurrent lanes (overlap)

HEL-1575 (tabs + ⌘K; App.tsx/CommandBar/App.css; `hideDashboardBreadcrumb`), HEL-1578 (Home; `/dashboards` dashboard view; `isDashboardViewPath`), HEL-1579 (PR #1031; `app/hidesBreadcrumbItemName.ts`; CSS-count pins). Whoever merges later extends shared predicates, never parallel conditionals; CSS-count pins are recounted, never loosened.
