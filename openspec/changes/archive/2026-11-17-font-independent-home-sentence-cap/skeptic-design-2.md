## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/home-sentence-font-independent-cap/HEL-1737`. HEAD is `6432e69e015fcde437d26262f15601fb59e069af`. The only untracked path is the change dir.
- Round-1 CR1 (root cause) is addressed. design.md Context now splits the two causes. In the band, the loading ghost is bound by its container, not by its cap. At desktop, the real sentence's `40ch` shrinks in the fallback. I checked this against ground truth:
  - `HomePage.css` l.28-30 sets the sentence to `40ch`. l.49-57 sets the ghost to `25em`. Both use `letter-spacing: -0.01em` (l.32-41).
  - The `<=768px` padding is `var(--space-3)` (l.778-783). At `<=430px` the font size is `var(--text-xl)` (l.785-790).
  - HEL-1678 `skeptic-final-1.md`: with the 25em ghost on head, the ghost differs only at 605-613px. So it already fits at 614-1300px, which means the content box at desktop is wide enough. A 600px em cap on the real sentence therefore closes the desktop data-before-font gap, so D1 is sound.
- Round-1 CR2 (feasibility first) is addressed. Task 1.3 decides D3 before any test is written. On FAIL it stops and returns ESCALATION with options.
- Round-1 CR3 is addressed in tasks and design. Band tests (2.3) and the band fix (3.2) are gated on 1.3. The 610 data-before-font case is gated too ("and 610 once D3 passes"). That gate is correct: with a 600px cap at 610px, the real sentence is also bound by its container.
- Round-1 CR4 is addressed. design.md no longer relies on the `chunit.mjs` numbers, which were taken without letter-spacing. Task 1.2 re-measures with the real computed style. Those numbers are self-consistent: the web sentence is about 580px with letter-spacing, it fits at 605 (content box about 581) and wraps at 604. The fallback is about 590px, which fits from 614. That matches HEL-1678's measured 605-613 band exactly.
- `e2e/hel1665-home-phone-stability.spec.ts`:
  - `VIEWPORTS` (l.27-40) is 375/375/430/480/540/620/1024/1280. There is no width between 541 and 604 and none below 375.
  - The 620 comment is at l.34-36. `fontSwapSpread <= 4` is at l.154. The restated `40ch` test is at l.416-465.
- I reviewed D1, D2, D4 and D5 (em per style, measured to three decimals with a 0.5px computed-cap check for each style, the ghost on the same variable, the data-before-font route-and-release test, pure-CSS time-boxed polish). They are concrete and testable.

### Verdict: REFUTE

One defect remains, and it is narrow. D3's feasibility PASS criterion is one-sided. It is also checked only inside the 605-613px band. Yet the sentence-only fallback face it introduces changes the sentence's width at every width below 1300px, not just in the band. A value can pass task 1.3 and pass every planned e2e while moving the band to widths that no test covers.

### Change Requests

1. **Make D3's PASS criterion two-sided (design.md D3, tasks.md 1.3).** Today PASS is "the fallback sentence is no wider than the web-font sentence". The real boundary is 604/605px: the web sentence (about 580px) fits a content box of about 581px but not one of about 580px. Suppose the opening face's fallback sentence ends up at or below about 580px. Then at roughly 600-604px it fits on one line while the web font wraps it to two. That is the same 30px swap, just moved below 605. No test catches it, because `VIEWPORTS` has nothing between 541 and 619 except the new 605-613 cases. PASS must require the fallback default sentence to switch from one line to two at the same content-box width as the web font. Concretely: it fits at 605 and wraps at 604, at both the Liberation-matched and the DejaVu-matched face. Measure this directly, not inferred from a width inequality, since hinting makes advances integer-quantised.
2. **Require a full-width line-count sweep for D3, both in 1.3 (feasibility) and in 3.3 (final evidence).** The opening faces also apply at `<=430px` (20px, `text-xl`) and in the 431-604px band, where the default sentence is two or more lines. A smaller `size-adjust` can move the 2-to-3-line break there too. HEL-1678 only closed its 320-330px band by tuning these faces, and a sentence-only re-scale can reopen it. Do what HEL-1678's final skeptic did (`.concertino/runs/HEL-1678/evidence/.../skeptic/vsweep.cjs.txt`): hold the fonts and `/api/home-summary`, then compare the ghost's line count and height, fallback versus web font, at every viewport width from 320 to 1300px. Do this in the CI-like container, for both fallback faces. PASS requires zero differing widths. Record the sweep output in `evidence/measurements.md`. The fixed e2e widths are not enough evidence for a change that alters glyph scale everywhere.
3. **On the D3 FAIL or escalation path, add an explicit task to revise the spec delta (tasks.md 1.3 or a new 1.5).** `specs/home-page/spec.md` currently drops the 605-615px MAY carve-out without condition. It also states SHALLs for 605-613 and for the 610 data-before-font case. design.md says these are "rewritten per" the answer, but no task does it. Without one, a FAIL path could archive a SHALL the code does not meet.

### Non-blocking notes

- The prior lane found that lowering the Arial adjust from 104.94% to 103.3% "did not move the 602px sentence width (hinting quantisation)" (archive `measurements.md` l.78). That measurement had no letter-spacing, but it is a warning that the 4% sweep may find no qualifying value. If it does not, the escalation path is the right outcome. Do not widen the 4% budget on your own.
- D1's "Mono near 24em": assert the value you measure, as already planned.
- The visual check (task 4.1) should include a screenshot at a 600-604px width once D3 lands, alongside 610.
