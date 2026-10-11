## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `cab451da32f9566dcf4f05c08f5fbc4c4bf1d723`. This is the merge of origin/main (HEL-1311/1456/1482/1316) into the evaluator-PASSed `491397765`. The diff base was resolved live with `resolve-review-base.sh` and is `bc8ccac45` (= origin/main HEAD). The spawn-cwd guard returned READY.

My evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1307/evidence/skeptic/final-1/`:
- `shots/`: 36 PNGs;
- `dash-*.json` and `ed-*.json`: computed-style dumps;
- `static.txt`, `jest.txt`, `sbt.txt`: gate logs;
- the seed, view, probe and cleanup scripts.

### What I verified (with evidence)

**Gates, run fresh on cab451da3** (the evaluator's runs were on 491397765, before the merge):

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run check:schemas` | exit 0 (122 protocols, 14 assistant surfaces in sync) |
| `npm run check:tokens` | exit 0 |
| root `npm test` | helio-mcp 45 suites / 443 tests and frontend 524 suites / 5666 tests, all passed, exit 0 |
| backend `sbt testOnly` (niced, `-Xmx3g`) | 161 succeeded, 0 failed |

The backend run covered the specs the merge touches:
- `ConditionalFormatsSpec`, `ConditionalFormatsSeamSpec`, `ConditionalFormatsWriteSpec`;
- `OutputConfigValidationSpec`, `AssistantProposalToolSchemasSpec`, `RefinementEditShapeSpec`;
- `OutputHeatmapHistogramSpec`, `PatchSetApplyServiceSpec`, `PatchSetPreviewServiceSpec`.

The executor's merge-time full `testFull` (6805 passed, `evidence/merge/sbt-testFull.log`) has no SHA stamp, so I treated it as a claim. HEAD has not moved since the merge commit and the worktree is clean.

**Merge resolutions** (`git diff bc8ccac45...HEAD`):
- **`OutputConfigValidation.KnownKeys`:**
  - Metric, Table and Collection each gain `conditionalFormats`.
  - HEL-1311's `heatmap`/`histogram`/`binCount` text survives in `KeysDoc`. The rule-shape sentence is inserted before it, and the `perKind` list is still derived from `KnownKeys`.
  - The `ConditionalFormats` check is chained after `PayloadOptIn` and gated on `ValidateWrite` only.
- **The three request schemas:** identical per-kind key lists, each with the `conditionalFormats` property stub, and HEL-1311's `heatmap|histogram`/`binCount` text intact.
- **helio-mcp:**
  - `OUTPUT_CONFIG_KEYS_DOC` lists the key for all three kinds.
  - The `server.test.ts` pin includes it and passed in the root jest run.
- **Footer:** `disabled={saving || saveDisabled || saveBlocked}`. Both blockers are live, and the sheet passes both.

**AC1 — metric threshold colour in both themes** (running app, isolated headless Chromium, dev 6739 / backend 9646):
- `.panel-content__metric-figure` computed colour equals the resolved token:
  - light: error rgb(175,51,37), warning rgb(133,85,26), success rgb(22,109,67);
  - dark: rgb(241,123,103), rgb(245,185,68), rgb(76,195,138).
- The glyph is `currentColor` and 20px. The unit colour is identical on ruled and plain cards.
- A plain metric renders no figure span.
- Collection items each carry their own tone (20 error / 22 success / 95 warning).

**AC2 — table cell and row rules** (`dash-*-1440.json`):
- Row rules put `ui-data-grid__row--tone-*` on the `<tr>`.
- Unpinned cells get exactly the `-surface` token with `background-image: none`.
- The pinned cell gets one `linear-gradient(surface, surface)` layer over the opaque panel surface.
- A cell-rule cell inside a washed row shows only its own surface and text colour (e2e row: pass_rate 0.85 is error inside a warning row).
- The row mark sits in the first visible (pinned) cell, titled "Build failed".
- Cell marks are 14px. Rows stay 35px tall.
- The long `note` cell still ellipsises (`scrollWidth > clientWidth`) at 1440 and 375.

**AC3 — invalid rules rejected; no rules unchanged** (`probe.cjs`, PATCH against the live backend):

| Case | Result |
|---|---|
| column on a metric rule | 400 |
| bad tone | 400 |
| inverted `between` (index 1) | 400 |
| text value for `gt` | 400 |
| table rule without column | 400 |
| bad target | 400 |
| 21 rules | 400 |
| non-array | 400 |
| valid rule | 200 |
| `[]` | 200 and stored as `[]` |
| `conditionalFormats` on a chart | 400, unknown key |

On the C3 constraint (rendering with no rules is unchanged):
- The only edited existing artifact is the `OutputEditorSheet.openingState` snapshot. It gains one additive `button name="Add rule"` line per kind, and `files-modified.md` calls this out.
- No other existing test was edited; the diff only adds lines.

**Owner rulings 1-6:**
1. First match wins.
2. Numeric ops vs `eq`/`neq` on text work as specified.
3. Metric and collection use tone text only; table cells use tone text on a wash; row rules wash the row.
4. Only the three intent tokens are used.
5. There is a glyph per tone (CircleCheck / TriangleAlert / CircleX), and the label serves as both the `title` and the sr-only text.
6. Table rules require a column; the default target is `cell`; cell and row resolution are independent.
7. The delta / ComparisonLine code is untouched.

**Visual cohesion** (screenshots read by me):
- **Light and dark at 1440:** `dash-light-1440.png`, `dash-dark-1440.png`, `card-*`.
- **Compact 3x2 card** (122px tall, 20px figure): the 20px glyph matches the text height without crowding (`card-CF_compact-*`).
- **375px:** `dash-*-375.png`. `scrollWidth == innerWidth` in both themes, and there are no console errors.
- **Editor section** (`editor-*`, `editor-section-*`):
  - its header uses the same label style as its siblings (14px / 600 / muted);
  - the rule cards use tokens only, with consistent borders in both themes;
  - at 375 the controls stack full width;
  - the metric preview applies the unsaved valid rules.
- Tokens only throughout: no hardcoded colours.

**HEL-1308 seam:**
- Rules compare the raw `data.value` and the raw row value.
- A duration `MetricFormat` would only change `formatMetricValue`.
- A duration column format flows through `formattedColumns[].render`, which `withCellRules` wraps unchanged.
- Neither feature has to touch the other.

**Cleanup:**
- Seeded rows deleted by exact id: the dashboard and two pipelines (204, cascading to the 6 outputs; `GET /api/outputs` then returned 0) and the two sources (204).
- User `6ccd289a-6a18-45a1-b5bb-d0e8b0875b15` deleted, together with its `pipeline_run_rate_window` rows, by exact id.
- Servers stopped by exact PID (3652970, 3652932, 3652299, 3651832, 3651786), and ports 6739/9646 confirmed free.
- My sbt exited.

**Gate-defect check:** none of this rests on mtime ordering, and no mtime-ordering claim was accepted.

### Verdict: CONFIRM

### Non-blocking notes
- **Two save blockers on the footer.** `OutputEditorFooter` now has two props with identical semantics: `saveDisabled` (HEL-1307) and `saveBlocked` (HEL-1311), both of which disable Save. This came out of the merge. A follow-up could fold `rulesInvalid` into `saveBlocked` and drop `saveDisabled`.
- **1px taller cards on mobile.** On the 375 stacked layout, a ruled metric card is 117px against 116px for the plain one. The inline-flex figure with its 20px glyph adds about 1px. It is not noticeable.
- **Overlapping touch targets.** The move up/down/remove `IconButton`s are 24px, 4px apart. Their shared 44px `::after` expanders overlap their neighbours. This is the existing shared pattern, not new to this ticket.
- **Size budget (carried).** `TableRenderer.tsx` and `DataGrid.tsx` are still over the CONTRIBUTING size budget.
