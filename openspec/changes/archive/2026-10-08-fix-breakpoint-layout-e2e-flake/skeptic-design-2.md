## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 7e1df62a67ada4de6dd2499cbb5d84cec69e7dbb (the planning artifacts are untracked in the change dir). Every check below comes from the repo and the failed-run artifacts directly, not from round 1's conclusions.

### What I verified (with evidence)

- **Failure facts, re-read from the artifacts.** `results.json` shows `C_lg_coords_everywhere ... failed 9795` with `light @1500 (md) P8 Divider right` and `Expected: <= 1478 / Received: 1876`. The spec's windows table (spec:43-49) gives lg container 1612 and md 1212. The right-edge assertion is `r.x + r.w <= container.x + container.w + 2` (spec ~449), which matches the arithmetic in design.md. In `error-context.md`, the first grid article is "P8 Divider" (line 81) and the last is "P1 Image" (line 181). So DOM order is reversed, and P8 failed only because it is the first item checked. design.md now states this correctly.
- **The container-gate premise is now correct (CR1).** `settledRects` (spec:243-265) polls the box width of `.panel-grid`. That element is RGL's `<Responsive className="panel-grid" width={width}>` (`DesktopPanelGrid.tsx:348-349`, confirmed). RGL's `width` comes from `useContainerWidth` (`PanelList.tsx:76`, confirmed). `react-grid-layout/dist/chunk-BMN6M2VL.js:44-54` runs the path ResizeObserver → `requestAnimationFrame` → `setWidth` (confirmed verbatim). The old "frame race less likely" inference is gone. rAF / frame-production starvation is now candidate (a).
- **The decision rule now separates product from test correctly (CR2).** Under D2, a product bug requires RGL to have rendered with the md width while an item stays at lg after commit and after transitions finish. RGL not yet having the new width is a measurement race, including a stall that ends at an unrelated event. The width-provider-ordering example has been removed. With this rule, C3 can no longer force a product change because of normal RGL ordering.
- **The probe can tell the cases apart (CR3).** D1(iii) and task 2.2 record timestamps for the RO callback, the rAF that follows it, and the width/breakpoint/cols RGL rendered with. They also record the rect series of every item, `visibilityState`, whether rAF fires during the stale window, and `getAnimations()`.
- **Every item is recorded, not just P8 (CR4).** Tasks 1.1 and 2.2 record P1-P8. A divider-specific diagnosis is allowed only if the other items are already at md geometry.
- **Test-fix options are causal (CR5).** The "stable over a window derived from the measured lag" option is explicitly forbidden as a tuned settle window. Option (a) reuses or extends `e2e/support/settleTransitions.ts`; I confirmed it exists and awaits rAF, then CSS transitions, then rAF again. It is valid only if the probe shows a frame wait is enough. Option (b), an observability attribute, is product code: it appears in proposal Impact and requires a unit test. I re-ran the grep: `data-breakpoint|data-cols|onBreakpointChange` has 0 hits in `frontend/src`, so (b) is new code, as the plan acknowledges.
- **Sample size (round-1 note).** D3 and task 4.1 size N from the Wilson 95% lower bound p_low so that (1−p_low)^N ≤ 0.05, and require k, N₀, p_low and N to be stated. If the flake does not reproduce, the plan escalates instead of claiming green. This is correct.
- **AC trace:**
  - AC1 → task 2.1: measured N/k, ≤4 workers, nice -n 19.
  - AC2 → task 2.2: covers every ticket candidate plus rAF starvation.
  - AC3 → D2 and task 3.1.
  - AC4 → C1 and the D2 prohibitions.
  - AC5 → D3 and task 4.1: pre-fix red at the same contention, then green.
  - AC6 → task 3.1: regression guard shown red.
  - The spec delta is conditional on a product fix, which is consistent between proposal Capabilities, D4 and task 3.1. C4 (ci.yml) is respected. No placeholders or TBDs, and I found no contradictions between proposal, design and tasks.
- **HEL-1300 interaction checked.** The spec already calls `isolateLivePage(page)` in `beforeEach` (spec:370) before seeding. `openAt` only does `page.goto` on the first load per theme; after that it resizes live (spec:348-356), which matches the design's Context.

### Verdict: CONFIRM

### Non-blocking notes

- Option (a) timing: `setWidth` runs inside RGL's rAF callback. React then commits that update in a later scheduler task, not synchronously inside the rAF. A single test-side rAF registered after RGL's can therefore resolve before the commit lands. If option (a) is chosen, base the wait on something the probe shows happens after the commit (e.g. ≥2 frames, or reading back RGL's width/cols), not on one frame. D2's clause "(a) is only valid if the probe shows a frame wait is sufficient" already covers this; the note just makes the trap concrete.
- The design does not name HEL-1300 / `isolateLivePage` explicitly. It is already applied in this spec's `beforeEach`, so the evidence file only needs one line saying so to close the ticket's "check HEL-1300" ask.
- Task 1.0: if PR #860's attempt logs or traces have expired, record that, and don't treat the ~11.5 s claim as evidence.
