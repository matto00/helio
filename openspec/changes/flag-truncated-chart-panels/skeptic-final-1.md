## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `80196536d3024a35cc2a9b807be946ea444d25cc`. Diff base `0ebc784be678caa547bebe76c070a6834bad7e6b`, resolved live by `resolve-review-base.sh` (main/origin).

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/flag-truncated-chart-panels/HEL-1358`.
- Diff read in full (`git diff 0ebc784be...HEAD -- frontend/src`). The change touches the frontend only: `chartTruncationNote.ts`, `PanelContent.tsx:281-288`, `ChartOutputPanel.tsx`, `ChartRenderer.tsx:78-82`, `PanelContent.css:392-410`, `PanelFullscreenOverlay.tsx:123,231`, and `PanelDetailModal.tsx:215,512`.
- AC1 and AC2 logic: `chartTruncationNote` fails closed. It needs `rowsTruncated === true`, a finite total, and loaded < total. The loaded count is `rawRows.length` before any cross-filter (`PanelContent.tsx:257`). `rowsTruncated` comes from `paginationEntry.hasMore` (`usePanelData.ts:269`). The total is the same `paginationState[panel.id].total` the grid card reads (`PanelCardBody.tsx:272`), and fullscreen and the detail modal now read it too.
- AC3: I opened the public viewer live (`/dashboards/ac8e5646-…/panels?token=129b0bd0-…`). Both truncated charts show "Based on the first 200 of 1,234 rows." (clientWidth equals scrollWidth at 1134px), and the complete charts show nothing. No backend or schema file is in the diff.
- AC4: tokens only. Computed color is light `rgb(100,94,86)` and dark `rgb(170,164,156)`, at 12px (`--text-xs`). The note is a plain `<p>` in reading order.
- AC5: `history/chartOverlay.ts` is not in the diff. The overlay test is in `PanelContent.chartTruncation.test.tsx`.
- Gates, re-run by me: targeted jest (`chartTruncation|truncation`) passed 5 suites and 16 tests. ESLint `--max-warnings 0` on the 5 changed source files exited 0. For the full suite, build and format I relied on the evaluator's pasted output (473/473 suites, build EXIT=0).
- Servers: `start-servers.sh` reused the healthy servers and `assert-phase.sh servers` printed `PASS servers`. Vite serves this worktree's `chartTruncationNote.ts`, confirmed by curling the module source.
- **The judgment call the evaluator deferred to me, reproduced live.** Same dashboard, 1440x1000 viewport, light then dark:
  - Narrow (w=2) aggregated chart: the note has `clientWidth 174`, `scrollWidth 226`. It renders "Based on the first 200 of …", so the total is clipped.
  - Wide chart: 525/525, not clipped.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1358/evidence/.playwright-mcp/hel1358-skeptic1/01-narrow-w2-dark-clipped.png`.
- Remedy probe, done in the browser only with no code change: I set the note to a 2-line clamp, the same rule `.chart-panel__annotation` uses (`PanelContent.css:189-194`). The full sentence then fits (`scrollHeight 42 == clientHeight 42`, `scrollWidth 174 == clientWidth 174`). Height went from 24.8px to 41.6px, and the extra line appears only when the text would otherwise clip. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1358/evidence/.playwright-mcp/hel1358-skeptic1/02-narrow-w2-dark-probe-2line-clamp.png`.

### Judgment on the narrow-panel ellipsis
Not acceptable. AC1 requires the notice to name **both counts**, and the total is the very number the ticket wants surfaced. At w=2 the one-line clamp hides exactly that number.
- w=2 is a reachable layout, not an edge case: it is the grid's own `minW` (`panelGridConfig.ts:66-84`).
- At lg/md, w=2 is about 175–225px of content, while the default-locale sentence needs 226px. Longer totals ("1,234,567") or longer-formatted locales clip at wider panels too.
- The only fallback is `title`, which needs hover. Touch and keyboard users get nothing.
- A disclosure that truncates its own key fact is off-pattern. The sibling footnote it sits under already wraps to two lines.
- The fix is a CSS change that brings the note into line with the existing annotation rule.

### Verdict: REFUTE

### Change Requests
1. `frontend/src/features/panels/ui/PanelContent.css:394-406` (`.chart-panel__truncation-note`): replace the one-line clamp (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`) with the same 2-line clamp `.chart-panel__annotation` uses (`overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; word-break: break-word`). Then the full "Based on the first N of M rows." is visible at the grid's minimum panel width. A shared footnote base rule or grouped selector is preferred over copying the declarations a third time; the evaluator flagged the duplication already. Acceptance:
   - Live measurement at a w=2 chart panel (lg or md): `scrollHeight == clientHeight` and the visible text includes the total.
   - A screenshot in both themes.
   - The default-size and three-footnote coexistence screenshots are re-checked: the canvas must still render, and a note that fits on one line stays one line.
   - Design D3 is updated to match.
   An equivalent alternative is acceptable only if the total is always visible at w=2, for example a shorter form "200 of 1,234 rows" chosen by container query. Note that a JS-measured variant would need its own test.

### Non-blocking notes
- `tasks.md` 2.5 is still unchecked. Tick it and cite the evidence refs.
- The PR body must restate that the overlay for charts over 200 rows is deferred (AC5), and propose splits for `PanelContent.tsx` and `PanelDetailModal.tsx`, which are over the ~400-line threshold (CONTRIBUTING).
- The "matching rows" wording was not exercised live. Unit tests cover it.
- Shared browser: `localStorage['helio-theme']` is now `dark` on `localhost:6790`. I created no new dev-DB rows. The probe style was injected in the page only, and the page has since been navigated away.
