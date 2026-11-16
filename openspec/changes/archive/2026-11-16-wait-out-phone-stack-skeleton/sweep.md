# HEL-1724 sweep: specs reading `.mobile-panel-stack__item` (D5)

`grep -rn "mobile-panel-stack__item" e2e` on 86763e881 plus the fix: 14 files besides hel1583. Stubs of
`MobilePanelStackSkeleton` are `div[aria-hidden]` carrying only `--metric`, no text, no title. Both Crossfade layers
share one grid cell, so a stub and the real card share the same top/left. Result: **0 FIX sites** (limit was ~5).
`e2e/hel1575-dashboard-tabs.spec.ts` was not hit and is not touched.

| File:line | Verdict | Why |
| --- | --- | --- |
| hel1583-mobile-dashboard (all) | FIXED here | `open()` now calls `waitForPanelStack(page, 3)`; the :156, last-card and measurement reads use `LIVE_STACK_ITEMS` |
| hel1392-remount-request-burst:69 | OK-not-a-load | `toHaveCount(8)` is a retrying wait after a viewport cross on an already-loaded dashboard (no loading skeleton); skeleton plus real would be 16, so it can only pass on the settled stack |
| hel1392-remount-staleness:58,176,193 | OK-already-waits | locator excludes `[aria-hidden='true'] *`, i.e. excludes the skeleton layer |
| hel1023-breakpoint-layout-derivation:232,246 | OK-settled | retrying count then `settledRects` re-reads until two consecutive reads agree; titles come from `.panel-grid-card__title`, which stubs lack. Not shown racy; left alone |
| hel1306/1305/1508/1311/1512 (`hasText: title`) | OK-filtered | filtered by panel title text, stubs have none (1305:522 too) |
| hel1444:694, hel1398:413,418,429 | OK-filtered | `hasText` on the panel title (`measure()` locates `surface` with `hasText` then `.first()`) |
| hel1583-refresh-line-no-shift:24-25,42 | OK-already-waits | `realCardsReady` waits for `[aria-hidden=true]` stubs = 0 and a real `article` |
| hel1646-skeleton-refresh-slot:136-137,158-161,247,271 | OK-by-design | measures the skeleton itself (`div[aria-hidden]` vs `article`) and waits the stubs out before real-card reads |
| hel1656-pull-to-refresh:57,61 | OK-filtered | `--output` modifier, stubs carry only `--metric` |
| hel1656:92 | OK-settled | `.first()` box only used for a touch point; stub and real card occupy the same x/y, and setup already waited for outputs and spinner = 0 |
| hel1656:119,143,286 | OK-filtered | `--markdown` modifier |
| hel1656:166 | OK-filtered | selects `.panel-grid-card__title` under the item; stubs have none |
| hel1681-refresh-control:68,71,103,106 | OK-filtered | `--output` modifier |
| hel1681:254 | OK-not-a-load | rAF probe of the stack's top; stub and real stack share the same top |
| hel1681:281 | OK-filtered | `--markdown` modifier |
| hel1681:307 | OK-settled | `.first()` box x/y for a touch; same position either layer |
| hel909, hel813, hel1584 | OK-not-a-load | no bare-item count/measure after a load (909 uses `hasText`; 813 a comment; 1584 reads `.mobile-panel-stack` width) |
