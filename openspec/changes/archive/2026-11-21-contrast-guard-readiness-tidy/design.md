## Context

See proposal.md (Why). State of main at 787a283e9:

- `e2e/support/state-surface-contrast-guard.ts` `registerRouteCells` (1440x900, fine pointer) gates
  `pipeline-detail` on the seeded pipeline name only, then asserts the selected spine row and focused editor, then
  `stampDocument`. It does not wait for the spine card's `Refresh sample of HEL-866 Guard Source` button, which is
  absent until access resolves and `disabled` while the sample loads; `stampDocument` skips disabled elements.
- `e2e/support/state-surface-contrast-guard-narrow.ts` `awaitReady` already waits for that button visible AND enabled
  (HEL-1649), and asserts the button's doc id is in the cell's coverage (`covered`, i.e. visible-in-view, not
  necessarily sampled).
- `probeView(..., sampledDocIds?)` (HEL-1805) fills an optional set with the doc ids actually PROBED (sampled, at most
  `MAX_ELEMENTS_PER_VIEW = 24` per view); the 1440 cell already passes `mainSampledDocIds` for `/connectors`.
- HEL-1649's `mutation-evidence.md` recorded that M1 (the HEL-1628 pre-fix hover) went red at 1440 in ONE run on its
  tree. That shows the 1440 cell CAN measure the button; it does not show it always does. The race is the defect.
- Header comment line ~55 names `state-surface-contrast-guard-narrow.spec.ts`, which HEL-1649 split into
  `-narrow-1100-768.spec.ts` and `-narrow-390.spec.ts`.
- The narrow parts call `registerNarrowCells(NARROW_WIDTHS.slice(0, 2))` and `NARROW_WIDTHS.slice(2)`.
- HEL-1805 (b1c72f7ed): connector seeded in every /connectors cell, connectors scroll-region hover-only exemption,
  centre-before-hover. Untouched by this change.

## Goals / Non-Goals

**Goals:** deterministic measurement of the refresh button in the 1440 `pipeline-detail` cell, with a loud failure
when it is not measured; mutation proof; comment fix; widths by value; proof that the set of cells is unchanged.

**Non-Goals:**
- No application code or CSS change. The M1 mutation is applied, run, logged, and reverted; never committed.
- No new exemption; the only exemptions stay the glass bottom-nav tab (HEL-1801) and the connectors scroll region
  (HEL-1805). Narrow widths keep a mouse (hover-capable) pointer.
- No change to `routes-dense`/`routes-light`'s `ROUTE_KEYS_HEAVIEST_FIRST.slice(...)` selection: that order is a
  deliberate CI shard-balancing knob over route keys, not a width matrix, and the ticket names only the narrow parts.
- No change to `MAX_ELEMENTS_PER_VIEW`, sampling, thresholds, cell titles, or `e2e/shard-weights.tsv`.
- Strengthening the narrow cells' existing refresh assertion from "covered" to "sampled" is not required by the
  ticket; the executor records (does not change) whether the button is sampled at narrow widths, from the count logs.

## Decisions

**D1 -- Readiness wait at 1440, shared with the narrow cells.** In the 1440 `pipeline-detail` readiness branch, after
the seeded-name gate, wait for `getByRole("button", { name: "Refresh sample of " + SOURCE_NAME })` to be visible and
enabled (Playwright web-first `expect(...).toBeVisible()` / `.toBeEnabled()`, never a sleep). Preferred shape: one
exported helper (e.g. `awaitSampleRefreshReady(page)`) in the shared support file used by both the 1440 cell and the
narrow `awaitReady`, so the two cannot drift; inlining at 1440 is acceptable only if extracting would force touching
unrelated narrow logic. Alternative rejected: raising the post-render `waitForTimeout(200)` -- a sleep is not a
readiness signal.

**D2 -- Measured, not merely present.** After `probeView` of the `main` view at 1440 for `pipeline-detail`, assert
the button's stamped doc id is non-null and is in `mainSampledDocIds` (the PROBED set, so its hover and focus were
measured), failing with a message naming the button. Log one `[HEL-1806 guard] "Refresh sample of ..." probed at
1440px (<theme>) in view "/pipelines/:id" (doc id N)` line per cell. If the `/pipelines/:id` main view's visible
count exceeds 24 so the button can fall out of the sample, do NOT raise the cap globally: stop and report (HEL-1649's
rule is to split the view, which would change cell populations and needs its own decision). Alternative rejected:
the narrow cells' "covered" check -- covered includes unsampled visible elements, so it would pass even if the
button's hover were never measured.

**D3 -- Widths by value.** Add a lookup (e.g. `narrowWidths(...values: number[])`) that returns the matrix entries
whose `width` equals each named value, in the order named, and throws naming the width if any is missing (also
throws on duplicates in the matrix for a named width). Part files call it with `1100, 768` and `390`. The matrix
order and contents are unchanged.

**D4 -- Comment.** Replace the stale file name with the two current part files, keeping the rest of the paragraph.

**D5 -- Evidence (C12, red first).** All scratch output under the main checkout's `.concertino/scratch/HEL-1806/`;
committed evidence (as `.txt`) under `openspec/changes/contrast-guard-readiness-tidy/evidence/`. Every run is a full
spec file (no `--grep`), Playwright 2 workers total, one batch at a time, lane-private DB, backend started with
`ANTHROPIC_API_KEY` exported empty.
1. Baseline (before any edit): all five `state-surface-contrast-guard-*.spec.ts` files on the unmodified tree. Record
   test titles and, per cell, every `[HEL-866 guard] view ... visible ..., sampled N` and `elements probed` line.
2. Red: with D1+D2 written and M1 applied (delete the two `.spine-card .source-sample-label
   .ui-icon-btn:hover:not(:disabled)` rule blocks in `frontend/src/features/pipelines/ui/spine/PipelineSpine.css`),
   run `routes-dense` (contains `pipeline-detail`): expect the dark `/pipelines/:id` cell red naming
   `aria="Refresh sample of HEL-866 Guard Source"` with ratio about 1.03; light expected green (same token pre/post fix,
   per HEL-1649). Commit this red log before D3/D4 work and before the green run. Revert M1 (`git checkout` the file)
   and confirm `git diff` shows no CSS change.
3. Wait is load-bearing: test-side mutation M3 -- remove only the D1 wait and delay the sample response (e.g. a
   `page.route` on the sample request that holds it ~5 s) -- expect the cell to fail via D2 naming the button (not a
   silent pass). Then M4 = M3 + M1 with D2 also removed (the pre-change cell shape under a slow sample) -- expect a
   silent green, reproducing how HEL-1628 escaped. Both reverted, logs committed.
4. Green: unmutated tree, all five files, both themes; record the same per-cell lines.
5. Coverage comparison (`coverage-comparison.md`): identical set of test titles before/after (diff of title lists);
   per-cell sampled counts before vs after, with every difference explained (expected: `/pipelines/:id` main may gain
   the refresh button in its visible/sampled counts at 1440; any other difference is a defect or flake to investigate).

## Risks / Trade-offs

- [The refresh button falls outside the 24-sample at 1440] -> D2 fails loudly; executor stops and reports (no cap
  change).
- [Baseline count noise: the pre-change 1440 cell sometimes stamps the button and sometimes not] -> run the baseline
  as is, record what it shows, and say so in the comparison; this IS the race the ticket fixes.
- [Shared Playwright/servers with other lanes] -> lane-private DB and own ports; no MCP-browser use is needed.

## Migration Plan

None. Test-only change; revert is a plain revert.
