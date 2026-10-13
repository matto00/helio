## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed: `46c95f1332bb9445e4998a71686ca21405e18427` (HEAD, archive commit) on `bug/footnoted-chart-card-canvas/HEL-1444`.
Diff base, resolved live with `resolve-review-base.sh`: `34c6c623662f1e58fecad4914e5d401d8fc50d3b` (origin/main).
Cycle 1 (evaluation-1.md) reviewed `2f6841028` with a merge-base of `a369a9cb8`.

### Phase 1: Spec Review — PASS
Issues: none.

- **The squash dropped nothing.** The non-openspec file lists of `a369a9cb8..2f6841028` (cycle 1) and
  `34c6c6236..508e04a7a` (squashed) are identical: 13 files (`diff` of the two lists is empty). Content differences
  between `2f6841028` and `508e04a7a` on those files are confined to 4 files, and every one of them is a follow-up item:
  `e2e/hel1444-footnoted-chart-canvas.spec.ts`, `buildChartOption.ts`, `buildChartOption.valueAxisCap.test.ts` and
  `valueAxisLabels.ts`. The merged-in main commits (HEL-1491, HEL-1458, #979) touch none of this branch's files.
- **Archive commit `46c95f133`.** This is a pure rename of the change dir into `archive/2026-10-12-...`. It also adds
  evaluation-1.md, drops the transient `files-modified.md`, and syncs three spec deltas into `openspec/specs/`:
  - `chart-panel-truncation-notice`: the "Footnotes never collapse a narrow chart" requirement is replaced with the
    any-width version, and five scenarios are added.
  - `echarts-chart-panel`: the new "Value-axis labels never overprint on a short chart" requirement is added.
  - `panel-container-queries`: the new "A clamped panel card title exposes its full text" requirement is added.

  The synced text matches design.md D1-D4 and the C1/C2 constraints. The sync adds no TBD Purpose:
  `chart-panel-truncation-notice` has a real Purpose, and `echarts-chart-panel` is unchanged above the append. The
  `TBD - created by archiving change css-container-queries-panels` Purpose in `panel-container-queries/spec.md:4` was
  already there on main; it is one of 41 such placeholders repo-wide and only appears as context in this diff.
  `npm run check:openspec` reports "openspec/ is clean". `openspec/changes/` now holds only `archive/`.
- **CONSTRAINTS.** C1 (the hel1398 annotation check becomes hidden-but-in-the-a11y-tree, not deleted) is unchanged
  since cycle 1. C2 (the min/max promise is tested in both unit and e2e) is now tested more strictly; see items 1-2
  below.

### Phase 2: Code Review — PASS
Gates, fresh, run by me in WORKTREE_PATH at HEAD (nice -n 19, local caps of 3 jest workers and 2 Playwright workers):

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run check:openspec` | exit 0 |
| `npm test` | exit 0: 49/49 suites and 458 tests, plus 575/575 suites and 6869 tests |
| `npm --prefix frontend run build` | exit 0; the only warning is the existing chunk-size one, with no circular-dependency warning |

The jest log is at `ref=/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/e2e-evidence/HEL-1444/eval-c2/jest.log`.

Cycle-1 non-blocking items:

1. **Fixed.** The e2e min/max check is now conditioned on fit, not on what was drawn. At
   `e2e/hel1444-footnoted-chart-canvas.spec.ts:484` it reads
   `if (probe!.ticks.length >= 2 && probe!.plotHeight >= 12)`, and both the min and max are asserted unconditionally
   inside it. The check fires on real data. In this run's measurement JSON:
   - bar-one at w2/w4/w6 has plotHeight 38/33/33;
   - hist-one-w2 has plotHeight 15;
   - hist-one-w4/w6 has plotHeight 11, which is below one pitch, so the check is correctly skipped there (min and max
     are still drawn).

   Evidence: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/e2e-evidence/HEL-1444/measure-light-1440.json`.
2. **Fixed.** The unit test was renamed to "a cap of 1 caps at one split and keeps the axis min and max labelled".
   It now asserts `splitNumber`, `showMinLabel`, `showMaxLabel` and `hideOverlap`
   (`buildChartOption.valueAxisCap.test.ts:76-82`).
3. **Fixed.** The yAxis-cap block moved to `valueAxisLabels.ts` as `applyValueAxisSplitCap(built, cap)`. The call
   site is a single line, `if (!isPie) built = applyValueAxisSplitCap(built, valueAxisSplitCap);`
   (`buildChartOption.ts:425`). `buildChartOption.ts` is now 428 lines: 420 on base, 447 in cycle 1. The 120-character
   comment is gone. Behaviour is preserved: same fields, same guards (value-type y axis, defined cap, non-pie). This is
   confirmed by the unchanged unit cases still passing and by the e2e label sets (below).

The refactor introduces a new import cycle: `valueAxisLabels.ts` imports constants from `buildChartOption.ts`, and
`buildChartOption.ts` now imports `applyValueAxisSplitCap` from `valueAxisLabels.ts`. The executor neutralised the
initialisation-order hazard by making `labelPitchPx` lazy (`valueAxisLabels.ts:9-11`, with a comment naming the cycle).
No top-level code in either module reads the other's bindings. The build emits no cycle warning, and jest, the dev
server and the production build all work. This is not a correctness defect, so it is a non-blocking suggestion below,
not a change request. No `[mechanical]` rule in CONTRIBUTING.md or the ESLint config forbids import cycles.

No new `any`, dead code, TODO/FIXME or design-token changes are in the follow-up diff.

### Phase 3: UI Review — PASS
I started servers with `start-servers.sh` and checked them with `assert-phase.sh servers`, which returned PASS on
6876/9783. Both listening processes' cwd was this worktree's `frontend/` and `backend/`. I stopped them afterwards with
`stop-servers.sh` (STOPPED ports=6876,9783).

- **Affected e2e specs, run by me against HEAD.** I ran hel1444, hel1398, hel1305, hel1306, hel1311, hel1508 and
  hel1512 with `DEV_PORT=6876 BACKEND_PORT=9783` and 2 workers: **51 passed (3.0m)**, 0 failed, 0 flaky. The global
  teardown deleted all 51 recorded throwaway users. Log:
  `ref=/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/e2e-evidence/HEL-1444/eval-c2/e2e.log`.
- **Console errors and breakpoints.** The hel1444 specs do not listen for console errors, so I ran my own probe:
  - Setup: throwaway user `eval1444c2-1791860825942-34548@example.test`, id `c26d4faf-0f3e-4ef2-be3e-09557eb8684e`,
    verified via `/api/auth/me`. The teardown deleted it.
  - Scenario: a w2 h4 bar chart with an annotation, a truncation note and a one-text-control bar, in light and dark
    at 1440, 1100 and 768.
  - Results:
    - **Zero** console errors or page errors.
    - Canvas height is 71px at 1440 and 1100, above the 60px floor for a one-control bar with 2 footnotes.
    - At 768 the card is in the mobile stack (canvas 100px), and the title tooltip is not applied there, as the spec
      scopes it to the desktop grid.
    - The dark 1440 card shows the inline "REGIO…" label beside its input. The y labels 900/300/0 do not overlap. The
      truncation note is visible and the annotation is hidden at w2, as D3 requires.
  - Evidence: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/e2e-evidence/HEL-1444/eval-c2/probe/eval-c2-probe.json`,
    `.../probe/c2-dark-1440-short.png` and `.../probe/c2-light-1100-short.png`. The probe source and config were
    persisted to the same directory and removed from the worktree.
- The visual design is unchanged since cycle 1, whose full breakpoint, keyboard and a11y pass stands. Judgement calls
  remain with the skeptic.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- **Break the `buildChartOption` <-> `valueAxisLabels` import cycle.** Moving `COMPACT_AXIS_LABEL_FONT_SIZE` and
  `COMPACT_GRID_INSET_PX` into a small leaf module (for example `compactChartMetrics.ts`) would let `labelPitchPx` go
  back to a plain `const`. The lazy-read workaround is correct today, but a future top-level use of either constant in
  `valueAxisLabels.ts` would hit the initialisation-order hazard again.
- Cycle-1 suggestions 4-6 still apply as PR/OWNER REVIEW notes:
  - typing into the inline control can empty the chart and flip the bar back to stacked;
  - a footnote-less one-control w2 h4 chart has a starved canvas (pre-existing, worth a follow-up);
  - the "Regio…" ellipsis at w2.
