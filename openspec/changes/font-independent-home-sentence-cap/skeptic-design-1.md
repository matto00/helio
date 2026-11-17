## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/home-sentence-font-independent-cap/HEL-1737`. HEAD is `6432e69e015fcde437d26262f15601fb59e069af`. The only untracked path is the change dir.
- Current CSS (`frontend/src/features/home/ui/HomePage.css`): `.home-opening__sentence { max-width: 40ch }` (l.28-30). `.home-opening__ghost { max-width: 25em }` (l.49-57). Both are `var(--text-2xl)` with `letter-spacing: -0.01em` (l.32-41). `.home-page` padding is `var(--space-3)` (12px) a side at <=768px (l.778-783). The ghost's 25em came from HEL-1665 (`25aca3660`). HEL-1678 (`54b18b7ce`) did not touch HomePage.css.
- How the swap is measured: in `e2e/hel1665-home-phone-stability.spec.ts`, `fontSwapSpread` is the spread over `samples.slice(0, start)`. Those are the frames taken while `holdRequests` holds both APIs, so the element on screen is the **loading ghost**, not the real sentence (l.100-150, `loadHome` l.50-66).
- What HEL-1678's final skeptic measured (`openspec/changes/archive/2026-11-16-metric-matched-fallback-fonts/skeptic-final-1.md` l.21-27, 48-52): the probe holds `/api/home-summary` "so the loading ghost stays mounted". It found: "Head stack: the ghost differs only at 605-613px" and "Both base and head wrap the ghost there". On head, that ghost already had the 25em cap.
- Line-count guard (spec l.296ff): the default sentence is 1 line at 605 under the web font and 2 lines at 604. At 605-613 the content box is about 581-589px wide. That is narrower than 600px (25em at 24px), so the em cap does not bind there.
- `chunit.mjs` measures the sentence with `font: 400 24px` and **no** `letter-spacing: -0.01em`. So the "593 vs 594-602px" widths the design cites are not the rendered widths. The real ones are roughly 13px narrower.
- Spec delta against `openspec/specs/home-page/spec.md`: I diffed it. It removes the 605-615 "MAY" carve-out, adds SHALLs for 605-613 and 1440 and for data-before-font at 610/1024/1280/1440, and adds the em-measure SHALL and two scenarios. The structure is fine.
- Mono: today the sentence is 40ch (576px) and the ghost 25em (600px). D1 gives both 24em. That brings the ghost into line with the sentence, and the 0px Mono series is re-run in task 3.3. Fine.

### Verdict: REFUTE

The design's diagnosis is wrong for half the ticket. D1 is a no-op for the 605-613px band, and the plan would write a SHALL into the spec and red tests for a bound the planned fix cannot meet. It would only find this out at task 3.2, after the test work.

### Change Requests

1. **Fix the root-cause analysis in design.md Context and D1.** Context says the em change addresses "the whole of both gaps in the ticket", and that the ghost "already uses an `em` cap and is not the problem". In fact the cold-load swap at 605-613 is the ghost's swap: `fontSwapSpread` samples the held-loading frames, and HEL-1678's skeptic-final-1 shows the 25em ghost differing at exactly 605-613. Under Sans, D1 sets the ghost to 25em, which is the value it has today. So the band is unchanged by D1. It is container-bound: the content box is about 581-589px, and the fallback-rendered sentence is wider than that while the web-font sentence is narrower. Say so. Make clear that D1 closes only the desktop data-before-font gap (the real sentence's 40ch shrinking to about 560px in the fallback) and the Serif/Mono ghost/sentence alignment.
2. **Move the D3 feasibility decision to the front of tasks.md, before any test is written.** In phase 1, measure the rendered default sentence in its real style (24px, `letter-spacing: -0.01em`, weight 400) in each CI-like fallback face (Liberation-matched and DejaVu-matched Sans). Measure the web font the same way, and also the `.home-opening` content-box width at 605-613. Extend `chunit.mjs` or probe the live ghost. If the fallback sentence is wider than the content box anywhere in 605-613 (which HEL-1678's evidence says it is), stop there. The orchestrator then raises the D3 escalation (options: narrow the AC band with measured numbers, a sentence-only tweak that changes the loaded rendering, or a tighter per-element fallback `size-adjust`). Tasks 2.x and 3.x for the band wait on that answer.
3. **Do not assert the 605-613 band as a SHALL in the spec delta, or add band cases to the e2e, until item 2 is resolved.** Today the delta makes "at most 4px at every width from 605 to 613px" a SHALL. The scenario "Cold-load web-font swap is bounded" lists "605 to 613", and D4/task 2.1 add those cases. Either make the band conditional on the escalation's answer, or split the plan so the desktop and data-before-font part (which D1 does fix) can proceed alone.
4. **Correct the measured numbers the design relies on.** D3 quotes "593 vs 594-602px" from `chunit.mjs`, which omits the sentence's `-0.01em` letter-spacing. Task 1.2 must measure with the real computed style, and D3/D1 must cite those numbers. The em value itself (the 40ch advance) is not affected by letter-spacing; the wrap-point comparison is.

### Non-blocking notes

- The design and tasks are otherwise concrete. The per-style em values are measured, not derived, and there is a 0.5px computed-cap assertion for each style. They hold the web-font result identical: pixel-diff before/after screenshots in light and dark, and a visible change escalates. The data-before-font test design (route the font requests, release them after the data settles) is sound.
- The D5 placeholder polish is properly time-boxed, with a revert path.
- In D1, "expected ... Mono 24em" holds only if the measured 40ch is exactly 576px. Assert the measured value; do not hardcode the expectation.
