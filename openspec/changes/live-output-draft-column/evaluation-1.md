## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `9698d6aaeebd2dd55d9b7829742e9f102ddffdff`. Diff base: `c1add2394` (resolved live with `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS (one artifact note, see CR 3 and CR 4)

- AC1 (parity): met. `outputRenderInputs.ts` is now the single source for `recordsToPanelRows`, the chart grouping, appearance and aggregate, and `metricLoadedValue`. `ChartOutputPanel`, `MetricOutputPanel`, `usePanelData` and `usePublicPanelData` call it, and the change preserves behaviour: the existing panel suites pass unchanged (40 suites, 551 tests, run by me). The live metric headline is the draft value, and the parity test's history case asserts saved shows "1204" while live shows "68".
- **The parity test can fail (mutation-checked in a throwaway detached worktree, since removed):**
  - M1: in `chartRenderInputs`, change `fieldTypes: toChartFieldTypes(schema)` to `toChartFieldTypes(null)`. Result: 2 tests fail (both chart parity cases).
  - M2: in `LiveOutputRender`, pass `records.slice(1)` to `metricLoadedValue`. Result: 2 tests fail (metric parity, and history vs draft).
  - M3: in `LiveOutputRender`, pass `chartAggregate={null}`. Result: 1 test fails (the aggregated bar case).
  - Limit: both sides of the test take their records from `frameToRecords`, so a defect in `frameToRecords` itself is caught only by `frameRecords.test.ts` (Integral and order cases), not by the parity test. That is acceptable.
- AC2 (no network per edit): met. In the running app at 1280 I made 6 filter edits and saw zero `/api` requests. Load made one `GET /api/outputs/<chart>/history`. Selecting the step that carries the metric Output made one history read for the metric. Going back to step 1 made no new read. The hel1632 e2e asserts the same thing.
- AC3 (caption, pill states, not-previewed): met. Covered by the e2e: live, stale on error, updating then live on a server-only step, Discard back to saved, AI step shows saved data labelled stale. `liveOutputSource.test.ts` covers every row of the D3 table.
- Tasks: all ticked, and they match the code.
- Scope: no backend, schema or migration change (C1). No out-of-scope files.
- Constraints:
  - C1: honoured.
  - C2: honoured. `hel1631-draft-mode.spec.ts` is unchanged in the diff and green in my run.
  - C3: honoured, measured as above.
  - C4: honoured in my runs.
  - C5: I deleted my test data by exact id (pipeline `ca7b2def-...` returned 204, source `ae6dd27f-...` returned 204, Output afterwards returned 404). The e2e users were removed by HEL-1301 teardown ("deleted 27").
  - C6: not fully honoured. See CR 3.
  - C7: honoured. The gated burst with a chart Output passed in my run.

Judgment on the executor's claimed deviations:
1. **Layout keyed on a JS-measured `data-live-layout` attribute (960px), not a container query: acceptable.** The hook measures `.spine-body`, whose own width does not depend on the grid template it switches, so it cannot oscillate. The measurement runs in `useLayoutEffect`, before paint, and again on `ResizeObserver`. Under jsdom it defaults to wide. Live at 1280 with the context list at 248: the layout is `column`, the column is 340px, the spine 273px and the centre about 363px.
2. **Spine `clamp(220px, 28cqi, 340px)` while the column is present: acceptable.** The spine is 273px at 1280 (inside the 270-340 invariant). `hel1579-pipeline-spine-layout.spec.ts` passed 14/14 in my run, including the 769-1100 title sweep and the 1280/1440 no-scroll checks.
3. **A pending step with no frame shows saved rows marked "updating": acceptable.** It extends the D3 "pending" row sensibly, and the alternative is an empty card.
4. **Marker aria-label "Output is <state>": acceptable.** It is distinct from the preview table's "Preview is live".
5. **Saved rows read with limit=500: acceptable.** Confirmed: `backend/.../domain/model/pagination.scala:12` has `MaxLimit: Int = 500`. However `design.md` D5 still says `getOutputRows(outputId, 0, 1000)`. See CR 4.
6. **Evidence screenshots via `evidencePath`, copied to scratch: acceptable.** My run regenerated them in `e2e-evidence/HEL-1632/`, and I persisted the ones I cite below.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in WORKTREE_PATH:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | ok |
| Targeted jest (`HELIO_JEST_MAX_WORKERS=2`, nice 19): liveOutput, outputRenderInputs, frameRecords, liveOutputSource, PipelineDetailPage, ChartOutputPanel, MetricOutputPanel, usePanelData, usePublicPanelData, TokenGuard, usePipelineDraft, PipelineMobile, MobilePreview, PipelineSpine, OutputPanelContent | 40 suites, 551 tests, all passed |
| e2e (under the flock, `--trace retain-on-failure`): `hel1631-draft-mode` + `hel1632-live-output` | 27/27 passed |
| e2e: `hel1579-pipeline-spine-layout` | 14/14 passed |

I did not re-run the full jest suite, per the run brief.

Issues:
- **[mechanical] DESIGN.md §"Type" line 375, "No numeric `font-weight` literals":**
  - `frontend/src/features/pipelines/ui/liveOutput/LiveOutputColumn.css:69` has `font-weight: 600;`
  - `frontend/src/features/pipelines/ui/liveOutput/LiveOutputColumn.css:124` has `font-weight: 600;`
  - These are the only two numeric `font-weight` literals in all of `frontend/src/**/*.css` (grep). The token is `--weight-semibold`.
- **[mechanical] DESIGN.md §3 line 123, "Never hardcode a value a token exists for", plus the §"Eyebrows" recipe at lines 398-399, "Use the `.eyebrow` utility or copy its recipe":**
  - `LiveOutputColumn.css:17-24` (`.live-output__eyebrow, .live-output__toggle`) hand-rolls the eyebrow with `--text-xs` and `letter-spacing: 0.08em`.
  - The `.eyebrow` utility uses `--eyebrow-size` (`--text-micro`), `--eyebrow-tracking` and `--eyebrow-weight`.
  - design.md D6 asked for "the spine's mono eyebrow style", and the spine uses the `eyebrow` class (`PipelineSpine.tsx:136`, `SpineOutputs.tsx:45`). The "OUTPUT" eyebrow is visibly larger and tracked differently from the "SOURCE / STEPS / OUTPUTS" eyebrows beside it in the 1280 screenshots.

Everything else checked:
- DRY: the shared render inputs are a real de-duplication. `LiveTable` duplicates a little; see suggestions.
- Types: no `any`. There is one `!` non-null assertion; see suggestions.
- Security: nothing new at a boundary. All new reads go through the existing services.
- Error handling: a failed saved-rows read shows "No saved data yet...". A failed history read returns silent `null`, which is the existing `useOutputHistory` behaviour.
- Dead code: none found.
- Over-engineering: none.
- The refactor of the panel files preserves behaviour (the diff moves code without logic changes, and the panel suites are unchanged and green).

### Phase 3: UI Review — PASS

Running app on DEV_PORT 7064 / BACKEND_PORT 9971 (dev account, my own seeded pipeline, since deleted):

- **1280×800, dark:**
  - Column 340px. `document.scrollingElement` scroll = 0.
  - With no draft: no marker, caption "Rendered from the saved pipeline over the cached sample.", tiles "ROWS OUT 14 / same as last run" and "SUM DURATION_S 4,277".
  - After the edits: "live" marker, "ROWS OUT 8 / −6 vs last run", "SUM DURATION_S 2,612", and the draft caption.
  - Screenshot: `/home/matt/Development/helio/.concertino/scratch/HEL-1632/eval-1280-light-bar-live.png`. The account theme is dark despite the file name.
- **375 phone, dark:** the column renders in the Preview tab. The `Select` trigger is 44px. Scrolled to the end, the caption's bottom is at 663px and the floating pills start at 696px, so the caption clears them. Screenshot: `/home/matt/Development/helio/.concertino/scratch/HEL-1632/eval-375-dark-scrolled.png`.
- **e2e evidence (fresh from my run, persisted):**
  - `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/live-1280-light.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/live-1280-dark.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/live-900-light-open.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/live-375-dark.png`
  - The executor's set covers 430 and motion Full/Subtle/Off: `/home/matt/Development/helio/.concertino/scratch/HEL-1632/`.
  - Motion: the three motion screenshots differ only by chart animation state, and this change adds no motion.
- **Console:** the only error was the existing `GET /api/pipelines/:id/schedule` 404 (no schedule exists). Nothing new.
- **Accessibility:** the marker is `role=status` with an accessible name. The disclosure toggle is a `<button>` with `aria-expanded` and a `:focus-visible` ring. The Output picker is the shared `Select` (accessible name "Displayed Output").
- **Judgment (deferred to the skeptic):** at 900 with the disclosure open (`live-900-light-open.png`), the focused editor is squeezed to about one row. That is a visual-balance call, not a mechanical one.

### Overall: FAIL

The failure is mechanical only: two DESIGN.md [mechanical] token rules, plus small artifact fixes. Function, the network contract, latency, parity and the mutation checks all pass.

### Change Requests

1. `frontend/src/features/pipelines/ui/liveOutput/LiveOutputColumn.css:69` and `:124`: replace `font-weight: 600;` with `font-weight: var(--weight-semibold);` (DESIGN.md line 375 [mechanical]).
2. `frontend/src/features/pipelines/ui/liveOutput/LiveOutputColumn.tsx`: in the non-disclosure branch, render the "Output" eyebrow with the shared utility: `className="live-output__eyebrow eyebrow"`. Then remove the hand-rolled `font-family`, `font-size: var(--text-xs)`, `letter-spacing: 0.08em` and `text-transform` from `.live-output__eyebrow` in `LiveOutputColumn.css:17-24`, keeping only the colour. For `.live-output__toggle`, either add the `eyebrow` class to the button or copy the recipe exactly (`--eyebrow-size`, `--eyebrow-tracking`, `--eyebrow-weight`). This follows DESIGN.md line 123 [mechanical] and lines 398-399, and matches the spine's "SOURCE / STEPS / OUTPUTS" eyebrows.
3. C6 (CON-260): `openspec/changes/live-output-draft-column/files-modified.md` omits paths the commit adds: `.openspec.yaml`, `design.md`, `proposal.md`, `skeptic-design-1.md`, `skeptic-design-2.md`, `specs/pipeline-detail-spine-layout/spec.md`, `specs/pipeline-live-output-column/spec.md`, `ticket.md`. List each one explicitly.
4. Make the planning artifacts match the final behaviour in `openspec/changes/live-output-draft-column/design.md`:
   - D5: change `getOutputRows(outputId, 0, 1000)` to the 500 page maximum (`Page.MaxLimit`).
   - D7: change the `@container (min-width: 960px)` mechanism to the measured `data-live-layout` attribute with `THREE_COLUMN_MIN_WIDTH = 960`, and the spine `clamp(220px, 28cqi, 340px)` while the column is present.

### Non-blocking Suggestions

- Duplicate landmark name: `PipelineSpineLayout.tsx:295` `<aside aria-label="Live Output">` wraps `LiveOutputColumn`'s `<section aria-label="Live Output">`, so screen readers announce "complementary Live Output > region Live Output". Drop one of the two labels.
- `useSavedOutputRows.ts:723` `useEffect(() => clearSavedOutputRows, [])` clears the module-wide cache whenever any consumer unmounts. On a phone, leaving and re-entering the Preview tab re-reads `/rows` for a not-previewed Output, which loosens "once per page load". Under StrictMode dev it also double-fetches. Consider clearing on route leave instead (alongside `usePipelineClearRunOnLeave`).
- `LiveOutputRender.tsx:113-150` `LiveTable`: its doc comment says "column order and visibility win", but no visibility is applied, so fix the comment. `cfg.columnOrder!` (line 126) can be avoided by hoisting `const order = cfg.columnOrder ?? []`. It also duplicates `OutputPreviewPane`'s inline table branch; extracting a shared read-only table would remove the copy.
- `usePanelData.ts:2` and `usePublicPanelData.ts:2`: the new relative import sits between the `react` and `react-redux` imports. Move it into the local-import group.
- Tile values (`.live-output__tile-value`) are sans. DESIGN.md line 400 says "metric values are mono". This is a [judgment] call for the skeptic.
