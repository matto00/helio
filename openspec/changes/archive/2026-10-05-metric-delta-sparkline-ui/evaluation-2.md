## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `2f677e8d0e9b0ec9a6f43c449047b63363c23da2`. Base `2c49bdba8ffe0df5df65b2c951c0b9bb73173c2b`, resolved live. The cycle delta `481999e2..2f677e8d` touches:
- `PanelContent.css`
- `MetricRenderer.tsx`
- `PanelContent.metricHistory.test.tsx`
- the e2e spec
- `evaluation-1.md`

### Phase 1: Spec Review — PASS

Issues: none.

- **CR1 from evaluation-1 is resolved.** I seeded a fresh metric with a real 7d baseline (1075 → 1204) and placed it with plain `POST /api/panels`, which gives the default 3x2 size. I checked it on this lane's servers (6707/9614):
  - **1440 and 1100:** the grid item is 122px tall. The sparkline is visible (`display: block`, 48x16), sits inline beside "▲ 12% vs 7d", and lies inside the card. Its bottom edge is at y=161, above the footer's top at y=165.
  - **768 and 375 (mobile stack):** the spacious column layout applies (100x24 sparkline under the delta).
  - Both themes behave the same at every width. No horizontal overflow anywhere.
  - The exit criterion now holds at zero configuration beyond choosing compare.
- **CR2 from evaluation-1 is resolved.**
  - The `/auto-layout h: 5` call is gone; the panel keeps the default placement from `POST /api/panels`.
  - The spec asserts `toBeVisible()` on the sparkline `img` at 1440 and 1100. It also asserts box containment within the card and no overlap with the delta.
  - The executor reports a red mutation run. I did not repeat it, but the outcome is certain: `toBeVisible()` fails on a `display: none` element, so reverting the CSS to the cycle-1 hiding would turn the spec red.
- **Constraints C1–C5:** still honoured. The cycle diff adds no workflow, config or migration changes, and compare is still chosen in the editor UI (C5).

### Phase 2: Code Review — PASS

Gates, run fresh by me in `WORKTREE_PATH` under `nice -n 19`:
- `npm run lint` exit 0
- `npm run format:check` exit 0
- `npm run typecheck` exit 0
- `npm --prefix frontend run build` exit 0
- `npm test` exit 0: 434 suites / 4519 tests (+1 against cycle 1), plus 38 suites / 371 tests
- `npx playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=2` (DEV_PORT=6707): 2/2 passed, light and dark
- No backend changes, so no sbt. No FirstRunRoutesSpec timeout, no "Java heap space", and none of the HEL-1294/HEL-1298 flakes seen.

Claims verified:
- **Empty-control test.** It now builds its filter ops through the real `buildViewerControlFilterOps([dropdown], {c1: ""})`, asserts `[]`, and passes `viewerFilterActive` from that result. A new sibling test builds one op from `"west"` and asserts the marker. Together they cover the spec scenario through the same builder the call sites use.
- **DESIGN.md mechanical rules** in the new CSS:
  - `gap: var(--space-2)`, `width: var(--space-9)` and `height: var(--space-4)` are all defined tokens (`frontend/src/theme/theme.css:46,51`).
  - No literal colours.
- **`MetricRenderer.tsx`:** the `.panel-content__metric-meta` wrapper only renders when there is a comparison or a sparkline. The legacy `data.trend` path is unchanged.
- **Public amber stroke.** On authenticated dashboards for my test user the polyline stroke also resolves to `rgb(234, 179, 8)`, i.e. the default `--app-accent`. So the public page uses the same token value, not a different hue. The executor's explanation holds; no change needed.
- **e2e user residue.** The backend has no account self-delete route: the auth routes only delete permissions and API tokens. Leaving the user behind is acceptable residue.

### Phase 3: UI Review — PASS

- **Default 3x2, 1440 and 1100, both themes** (`eval-2-1440-{light,dark}.png`, `eval-2-1100-{light,dark}.png`):
  - The compact layout holds together: "1,204", then one centred row with the delta and a short inline sparkline, with the footer intact.
  - The sparkline's height (16px) matches the delta line's height (14px), so the row reads as one unit and the sparkline stays visually secondary to the value.
  - The stroke is the accent token in both themes and reads clearly on both card surfaces.
  - No clipping of the value, delta, sparkline or footer.
- **768 and 375, both themes** (`eval-2-768-*`, `eval-2-375-*`): the spacious column layout, balanced and centred.
- **Console:** no errors or warnings during the tested flows. The errors seen earlier in the session came from a page whose dashboard I had just deleted, not from this feature.
- **Re-confirmed from cycle 1:** the provenance "Compared with" row and the public route behaviour (the cycle diff does not touch either).

Screenshots, all persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1275/evidence/openspec/changes/metric-delta-sparkline-ui/screenshots/`:
- eval-2-1440-light.png
- eval-2-1440-dark.png
- eval-2-1100-light.png
- eval-2-1100-dark.png
- eval-2-768-light.png
- eval-2-768-dark.png
- eval-2-375-light.png
- eval-2-375-dark.png

My seeded rows were deleted by exact id, and I confirmed the deletion in the DB:
- dashboard c4b4955f…
- pipeline bc4f13d9…
- source bfb12add…
- the backdated history row 28de60b9… (selected by output 10c785df…), which went with them

### Overall: PASS

### Non-blocking Suggestions
- **Long titles clip the footer at 1100.** With a long title ("HEL-1275 Eval2 Revenue") at 1100, the 259px-wide default card wraps the title to three lines, and the footer is pushed out of the 122px card (footer top y=196 against card bottom y=194). This already happens on main, because the compact body overflows whenever the title wraps; the sparkline row adds about 2px. Possible follow-up: clamp panel titles to two lines in compact cards. I overwrote that screenshot with the short-title capture before persisting it, so this finding rests on the measured boxes above, not on an image.
- **Misplaced CSS comment.** In `PanelContent.css` the "1.5px is a literal…" comment now sits above the new `.panel-content__metric-meta` rule instead of the sparkline rule it describes. Move it down one rule.
- **"--" fallback follow-up still open.** The loaded-rows fallback shows "--" for aggregated metrics with no history. This already happens on main and is still a candidate follow-up.
