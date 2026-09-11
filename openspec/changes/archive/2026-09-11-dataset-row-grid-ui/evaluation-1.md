## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `ae7a56e15db5352afd12305ec86307d9ef558581`
Diff base: `50993f491f5efbe1875cf06451e08ac44be6c1a9` (resolve-review-base.sh, live-resolved)

### Phase 1: Spec Review — FAIL

- Ticket ACs for HEL-1080 and HEL-1122 are largely addressed in the design/architecture (schema
  route, Redux slice, DataGrid extension, conflict recovery, validation parsing). No scope creep
  observed; planning artifacts (proposal/design/tasks) reflect the implemented shape reasonably
  well.
- **`ConnectorsPage` correction verified accurate.** `git grep -ln "import { DataGrid"` under
  `frontend/src` returns exactly 4 files (`TableRenderer.tsx`, `StepCard.tsx`,
  `SourceDetailPanel.tsx`, `SqlTab.tsx`); `ConnectorsPage.tsx`'s own header comment states it
  deliberately uses `SortableTable`, not `DataGrid`. The executor's revision of standing
  constraint C1's enumerated consumer list (5 → 4 real consumers) is correct and is documented
  in `DataGridConsumerRegression.test.tsx` rather than silently reproducing the stale premise.
  This does not violate C1's intent (protect real consumers from regression) since all 4 real
  consumers are covered.
- **Task-completion claims do not match the checklist.** `tasks.md` still shows 5.3, 5.5, 5.6,
  5.6a, 5.7 unchecked, and the executor's own `files-modified.md` explicitly lists these as "Known
  gaps (not completed this cycle)". These are not incidental polish items — they are the ticket's
  own inline ACs:
  - AC "Keyboard-operable including cell navigation" and "a11y is an inline AC: full keyboard
    navigation per a recognized grid pattern, conforming visible focus (scanned by
    `e2e/focus-presence-guard.spec.ts`)" — task 5.3 (adding `/sources/:id` to the focus-guard
    spec) and 5.6/5.6a (the full keyboard-nav/emptying-matrix tests) are unimplemented.
  - AC "`DESIGN.md` token compliance AND visual cohesion against the running app in both themes"
    — task 5.5 (visual review) was not performed.
  - AC "Large datasets use the paged row-listing endpoint (HEL-1121); no naive full-dataset
    render — measured, not assumed" — task 5.7 (the 500-row/5-page measurement) was not written.
  A cycle-1 report that self-flags these gaps is honest, but the tasks are REQUIRED-level per
  tasks.md (not marked optional), so this is a Phase 1 FAIL, independent of the Phase 2 code
  defect found below.

### Phase 2: Code Review — FAIL

Gates (fresh run, this pass, in `WORKTREE_PATH`):
- `npm run lint` — pass (0 warnings)
- `npm run format:check` — pass
- `npm test` — pass (307 suites / 3244 tests)
- `npm run build` — pass
- `cd backend && sbt "testOnly com.helio.api.routes.sources.DataSourceRoutesSpec com.helio.infrastructure.persistence.RlsOwnerTablesSpec"` — pass (153/153)

Code findings:

1. **BLOCKING: `Tab`/`Shift+Tab`-exits-the-grid requirement (tasks.md 4.2a, design.md Decision 0)
   is not actually implemented, and is untested.** `DatasetRowGrid.tsx:229-232`'s `Tab` handler
   only calls `commitEdit(...)` — it never calls `e.preventDefault()` and never programmatically
   `.focus()`s the resolved next/previous focusable element, which design.md's own Decision 0
   explicitly calls out as required ("fixing a gap in the round-3 draft... rather than letting the
   browser's default Tab traversal run from inside the editor"). Because `DataGrid.tsx:1199` keeps
   `tabIndex={0}` on the active cell's enclosing `<td>` unconditionally (it has no concept of
   "editing" — confirmed by reading the full component, no edit-mode state exists in
   `DataGrid.tsx`), the browser's native tab-order for `Shift+Tab` from inside the editor `<input>`
   resolves to the ANCESTOR `<td>` (same cell), not out of the grid — exactly the bug design.md
   describes and rules must not happen. `DatasetRowGrid.test.tsx` has no test exercising this at
   all (`grep -n "Tab\|shiftKey\|focus"` finds only a comment, no assertion), so nothing in the
   test suite would have caught it. This is a real, load-bearing a11y defect against an explicit,
   skeptic-refined design decision — not a nice-to-have.
2. Minor: the cell-error `<span>` (`DatasetRowGrid.tsx:276`) sets both `role="alert"` and
   `aria-live="assertive"` — redundant (an element with `role="alert"` is already an implicit
   `aria-live="assertive"` region); harmless but worth tidying.

No DRY/readability/type-safety/security issues found elsewhere in the diff. `CONTRIBUTING.md`
import/qualifier conventions and `DESIGN.md` token usage (spot-checked in `DatasetRowGrid.css`)
look compliant.

### Phase 3: UI Review — BLOCKER (environmental) for the live-browser portion; static review FAIL

Dev servers started successfully (`start-servers.sh` / `assert-phase.sh servers` both green,
frontend `:6512`, backend `:9419`). However, the Playwright MCP browser session was already in
use by a concurrent process for the entire review window (`Error: Browser is already in use for
.../mcp-chrome-30e282e, use --isolated to run multiple instances`), confirmed on repeated retries
over ~20s — this is the known shared-Playwright-session hazard across parallel worktree runs
(`project_concertino_parallel_playwright_hazard`). I could not drive the live browser to perform
5.5's visual review or exercise 5.6/5.6a/5.7's live keyboard/measurement flows myself. This
specific inability is environmental, but it does not change the verdict: those same checks are
independently confirmed **not implemented** by the executor's own admission (Phase 1 above), so
there is no pending live-verification result this would have flipped to PASS — the Phase 3
requirement stands FAIL on unimplemented-task grounds regardless of browser availability. Noting
the tooling conflict for the record rather than silently treating Phase 3 as N/A.

### Overall: FAIL

### Change Requests

1. Implement the `Tab`/`Shift+Tab`-while-editing focus-forwarding behavior tasks.md 4.2a
   requires: on `Tab`/`Shift+Tab` inside the active editor, `preventDefault()`, commit the edit,
   then programmatically compute and `.focus()` the correct next/previous focusable element
   outside the grid (matching design.md Decision 0's exact prescription) — do not rely on the
   browser's default tab traversal from inside the editor, since the enclosing `<td>` still holds
   `tabIndex=0` during edit mode. Add a test asserting `Shift+Tab` from inside the editor lands
   focus outside the grid (not back on the same cell), matching tasks.md 5.6.
2. Complete task 5.3: add `/sources/:id` (seeded with a dataset source) to
   `e2e/focus-presence-guard.spec.ts`'s `routes`/`ROUTE_READY_MARKERS`, and run it — report the
   known HEL-1119 duplicate-label flake separately if it's the only red.
3. Complete task 5.6/5.6a: the full keyboard-navigation test matrix (100-row arrow-nav soak,
   boundary clamping, the Tab/Shift+Tab-from-editor test from CR1, blur-commit test,
   Delete/Backspace-blocked-while-editing test) and the required-field-emptying matrix across
   every editable field type (not just `string`).
4. Complete task 5.7: the 500-row/5-page large-dataset measurement (explicit `limit=100` +
   `cursor` assertions, mounted DOM row count `<= 100` and non-growing across all 5 pages).
5. Complete task 5.5: visual review against the running app in both light and dark themes, next
   to the sources list/detail surfaces, with screenshots persisted to the run evidence dir (not
   the repo root) via `persist-evidence.sh`.

### Non-blocking Suggestions

- `DatasetRowGrid.tsx:276`: drop the redundant `aria-live="assertive"` alongside `role="alert"`.
