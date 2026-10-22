## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `ef90be7aa7f3834f0ca03ac500a731ce9c619ddf`. This review covers only what changed since `e2eac98e0`.

Method: code review plus the failure log at `/home/matt/Development/helio/.concertino/scratch/HEL-1632/full-e2e-1.log`. Per the orchestrator, I did not run Playwright (its full suite holds the lock and the 7064/9971 servers).

### Phase 1: Spec Review — PASS (the layout is a product trade-off for the owner; see Phase 3)

### Phase 2: Code Review — PASS

Checks I ran:
- Targeted jest (liveOutput, PipelineDetailPage.spine): 6 suites, 111 tests, all pass.
- eslint on `LiveOutputColumn.tsx`: clean.
- Prettier on both changed files: clean.

**1. hel503 heading clash: fixed.**
- The log at line 4008 shows a strict-mode violation: `getByRole('heading', { name: 'HEL-503 Revenue Output' })` matched 2 elements.
- `LiveOutputColumn.tsx:157` changes the Output name from an `h2` to `<p className="live-output__name">`. The `.live-output__name` style (`margin: 0`, semibold, `--text-base`) is unchanged.
- This is the right fix, not a workaround. The name is a label inside the column, not a page section. A second heading with the Output's name competes with the page's real one, both for screen readers and for any role-based query.
- No test in the change queried that heading.

**2/3. hel1668 viewport change from 1280x800 to 1280x840: a legitimate premise change, not a fixture edit hiding a regression.**
- What failed:
  - The assertion that failed is line 58, `expect(roomBelow, "below is roomier").toBeGreaterThan(roomAbove)`, measured 369.5 vs 381.5.
  - That line is one of the fixture's preconditions (lines 54-58: content fits above, the 384px cap does not, below is roomier). It is not the placement behaviour under test (lines 59-61: opens above, top ≥ 0, visible).
  - The log shows the trigger at top 397.5 and content 192, so content does fit above (192 ≤ 381.5). Under the placement rule the panel opens above either way.
  - The test stopped at its own precondition, before reaching the behaviour assertions. Nothing shows the placement logic misbehaving.
- Why the trigger moved:
  - The live column takes the third track at 1280 (with the list at 248), which leaves the centre column about 363px wide (I measured this in cycle 1).
  - The filter editor's field, operator and value rows then stack. This is visible in the cycle-1 1280 screenshots: `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/c2-live-1280-light.png`.
  - The trigger sitting about 12px lower is a direct, explained consequence of the layout this ticket ships.
- The edit itself:
  - It changes only the viewport height. All the behaviour assertions and the second scenario (1000x800) are untouched, and the comment explains why.
  - Raising the height keeps the pinned precondition true without touching product code. That is the honest edit; loosening the assertion would not be.
- What it costs:
  - The literal 1280x800 point of HEL-1668's "desktop 1280x800" case is no longer exercised for this one scenario.
  - The spec's header comment (line 9) still says "desktop 1280x800 and 1000x800" and should be updated.

**4. hel1510 0.1px overflow: plausibly not caused by this change, but unproven.**
- The failure was `ui-select__trigger right=871.6 limit=871.5`, a 0.1px sub-pixel difference, at 1100x900.
- At 1100 the page body is about 1100 − 56 − 248 = 796px, which is below 960, so the layout is the `disclosure` mode.
  - That mode changes only rows and areas (`PipelineSpineLayout.css:95-100`). It does not change the column formula.
  - `.spine-body` has no `column-gap`, so the extra zero-width explicit track adds no width.
- I found no mechanism by which this change shifts the Output editor's width. The executor reports 10/10 passes.
- Treat it as an unattributed flake, not a cleared one. If it recurs on `main`, it belongs to HEL-1510's own area.

**Non-blocking:**
- `PipelineSpineLayout.css:24-25` still says the live-output track is "reserved but empty and zero-width until HEL-1581 sets the variable". That is now false. Update it.
- `e2e/hel1668-schema-panel-copy.spec.ts:7-9`: update the header comment to 1280x840.

### Phase 3: UI Review — PASS, with an explicit product trade-off for the owner

**Is a 363px centre column with stacked editor rows at 1280 acceptable?** It is a deliberate product trade-off, not a defect. The owner should see it.

Why it is not a defect:
- The ticket asks for a column "about 340-380 px wide" on the right.
- The approved design (D7) set the bar as "the centre keeps ≥ ~320px and spine titles stay readable".
- The spec scenario requires a 340-380px column at 1280×800 and no document scroll.
- Measured at 1280 with the list at 248: the column is 340px, the spine 273px (inside the 270-340 invariant), the centre about 363px, and the document scroll is 0.
- hel1579 passed 14/14 in my cycle-1 run, including the editor-action checks, the 1280 "8 preview rows without page scroll" check, and the 769-1100 title sweep.
- No DESIGN.md [mechanical] rule is broken. Stacked filter rows inside a narrow card are the editor's existing responsive behaviour, not overflow.

What it costs:
- At the most common laptop width, every step editor gets about 55% of the width it had before HEL-1632 (≈363px vs ≈660px). The filter editor stacks to about 267px tall, versus 163px when its rows sit side by side.
- Above-the-fold space for the preview table shrinks accordingly.
- With the context list at 400px, the page drops to the collapsed "Output" disclosure instead, and the centre keeps its full width.

Options for the owner (each is reversible):
1. **Keep this** (live render always visible at 1280).
2. **Raise `THREE_COLUMN_MIN_WIDTH`** so that 1280 with the 248px list uses the disclosure.
3. **Make the column collapsible** at three-column widths.

I recommend surfacing this in the PR body under "Reversible UI calls".

### Overall: PASS
