## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `7a79eb4a540fba0ac1e0b68ddc4700198a4ecc9b`. Diff base `0ebc784be678caa547bebe76c070a6834bad7e6b`, resolved live by `resolve-review-base.sh` (main/origin, exit 0).

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/flag-truncated-chart-panels/HEL-1358`.
- I read the whole diff fresh (`git diff 0ebc784be...HEAD -- frontend/src`). The change is frontend-only: `chartTruncationNote.ts`, plus wiring in `PanelContent.tsx`, `ChartOutputPanel.tsx`, `ChartRenderer.tsx`, `PanelFullscreenOverlay.tsx` and `PanelDetailModal.tsx`, plus CSS. No backend, schema or public-endpoint change.
- **Round-1 CR1 fix (7a79eb4a5).** `.chart-panel__truncation-note` is now in a combined selector with `.chart-panel__annotation` (`PanelContent.css:180-197`), so it gets the 2-line clamp. The old one-line rule (`nowrap` + `ellipsis`) is gone. The only rule specific to the note is the sibling join `.chart-panel__annotation + .chart-panel__truncation-note { padding-top: 0 }`. The structural guard `PanelContent.truncationNoteStyle.test.ts` asserts the shared selector, line-clamp 2, no standalone rule and no `nowrap`. It is labelled as structural only, which is correct because jsdom does no layout.
- **Dev server serves HEAD's CSS.** `curl localhost:6790/src/features/panels/ui/PanelContent.css` contains the combined selector and the new comment. `start-servers.sh` reused the healthy servers, and `assert-phase.sh servers` printed `PASS servers`.
- **CR1 done-when, measured live** (authenticated dashboard ac8e5646…, 1440x1000):
  - w=2 card (216px wide, "Region revenue (aggregated)"):
    - Dark theme: text "Based on the first 200 of 1,234 rows.", `clientWidth 174 == scrollWidth 174`, `clientHeight 42 == scrollHeight 42`. Two lines, total fully visible.
    - Light theme: identical measurements.
    - Screenshots: `/home/matt/Development/helio/.concertino/runs/HEL-1358/evidence/.playwright-mcp/hel1358-skeptic2/02-auth-dark-w2-and-wide.png` (dark) and `/home/matt/Development/helio/.concertino/runs/HEL-1358/evidence/.playwright-mcp/hel1358-skeptic2/03-auth-light-w2-and-wide.png` (light).
  - Wider panels keep the note on one line:
    - 567px card: note `clientHeight 25`, one line, canvas 94px with annotation.
    - Public viewer at 1134px: 25px, one line, canvas 100px.
    - So the 2-line clamp only adds a line when the text would otherwise clip.
  - Default size (h=5): I set the w=2 grid item to 332px in the browser only. The canvas measured 75px and ECharts drew a 75px canvas with both annotation and note present.
- **AC1/AC2.** The note appears on both truncated charts and is absent on the three complete ones ("over time", "top region", table). This holds on the authenticated grid, fullscreen and public viewer. `chartTruncationNote` fails closed: it requires `rowsTruncated === true`, a finite total and loaded < total.
- **AC3.** Public viewer (`/dashboards/ac8e5646…/panels?token=129b0bd0…`) shows the note on both truncated charts. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1358/evidence/.playwright-mcp/hel1358-skeptic2/04-public-light.png`. No new public data.
- **AC4.** Tokens only (`--app-text-muted`, `--text-xs`, `--space-*`, `--font-sans`).
  - Computed color is light `rgb(100,94,86)` on `rgb(253,252,250)` and dark `rgb(170,164,156)`.
  - It is the same style as the sibling annotation footnote. That is a direct pattern reuse, not a one-off.
  - The note is a plain `<p>` in reading order, so assistive tech gets it.
- **Fullscreen** shows the note beneath the annotation. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1358/evidence/.playwright-mcp/hel1358-skeptic2/05-fullscreen-light.png`.
- **AC5.** `history/chartOverlay.ts` is untouched. The overlay-still-hidden test is present in `PanelContent.chartTruncation.test.tsx`.
- **Gates re-run by me:**
  - `jest --testPathPatterns='truncation|Truncation|ChartRenderer|PanelContent'`: 10 suites, 76 tests passed.
  - `eslint --max-warnings 0 src/features/panels/ui/`: no output.
  - `tsc --noEmit`: exit 0.
  - `prettier --check` on the changed CSS and test: clean.
- **Console.** No app errors. A batch of 429s appeared after my own rapid reloads; that is the dev rate limiter. They cleared after waiting 60s and are not caused by this change.

### Verdict: CONFIRM

### Non-blocking notes
- **Minimum panel size plus annotation crowds out the chart.** At the grid's minimum card (w=2, h=4 = 262px) with an author annotation on a truncated chart, the canvas collapses to about 5px; the chart is effectively gone. I measured each footnote's contribution in the browser:

  | Footnotes present | Canvas height |
  |---|---|
  | Neither | 92px |
  | Annotation only (= `main` today) | 47px |
  | Note only | 51px |
  | Both | 5px |

  The annotation already halves the canvas on `main`, the user can enlarge the panel, and round 1 accepted this trade so the total is never hidden. Not blocking. A follow-up could switch to a shorter "200 of 1,234 rows" form via container query at narrow widths, or put a minimum height on the canvas.
- **Stale "one line" wording after the fix:**
  - `ChartRenderer.tsx:32` prop doc still says "one-line note".
  - `design.md` D3a (line 61) still says "truncation note (1 line)".
  - `design.md` risk (line 85) still says "one `--text-xs` line".
  - Update them before archive.
- The three-footnote case with the cross-filter disclosure was not reproduced live. My synthetic click on the canvas did not trigger a cross-filter. It is covered by the D3a DOM-order render test. Because the note is still one line at default widths (measured), that case's layout is unchanged from what the evaluator verified.
- The PR body must restate that the overlay for charts over 200 rows is deferred (AC5) and record the owner's product question.
- Shared browser state: `localStorage['helio-theme']` is now `light` on `localhost:6790`. The height override was a browser-only DOM change and was discarded on navigation. No dev-DB rows created.
