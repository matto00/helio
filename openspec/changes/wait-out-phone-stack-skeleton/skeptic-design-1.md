## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 86763e881cee3bd3e0aea7957db619be51479a0f (planning artifacts untracked in the change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/phone-stack-skeleton-gap-flake/hel-1724`.

### What I verified (with evidence)

**Root cause (design.md Context): independently reproduced from the CI trace.**
Trace: `/home/matt/Development/helio/.concertino/scratch/HEL-1724/ci-artifact/report/home/runner/work/helio/helio/test-results/hel1583-mobile-dashboard-H-92d1e-x-from-the-edge-gaps-8-12px-dev/trace/1-trace.trace`
- Line 407/409 (call@11041): the evaluate expression is the spec's bare `document.querySelectorAll(".mobile-panel-stack__item")`.
  Result: `cardLeft` length **6** (all 12), `gaps = [10, 10, -379.7613830566406, 10.23272705078125, 10.40447998046875]`.
- Line 393 (after@call@11033 snapshot, `data-theme="dark"`, viewport 375x800): I parsed the snapshot tree. It holds
  `DIV.crossfade.crossfade--block` > `DIV.crossfade__layer.crossfade__skeleton.crossfade__skeleton--leaving`
  (`aria-hidden="true"`, `inert`) > `DIV.panel-grid-shell[aria-label="Loading panels"]` > `.mobile-panel-stack` with 3
  `.panel-grid-card.mobile-panel-stack__item.mobile-panel-stack__item--metric` stubs (`--mobile-panel-height: 120px`),
  then the sibling live `.crossfade__layer` with 3 `ARTICLE...mobile-panel-stack__item--markdown motion-enter
  motion-enter--emphasized` cards. Skeleton first in DOM order. Matches the design exactly.
- Arithmetic is consistent: 3 x 120 + 2 x 10 = 380 stub-stack height; both layers share `grid-area: 1 / 1`
  (`frontend/src/shared/ui/Crossfade.css`), so stub-3-bottom to real-card-1-top is about -380. The ~0.24 residual and the
  10.23/10.40 real gaps line up with the real cards still carrying `motion-enter` (a keyframe animation,
  `frontend/src/shared/motion/motion.css:15-17`), which D3 already plans to probe.
- No non-skeleton `.crossfade__layer` is an ancestor of the skeleton in that snapshot, and `/dashboards/:id` is not
  wrapped in `RouteSuspense` (`frontend/src/app/AppRoutes.tsx:122`). So the proposed descendant selector
  `.crossfade__layer:not(.crossfade__skeleton) .mobile-panel-stack__item` does exclude the stubs today.

**Helper design (D1).** `e2e/support/panelGridReady.ts` exists as described (HEL-1633), and its doc comment does say
phone widths would time out step 1. The proposed sibling copies its two-step order (positive live-count anchor, then
`getByLabel("Loading panels")` = 0). `Loading panels` is on `PanelGridSkeleton`'s `panel-grid-shell`
(`frontend/src/features/panels/ui/grid/PanelGridSkeleton.tsx:30`), which wraps the mobile stub stack (confirmed in the
snapshot), so step 2 is meaningful at phone widths.

**Spec callers (D2).** I read every `open()` caller in `e2e/hel1583-mobile-dashboard.spec.ts`. Each one opens
`dashboardIds[0]` (3 panels) at a width from {320, 375, 390, 430, 600, 768}. The spec itself asserts the
single-column stack at 600 and 768 (lines 205-215), so `waitForPanelStack(page, 3)` is valid for every caller. The only
post-switch read (line 284, `.first()` + `toContainText("Z")`) is a retrying assertion that the stubs cannot satisfy:
the stubs have no text and the seeded content has no uppercase Z. D2 already tells the executor to check it.

**Forced repro / guard (D4).** It mirrors the existing `e2e/hel1633-panel-grid-ready.spec.ts:69-88`: init-script
stretch of `.crossfade .crossfade__skeleton`, `page.route("**/api/dashboards/*/panels")`, and a `toHaveCSS` proof of
the stretch. The route glob matches the real request (`panelService.ts:32`, no query string). Under the stretch, the
old wait (first markdown body visible) completes while the skeleton is still leaving, so the unmodified :156 read sees
6 rects. A deterministic red is credible. Both mutations land red by construction: without step 2 the read sees 6; without
step 1 the read can run before mount and see 0.

**Sweep (D5).** `grep -rln "mobile-panel-stack__item" e2e` returns 14 files, which matches the design's count.
`MobilePanelStackSkeleton.tsx:41` stubs carry `--metric`, which confirms the design's warning that `--metric` is not
a safe filter.

**AC coverage.** AC1 (root cause from a trace or probe, with no retries and no larger timeouts) is met by design.md
Context, and the non-goals rule out retries and timeout increases. AC2 (red under a forced repro, then 40/40) is
covered by tasks 1.1, 3.3 and 6.1. D6 is correct that `:156` matches both theme describes, so 20 repeats give 40 runs.
Scope is test-only, which fits the ticket. `skip_specs` is justified because no product contract changes. The
HEL-1644 file is excluded.

### Verdict: CONFIRM

### Non-blocking notes

- The stretch selector `.crossfade .crossfade__skeleton` also stretches each panel's inner body-skeleton Crossfade
  (`PanelContent`). That does not affect card geometry, because it sits in the same grid cell inside the card, but the
  guard's `toHaveCSS` proof should target the panels-level skeleton layer (for example the one containing
  `[aria-label="Loading panels"]`) so it proves the right layer was stretched.
- `LIVE_STACK_ITEMS` uses a descendant combinator. If an ancestor non-skeleton `.crossfade__layer` is ever added (for
  example the dashboard route wrapped in `RouteSuspense`), it would match the stubs as well. Step 2 still catches that,
  so the wait stays sound, but the doc comment could mention it. `LIVE_GRID_ITEMS` has the same property, so this is
  consistent with the precedent.
- tasks.md has an empty `## Standing Constraints` heading. Either fill it with the driver constraints from ticket.md
  or remove it.
- D3: the real cards' entrance is a `CSSAnimation` (`motion-enter` keyframes), not a transition. As the design
  already anticipates, `settleTransitions` would not cover it.
