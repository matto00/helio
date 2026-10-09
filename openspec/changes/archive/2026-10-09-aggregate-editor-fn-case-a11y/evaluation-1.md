## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `ad1123261c4b849929581a5bf1032f8ef41b3957` (base resolved live: `e7470bc620557e3c0f27db637d7fb28811cb516c`).

### Phase 1: Spec Review — PASS
- Item 1 (case-insensitive fn): `fnKey = agg.fn.toLowerCase()` drives Select value, hint and p-gate (`AggregateConfig.tsx:233-267`). Verified live: stored `"SUM"` shows picker `sum` + hint; stored `"PERCENTILE"` shows picker `percentile`, hint, and the p input with value 90.
- Item 2 (p a11y): `FormField` with `htmlFor`/`errorId`, `aria-invalid`/`aria-describedby` set only while the error shows. Verified live: `aria-invalid="true"`, `aria-describedby="_r_8_-p-err-1"` resolves to the `role="alert"` error `<p>`; both attributes clear on a valid value; clicking the `<label>` focuses the input.
- Item 3 (min/max): new `aggregateResultType` returns `float` for min/max, aggregate op only; `aggResultType` (groupby) unchanged. Verified live via `/api/pipelines/:id/analyze`: `min` over integer-declared `peak_viewers` infers `float`. The parity test now iterates over `integer` and `float` declared fields. Red-first claim checked against the old code: the old `aggResultType` returned the declared type, so `fn=min declared=integer` would infer `integer`. `red-backend.txt` matches this.
- Item 4 (chip keys): index-qualified keys in all four categories (C2 satisfied). Verified live: two empty-alias aggregations render two `+ ` chips with no duplicate-key console error.
- Standing constraints: C1 satisfied (the test asserts `input.labels[0].tagName === "LABEL"` and that there is no `aria-label`; the accessible name keeps `(row N)`; `useId` is called once and suffixed per row). C2 satisfied.
- Spec deltas match the base requirement headers. `openspec validate --strict` passes. No other spec claims that aggregate min/max keep the declared type. No scope creep. tasks.md is all checked and matches the diff.
- `red-frontend.txt` / `red-backend.txt` in the change dir: acceptable. The archive has precedent (261 tracked `.txt` evidence files under `openspec/changes/archive/`), and `npm run check:openspec` is clean. See the non-blocking note on size.

### Phase 2: Code Review — PASS
Gates, fresh runs in WORKTREE_PATH:
- `npm run lint`: clean. `npm run format:check`: clean. `npm run typecheck`: clean.
- `npm test`: the first full run had 2 failures in `PipelineDetailPage.test.tsx` ("a reorder's debounced analyze is skipped while a run is in flight"), a file this diff does not touch. That run happened while `sbt testFull` was loading the machine. An immediate re-run passed: 482/482 suites, 5072/5072 tests. Recorded as load-sensitive flakiness, not attributable to this diff.
- `npm --prefix frontend run build`: OK.
- `cd backend && sbt testFull` (nice 19): 6425 succeeded, 0 failed, 4 canceled (the opt-in `HELIO_MEASURE` measurement specs). Both new HEL-1407 specs ran and passed.

Code: DRY (reuses `FormField`, shared `.ui-input[aria-invalid]` styling); naming is clear; no `any`; no dead imports (`InlineError` is still used for the alias error at `:254`). The comment in `aggregateResultType` explains why the aggregate op diverges from groupby. No mechanical CONTRIBUTING/DESIGN violations (no new CSS, no literals).

### Phase 3: UI Review — FAIL
Servers: `start-servers.sh` reused healthy servers. I checked they serve this worktree rather than trusting the reuse: the listening PIDs' cwd is this worktree's `frontend/`/`backend/`, Vite serves the new `fnKey` source, and the analyze response shows the new `float` typing.

Happy path, error path, recovery, keyboard/label association, and console are all clean. The only console error is a pre-existing 404 on `/schedule` for a pipeline with no schedule. Light and dark both render tokens correctly (error colour, invalid border, muted label). No horizontal overflow at 1440 / 1100 / 768 / 375.

Issue (objective, measured): the p field shifts layout when its error appears. On base, the p `TextField` was a direct child of the wrapping flex row and, like every sibling control, stretched to the full row width (`.ui-input { width: 100% }`, `inputs.css:10`). The new `FormField` wrapper is an unsized flex item, so it shrink-wraps to its content:
- valid: the p input is 228px wide, while every sibling input/select in the same row is 766px (694px at 768).
- error shown: the input grows to 278px (sized by the error text), then drops back to 228px once the value is valid. The control visibly changes width on each validation toggle.
- at 1440/1100 the field sits beside the hint, and the hint is vertically centred on the 55px label+input block instead of on the input. At 768/375 it drops to its own line, still at 278px.

design.md D2 required that the FormField "must not break alignment (adjust with existing tokens in the pipeline CSS only if needed)". The width jump on error toggle is a layout shift, and the p field is the only control in the row that does not follow the row's full-width layout. Measurements and screenshots, persisted:
- `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/e2e-evidence/HEL-1407/eval-p-field-measurements.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/e2e-evidence/HEL-1407/eval-agg-dark-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/e2e-evidence/HEL-1407/eval-agg-dark-1440-error.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/e2e-evidence/HEL-1407/eval-agg-light-1440-error.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/e2e-evidence/HEL-1407/eval-agg-light-768-error.png`

All of these claims rest on `getBoundingClientRect()` widths, not on file ordering or mtimes.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/ui/stepConfigs/AggregateConfig.tsx:268` (the `<FormField ...>` for p): give the wrapper a feature class (FormField already accepts `className`), e.g. `className="pipeline-detail-page__aggregate-p-field"`. Add a rule next to `.pipeline-detail-page__aggregate-fn-hint` in `frontend/src/features/pipelines/ui/PipelineDetailPage.css` (~`:1606`) so the field takes the full row width like its sibling controls: `flex: 1 1 100%` (or `width: 100%`). This stops the input width from tracking the error text. Then re-verify in the running app, both themes, valid and error states. The p input's width must be identical with and without the error, and must match the alias input's width in the same row. Measure it; do not judge from a screenshot. If you choose a different layout, the input width must still be stable across the error toggle.

### Non-blocking Suggestions
- `AggregateConfig.test.tsx` "gives each percentile row its own label and error ids" only asserts that the two input ids differ. Consider also asserting that each input's `labels[0].textContent` carries its own row number, and that the error ids differ when both rows are invalid. Otherwise the test name promises more than it checks.
- `red-backend.txt` is 113 KB / 1424 lines of raw sbt output, with ANSI escapes (72 lines) and 33 absolute `/home/...` paths. Consider trimming it to the failing-test lines plus the summary before archive, since it will live in `openspec/changes/archive/` permanently.
- The executor's handoff records an earlier aborted run's pipeline `b29b8678-db6e-4cc5-b798-277f225eada3` with its user/source "unrecorded". Recover the exact ids before the residue is cleaned up.
- Evaluator dev-DB residue (throwaway user, never matt@helio.dev): user `cbb27962-bff1-4cf0-b3fb-a2f19ac54a34` (`hel1407-eval-1791538122797@example.test`), persona-template source `b23c918c-ba93-4479-bbea-405de71f6cbd`, pipeline `5819bbb3-9d14-413e-a716-586baae703c3` (plus an aggregate step `48e91cac-b843-45bd-a90e-0ac10dbb1ee9` I inserted, and two unsaved/auto-saved empty-alias rows), dashboard `bc049a3b-bfb5-4a06-83b6-67fd5266168e`.
- The Playwright MCP server writes its automatic `.playwright-mcp/` snapshot/console logs relative to its own workspace root: `/home/matt/Development/helio/.playwright-mcp/` (main checkout, gitignored). I cannot redirect those. All evaluator screenshots were written explicitly into this worktree's `e2e-evidence/HEL-1407/`.
