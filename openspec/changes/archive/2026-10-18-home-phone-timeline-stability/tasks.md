## Standing Constraints

- [C2] (retired) HEL-1665 item 2 (short-phone bound) is parked for the owner: not built, the PR references HEL-1665 without a closing keyword, and AC2 is judged as documented-and-parked, not as failed or met.
- [C3] Owner ruling (escalation.answered accept-as-is): AC2 is relaxed to: at 375x667 the timeline heading and the top of the first row are visible above the nav; scroll for the rest. Item 2 is accepted as is (no short-phone layout change); the PR closes HEL-1665 with a closing keyword.
- [C1] Home desktop (1280, fine pointer) settled layout must equal pinned numbers measured on the base code (647734111); a same-run check is not evidence.

## 1. Measure and prove red first

- [x] 1.1 Measure Home's settled 1280×900 boxes (opening line, shelf head, shelf, runs card top, runs card head, first timeline row) on base 647734111 and pin them (C1). Verify: evidence JSON.
- [x] 1.1b Measure the default opening sentence's line count at 375/430/768/820/1280 (and whether the heading web font had loaded at first paint) into evidence; Decision 6's precondition uses these counts. Verify: evidence JSON.
- [x] 1.2 Write `e2e/hel1665-home-phone-stability.spec.ts` (design Decision 6) and run it on the unmodified code; save the red output (per-frame max deviation per viewport/theme/order/series) to evidence and scratch. Verify: shift tests red with measured px.
- [x] 1.3 From the probe, list every contributor (link head, skeleton cards, legend, opening line, anything else) with px. Verify: breakdown in evidence.

## 2. Fix the load shift

- [x] 2.1 Shelf-head-only `min-height` (Decision 1a). Verify: 1280 settled boxes equal the pinned base numbers; runs card head unchanged.
- [x] 2.2 `.home-section__link` touch floor via a `square` `::after` expander (Decision 1b); new Home CSS guard test with `expectTapExpander()`. Verify: unit test; `touchTargetProbe.ts` bisection at 375 for `All N` and `+N more`.
- [x] 2.3 Skeleton card foot matches loaded foot (Decision 2). Verify: equal card heights in the probe.
- [x] 2.4 Legend in the runs head while loading (Decision 3); Home unit tests updated. Verify: probe content-start series 0px.
- [x] 2.5 Opening placeholder matches it per width (two lines in the existing ≤430 block, one line otherwise), class-sized, keeps "Loading summary" (Decision 4). Verify: probe 0px with the default fixture at every viewport; bound case moves exactly one line.
- [x] 2.6 Fix any other mover from 1.3 within Home files. Verify: all shift tests green at four viewports × two themes × two orders.

## 3. Regression, docs, evidence, hand-off

- [x] 3.1 HEL-1642, `hel1583-home-375` and `hel1578-home-page` specs green. Verify: spec runs.
- [x] 3.2 Mutations (link `min-height` back; shelf head `min-height` dropped; 28px opening skeleton back; phone two-line placeholder applied at desktop (1280 red); legend not shown while loading) each turn a test red. Verify: red outputs in evidence.
- [x] 3.3 DESIGN.md Home entry sentence (Decision 8). Verify: diff.
- [x] 3.4 Screenshots at 375×667, 375×812, 430×932, 1280×900, light and dark, in scratch and evidence. Verify: files present.
- [x] 3.5 Item 2 owner hand-off: write `item2-owner-handoff.md` in the change dir with the parked options (height breakpoint, viewport-unit clamp, width-only thumbnail shrink, relax AC2) and the post-item-1 375×667 measurements (runs heading bottom, first row bottom vs nav top, light/dark) plus the item-1 residuals (sentence line count, legend for zero pipelines). Verify: file present, numbers from evidence JSON.
- [x] 3.6 Home jest tests, lint, typecheck, format pass. Verify: command output.
- [ ] 3.7 Delivery disposition (C3): the PR body uses a closing keyword for HEL-1665, lists "UI decisions taken overnight", the item-1 residuals and the AC2 guard note; HEL-1665 is Done after merge. Verify: PR body text and Linear state.
