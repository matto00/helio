## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: 9d7d871213e63a6659ad782386033fc43784863e. Base: 586da928, resolved live. This cycle's diff runs from 75b7fb6e to 9d7d8712. The only runtime file it changes is `PanelContent.css` (9 lines added, 5 removed).

Evidence is persisted at `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/evaluator-c3/`:
- `red3-75b7fb6e.txt` and `green3-head.txt`: the red and green test runs.
- `head3-{light,dark}-{1440,1900,320}.{json,png}`: the cross-kind comparison against the cycle-2 base data in `evaluator-c2/base-*.json`.
- `containment-*.png` and `geometry-*.json`: geometry from the committed e2e, re-run by me.

### Phase 1: Spec Review — PASS

- **Spec (cycle-2 CR1): done.**
  - The requirement now scopes the at-least-96px chart canvas to "w=2, h=4, annotation + truncation note, NO viewer-control bar". That is a measurable minimum, so the ticket AC ("a stated minimum") still holds.
  - A new scenario covers the control-bar case. It promises containment (no overlap with the header, control bar or footer) and states the measured 33px. It explicitly makes no 96px promise there.
  - A third scenario says other panel kinds, and a chart with no footnote, keep their normal title.
  - Every scenario matches what I measured (below).
- **Scope (cycle-2 CR2): done.** The title and footer rules are now limited by `.panel-grid-card:has(.chart-panel__annotation, .chart-panel__truncation-note)` (PanelContent.css:446-462).
  - I compared metric, table, markdown and a plain chart with no footnotes at 1440, 1900 and 320 (phone stack), in both themes. Title height and clipping, footer height, footer horizontal overflow, content height and card height are all identical to base (586da928). That is 24 of 24 cards, with zero differences.
- **files-modified.md (cycle-2 CR3): done.** It now describes the floor-less narrow block, the containment and scope tests, and the known footer overflow.
- Items 2, 3 and 4 and constraints C1/C2 are unchanged from cycle 2, and they hold:
  - C1: the style guard's comma-preceded negative case is still tested.
  - C2: the height clause never matches in the phone stack, which is inline-size only. The phone stack measures unchanged: canvas 100px at 390 and 320.
- No scope creep beyond the ticket. HEL-1438 is not absorbed. No data hooks are touched (HEL-1392).

### Phase 2: Code Review — PASS

I ran the gates fresh in WORKTREE_PATH on HEAD, and all exit 0:
- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm test` (5162/5162)
- `npm --prefix frontend run build`

Both dev servers' cwd is this worktree (`readlink /proc/<pid>/cwd`).

**The new scope test fails on 75b7fb6e and passes on HEAD.**
- How I ran it: the committed spec, unmodified, through my evaluation-only proxy. The proxy serves 75b7fb6e's `PanelContent.css` in place of HEAD's; that is the only runtime file this cycle changed.
- On 75b7fb6e: 2 of 2 failed. "Quarterly revenue table: title is not line-clamped", expected `"none"`, received `"1"` (light and dark).
- On HEAD: the full spec passes 14 of 14. That is 2 scope tests, 8 containment tests, 2 tests for the at-least-96px canvas plus the phone stack, and 2 "matching rows" tests.

Code quality:
- The `:has()` scoping is the minimal change.
- The repeated `:has()` selector list appears twice, which is acceptable for two rules.
- The `.sr-only` re-declaration has its justifying comment.
- I found no dead code, no type escapes and no magic numbers beyond the documented clamp counts.

### Phase 3: UI Review — PASS

| Check | Result |
|---|---|
| Chart w=2, h=4, annotation + note, no control bar, 1440 and 1900, light and dark | Canvas 102.0px (141.4–243.4). Header 36.4px, a 2-line title. Annotation and note one line each, inside the content box (bottom 277); footer top 289. Short form "200 of 500 rows." shown. |
| Same with a control bar, 1440 and 1900, light and dark | Contained. The bar ends at 198.4, the content starts at 210.4, and the canvas is 33.0px (210.4–243.4). Nothing overlaps. Matches the spec scenario. |
| Footnoted chart title at 1440 | Two lines, then an ellipsis ("HEL-" / "1398…" for "HEL-1398 narrow"). Partly readable; the full title stays in the DOM and accessibility tree. |
| Other kinds at w=2, h=4 (metric, table, markdown, chart without footnotes) | Identical to base at 1440, 1900 and 320, both themes. |
| Phone stack, 390 and 320 | Unchanged. |
| Footer overflow | The known nowrap overflow of about 4px at 1440, now only on footnoted chart cards (cycle-2 measurement 4px). It falls inside the card padding and is not visibly clipped (`containment-1440-*.png`). |
| Console errors | None in any run. |
| Item 4 "matching rows", light and dark | Green. |

### Overall: PASS

### Non-blocking Suggestions

- At 33px with a control bar, the bar chart's y-axis labels collide ("150"/"0" overprint, `containment-1440-ctl-*.png`). The chart is contained, as the spec now promises, but barely legible. This is a design-judgment call for the skeptic or owner, for example hiding the y-axis, or the annotation, under this query. A follow-up ticket is an option.
- The footnoted title at 1440 shows only about 1.5 words. A `title` attribute on `.panel-grid-card__title`, the follow-up the executor already noted, would give sighted users the full text.
- PanelContent.css:411: the comment line edited this cycle is longer than its neighbours (Prettier does not wrap CSS comments). Re-wrap it for consistency.
