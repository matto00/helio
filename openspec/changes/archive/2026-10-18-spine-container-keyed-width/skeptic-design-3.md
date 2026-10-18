## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD d8387507734f8e74bbf62df8880923791ec7c08d (artifacts untracked in the change dir).
Cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/pipeline-spine-container-width/HEL-1608`.

### What I verified (with evidence)

- **Round-2 CR1 is resolved.** design.md D2(d) now makes `opacity: 0` AND `pointer-events: none` mandatory on the hidden compacted ⋮, with both restored on `.spine-row:hover`/`:focus-within`, and still forbids `visibility`/`display`. D3 says the two-end probe passes only because the hidden ⋮ cannot be hit-tested. The Risks touch-tap bullet and tasks.md 2.2 carry the same rule. The lever (e) reference and the "No padding lever" splice are fixed.
- **D1 track arithmetic.** I recomputed `clamp(180px, max(34cqi, min(240px, 100cqi - 320px)), 340px)` and got the stated values: 313→180, 465→180, 560→240, 644→240, 796→270.6, 976→331.8.
  - `cqi` resolves against the page container. `.spine-body` is a direct child of `.pipeline-detail-page--spine` (`PipelineSpineLayout.tsx:120,166`), and that element has `container-type: inline-size` and no padding (`PipelineSpineLayout.css:3-14`).
  - At 1280 with the list at 400 the track is 280. So D3(i)'s 270–340 check holds even if the max-list width persists across the reload.
- **Row arithmetic, re-derived from `PipelineSpine.css:182-330` and `SpineStepRow.tsx:87-173`.** At a 180px track the content box is 147px.
  - Today a trunk title gets about 21px and a lane title about 1px. This matches the ticket's 769px measurements.
  - After levers (a)–(c), a lane title gets about 51px. After (d) it gets about 79px, which is at least the 68px "Limit rows" width, so the full title shows.
  - Compaction turns off at a track of about 259px. There a lane title gets about 81px, so there is no readability cliff at the threshold.
- **`:empty` lever (a) is valid.** Every child of `.spine-row__markers` is behind a boolean `&&` (`isDraft`, `isCreating`, `hasValidationError`, `warningCount > 0`, `hasSaveError`), so a stray `0` text node can never defeat `:empty`.
- **Unnamed `@container` audit, reproduced by my own grep.** The rules are at `PipelineSpineHeader.css:255,298,332,342`, `PipelineSpineLayout.css:115,130` and `PaletteSearchBox.css:47`. Their subjects are the header, the filter-condition rows inside `.spine-body__main` (its own container) and the palette. None sit inside `.spine-body__spine`, so a named `spine-column` container changes no existing resolution.
- **Sweep test hooks exist.** The test is at `e2e/hel1579-pipeline-spine-layout.spec.ts:395-487`.
  - `seedPipeline(page, withBranch=false, …)` (:20) adds a "limit" lane when `withBranch` is true (:103-105). This needs no edit to `seedPipeline`, as C3 requires.
  - The 1280×900 reset is at :411.
  - The separate 1280×800 test is at :118-152 and covers AC3's ≥8 preview rows. Task 3.2 re-runs the whole spec.
- **Doc-nit targets exist.**
  - `clamp(270px, 22vw, 340px)` is at archived `design.md:19`.
  - "Below 1100px…" is at `PipelineSpineHeader.css:295`.
  - "After the 1100px block…" is at `:331`.
  - The paused-chip icon is `display:none` at `:342-346`, matching the delta's corrected wording.
- **AC coverage.** AC1 is covered by tasks 1.1/3.1. AC2 is covered by task 1.2 and its persisted `red-proof.txt`. AC3 is covered by task 2.1 with D3(i) plus the 1280×800 test.
  - Phone layout: `spine-column` exists only in the desktop layout, and phone rows never render in `.spine-body__spine`. The hel1582 specs are re-run (task 3.2).
  - C1–C3 are restated verbatim in tasks.md.
- **Centre-column regression check.** The new track narrows the main column at some widths (for example, main 356 vs 398 today at 900px with the list at 248). D1's "main ≥ ~320 whenever spine > 180" bounds this. The sweep's existing editor-action and header assertions still run at every width, so any wrap regression is caught.

### Verdict: CONFIRM

### Non-blocking notes

- **Spec delta, first requirement wording.** The text says "about 240px wherever that still leaves the centre column at least about 320px". Read literally, this contradicts "270–340px at 1280×800", since D1 gives 332 there. Suggest "at least about 240px" when the executor touches the spec.
- **D2(d) "row-coloured background".** Row hover paints on `.spine-row__select`, while `.spine-row:hover` is transparent (`PipelineSpine.css:344-358`). The revealed ⋮'s backing should match the select's hover and selected tones in both themes. Check this in the task 3.3 screenshots.
- **Marker width is not budgeted.** A row that shows a marker (warning, error, Draft chip) loses width that the 79px lane budget does not include. The sweep will reveal this if the seeded pipeline produces any marker.
