## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `ef90be7aa7f3834f0ca03ac500a731ce9c619ddf`. Base resolved live with `resolve-review-base.sh`: `c1add2394`. The prior round CONFIRMed `e2eac98e0` (skeptic-final-1.md). This round covers the delta `e2eac98e0..ef90be7aa` and the four failures in `/home/matt/Development/helio/.concertino/scratch/HEL-1632/full-e2e-1.log`. Per the orchestrator I ran no Playwright (the full suite holds the lock).

### What I verified (with evidence)

- **Delta scope.** `git diff --stat e2eac98e0..ef90be7aa` touches two non-artifact files: `e2e/hel1668-schema-panel-copy.spec.ts` (viewport 1280x800 → 1280x840 plus a comment) and `LiveOutputColumn.tsx:157` (`h2` → `p`). The rest are openspec artifacts.
- **Failure inventory.** The log summary shows 4 failed, 658 passed: hel1510:35, hel1668:40, hel1668:69 and hel503:99. Each one is accounted for below.
- **hel503 (heading clash): fixed correctly.**
  - Log line ~4009: strict mode matched both `h2.live-output__name` and the modal title `h2`.
  - The Output name is now a `<p>`. `grep live-output__name` finds only the CSS class selector (`LiveOutputColumn.css:63`, not element-qualified), so the styling is unchanged.
  - No unit test or e2e spec queries that heading.
  - Semantically this is better: the name is a label inside the column, not a page section.
- **hel1668 1280 viewport edit: a legitimate premise change, not a hidden regression.**
  - Both 1280 failures stopped at the fixture's own precondition, `expect(roomBelow, "below is roomier")` (369.5 vs 381.5). They never reached any placement assertion.
  - Logged geometry at 1280x800: `trigger top 397.5`, content 192 (short) and 527 (tall).
  - With this layout at 800 tall, above (381.5) really is roomier than below (369.5). The panel's placement is still correct for that geometry:
    - Short content (192) fits above and opens above.
    - Tall content (527) goes to the roomier side, which is now above, capped.
  - So nothing the product does is wrong. The scenario simply no longer discriminates at 800, because this ticket's third column narrows the centre, the filter rows stack, and the trigger moves down.
  - At 840, assuming the trigger's top does not depend on viewport height, the arithmetic is:
    - roomBelow becomes 409.5 > 381.5.
    - roomAbove stays 381.5 < 384, so the "cap does not fit above" precondition still holds.
    - All behaviour assertions and the 1000x800 case are untouched.
  - The edit restores the scenario's discriminating power. It does not loosen any assertion.
  - The orchestrator's in-flight full run is the confirming measurement at 840. I did not measure 840 myself.
- **hel1510 0.1px overflow: the dismissal holds up.**
  - `shared/ui/Modal.css:19,27-34`: the dialog enters with `ui-modal-in`, whose start keyframe is `transform: translateY(...) scale(0.985)`.
  - The spec measures `limit` once, then reads each control's `getBoundingClientRect().right` in a sequential loop (`hel1510-output-editor-table-overflow.spec.ts:89-112`). Transforms affect bounding rects, so if the loop overlaps the tail of the scale-in, a control read later can sit a fraction of a pixel further right than a limit read earlier. A 0.1px excess (871.6 vs 871.5) fits that mechanism.
  - The change touches no Output editor or Modal file (full `git diff --stat c1add2394...HEAD`).
  - The dialog is a fixed overlay whose width does not depend on the page's spine grid.
  - It is still an unproven flake, not a cleared one, and is not attributable to this change.
- **Unit gates.** I ran `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm --prefix frontend test -- --testPathPatterns='liveOutput|outputRenderInputs|PipelineDetailPage.spine'`: 7 suites, 121 tests, all passed.
- **UI judgment.** The only UI change since round 1 is `h2` → `p` with the same class, so the visual output is identical. Round 1's visual review (both themes, 1280/900/430/375) still applies, and I did not re-screenshot.

### Verdict: CONFIRM

### Non-blocking notes
- `e2e/hel1668-schema-panel-copy.spec.ts:8-9`: the header comment still says "desktop 1280x800". Update it to 1280x840.
- `PipelineSpineLayout.css:24-25`: the comment still says the live-output track is empty and zero-width. That is now false (the evaluator flagged it too).
- The hel1668 margin for "the 384px cap does not fit above" is thin (381.5 vs 384, 2.5px). A future few-pixel shift in the centre column could break that precondition. This is a fixture fragility, not a product defect.
- The evaluator's product trade-off still applies: at 1280 with the 248px list, the centre column is about 363px. It belongs in the PR body as a reversible UI call.
