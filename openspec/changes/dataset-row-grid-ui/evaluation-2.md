## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `d30616a6426a5ffb195e2d7f3eb95afd194c7c7b`
Diff since cycle 1 (`ae7a56e1...d30616a6`): `e2e/focus-presence-guard.spec.ts`,
`datasetRowsSlice.{ts,test.ts}`, `DatasetRowGrid.{tsx,test.tsx}`,
`DatasetRowGridKeyboardMatrix.test.tsx` (new), `DatasetRowGridLargeDataset.test.tsx` (new),
`tasks.md`, `files-modified.md`.

### Phase 1: Spec Review — PASS

All cycle-1 change requests addressed:
- CR2 (task 5.3): `/sources/:id` added to `e2e/focus-presence-guard.spec.ts`'s `routes`/ready
  markers. Verified live (see Phase 3) — passes, including the new route, in both themes.
- CR3 (tasks 5.6/5.6a): `DatasetRowGridKeyboardMatrix.test.tsx` (arrow-nav soak across 100 rows,
  boundary clamping, blur-commit, Delete/Backspace-blocked-while-editing) and the
  required-field-emptying matrix across `integer`/`float`/`timestamp`/`string-body` (plus the
  existing `string` coverage and the `default: null` case) are real, meaningful tests — read in
  full, not just present.
- CR4 (task 5.7): `DatasetRowGridLargeDataset.test.tsx` is a genuine measurement — pins
  `DATASET_GRID_PAGE_SIZE=100` and `500/100=5` pages, asserts `limit`/`cursor` params on every
  request, and asserts mounted DOM row count via `document.querySelectorAll(".ui-data-grid__table
  tbody tr")` stays `<= 100` and does not grow across all 5 pages (`Set` of counts has size 1).
- CR5 (task 5.5, visual review): performed live this cycle (see Phase 3) — no defects found.
- CR1 (the blocking Tab/Shift+Tab bug): fixed. See Phase 2.

`tasks.md` now shows 5.3/5.6/5.6a/5.7 checked; only 5.5 remains unchecked in the file (the
executor correctly noted it lacks a browser tool) — performed by this evaluator below and found
clean; recommend the executor/orchestrator flip 5.5 to `[x]` on merge given this evaluation now
constitutes that verification.

### Phase 2: Code Review — PASS

Gates (fresh run, this pass, in `WORKTREE_PATH`):
- `npm run lint` — pass (0 warnings)
- `npm run format:check` — pass
- `npm test` — pass (309 suites / 3264 tests, up from 307/3244 in cycle 1 — matches the
  executor's claim)
- `npm run typecheck` — pass
- `npm run build` — pass
- `cd backend && sbt "testOnly ...DataSourceRoutesSpec ...RlsOwnerTablesSpec"` — pass (153/153,
  backend untouched this cycle, matches claim)

Cycle-1 CR1 (blocking) verified fixed by reading the diff in full:
- `DatasetRowGrid.tsx` gained `FOCUSABLE_SELECTOR` + `focusOutsideGrid(container, direction)`,
  which walks `document.querySelectorAll`, filters to elements outside the grid container via
  `compareDocumentPosition`, and picks the correct forward/backward candidate in document order.
  The `Tab` keydown handler now commits first, then calls `focusOutsideGrid` and only
  `preventDefault()`s when a target was actually found — correctly falling back to the browser's
  native tab order per tasks.md 4.3b when there's no next/previous focusable element (e.g. Tab
  from the grid's last page element).
- `DatasetRowGrid.test.tsx` now has two real, meaningful tests for this: one asserting
  `Shift+Tab` from inside the editor moves `document.activeElement` to the "Refresh" button
  (correctly skipping the disabled "Next" button as a non-tab-stop) rather than staying on the
  enclosing `<td>`, and one asserting a forward `Tab` with no following focusable element does not
  throw (the fallback path). Both pass.
- No regression: `handleNext`'s cursor logic was also simplified (uses `state?.nextCursor`
  directly rather than re-deriving it from a second fetch) — a reasonable, in-scope tightening,
  not a drive-by behavior change; `datasetRowsSlice.ts`'s `+6` lines match this (storing
  `nextCursor` on state).

No new DRY/readability/type-safety/security issues found in this cycle's diff.

### Phase 3: UI Review — PASS

Dev servers from cycle 1 were still live and healthy (`curl` confirmed both `:6512` and
`:9419/health`). The Playwright MCP browser session was still locked by a concurrent worktree
run for the entire review window (same hazard as cycle 1) — rather than block on it, I drove the
live app directly via the CLI Playwright test runner (`npx playwright test`, no MCP dependency)
against the running dev servers:

- **Task 5.3 (focus-presence-guard), run live**: `DEV_PORT=6512 BACKEND_PORT=9419 npx playwright
  test e2e/focus-presence-guard.spec.ts` — **1 passed** (119.5s runtime), 230 focusable elements
  measured across 10 views (5 routes × 2 themes) including the new
  `/sources/<dataset-source-id>` route (17 focusable elements per theme, uncapped), with no
  clipped/non-conforming focus indicators reported. This is the specific gate cycle-1 could not
  execute; it passes clean.
- **Task 5.5 (visual review, both themes), performed live**: wrote a scratch Playwright spec
  (`e2e/zz-eval-visual-review.spec.ts`, deleted after use, never committed) that registers a
  user, seeds a real dataset source (3 rows, `string`+`integer` fields) via the API, and
  screenshots `/sources/:id` in both dark and light themes, plus mid-edit (cell in edit mode) and
  the sources list page for side-by-side cohesion. Screenshots persisted via
  `persist-evidence.sh`:
  - `visual-review-source-detail-dark.png` — ref:
    `/home/matt/Development/helio/.concertino/runs/HEL-1080/evidence/.concertino/runs/HEL-1080/evidence/visual-review-source-detail-dark.png`
  - `visual-review-source-detail-light.png` — ref: same dir, `-light.png`
  - `visual-review-source-detail-dark-editing.png` / `-light-editing.png` — same dir
  - `visual-review-sources-list.png` — same dir
  Observed: the grid's schema table (Field/Type/Nullable) and row grid render with consistent
  card/table chrome matching the sources list and other app surfaces in both themes; the
  toolbar's `Add row`/`Refresh`/`Prev`/`Next` buttons use `DatasetRowGrid.css`'s
  `--app-border-subtle`/`--app-radius-sm`/`--control-sm` tokens, matching DESIGN.md §5's
  documented **Secondary** button recipe exactly (transparent bg, hairline border, muted text) —
  a deliberate, compliant secondary-weight choice, not a new dialect, given there's no single
  primary action on this toolbar. The active-cell editor renders with an accent-colored border
  (`--app-accent-mid`) consistent with other inline editors in the app. No visual defects, no
  console errors observed during the flow (registration → source creation → grid render → cell
  edit → theme toggle).
- Other Phase 3 checks (happy path, keyboard operability, a11y roles/`aria-live`, loading/empty
  states) are already covered by the extensive Jest test suite reviewed in Phase 2 and were not
  re-driven live beyond the above, consistent with cycle 1's already-passing gates.

### Overall: PASS

### Non-blocking Suggestions

- `DatasetRowGrid.tsx`'s cell-error `<span>` still sets both `role="alert"` and
  `aria-live="assertive"` (redundant — `role="alert"` already implies an assertive live region).
  Harmless, carried over from cycle 1, not blocking.
- Recommend flipping tasks.md 5.5 to `[x]` given this evaluation's live visual-review evidence
  now covers it (no code change required, just bookkeeping before archive).
