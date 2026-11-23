## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `1a3a14c4c5d79e4c723edd27cc11aaa1859848db`. The base was resolved live as `68829c1c677f31c38dd695cfb06ecff0690a6a7e`, and
the diff covers 3 commits: probe `839b9f253`, red `9a80886bc`, fix `1a3a14c4c`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- **AC1 (probe on a running backend, before/after JSON):** met. `probe-evidence.md` records the API probe using the modal's
  exact batch body and the real modal path (B title-only, C background-only, D two partial saves). Each one was read after the save and
  before the flush, then read again after it. The verdict is stated explicitly: the server merge keeps `chart`. The client lost
  `chart` before the flush, so the panel rendered `bar` instead of `pie`. The server permanently rounded transparency from 0.555 to 0.56.
- **AC2 (fix at the write seam, red first):** met. There are two fixes. In `panelsSlice.accumulatePanelUpdate`, the local item and the
  pending patch are merged instead of replaced. In `PanelDetailModal.handleEditSubmit`, the modal stages only the keys that changed,
  and transparency is compared on the seeded integer. The red run is committed in `red-jest-unit.txt` (8 failed of 47). I checked that the
  red commit `9a80886bc` leaves `panelsSlice.ts` and `PanelDetailModal.tsx` byte-identical to base, so the red run was made against
  unchanged code. That commit used `-n`, which its message discloses, and the fix commit `1a3a14c4c` follows it. All of today's gates are green (Phase 2).
- **No AC silently reinterpreted.** The server's merge semantics are unchanged, so no escalation was needed. Design decision 2b re-expresses the existing
  tests (sentinel, panelSwitch, aggregateChart, chartTypeDefault), and each carries an inline rationale. I checked that the panelSwitch
  invariant still holds. If the edit state kept A's `#111111` while `initialBackground` was B's `#222222`, the changed-only logic
  would stage it, `pending["b"]` would be defined, and the test would fail. The test can still detect a stale-state regression.
- **Spec delta:** the delta for `panel-detail-modal` matches the implemented behavior: it stages only changed keys, a no-op save stages nothing, and the
  chart, 0.555 transparency and two partial saves are preserved.
- **CONSTRAINT C1:** the browser probe and guard (`e2e/hel1615-panel-modal-appearance-save.spec.ts`) read Redux and the
  rendered ECharts series type before the flush and after it. They seed `pie` (distinct from the Output's `bar` and the `line`
  fallback) and transparency 0.555. C1 is honored where it can apply. The jest and backend specs cannot read a rendered chart, so I
  read C1 as binding on the browser probe and guard (see suggestions).
- **Task 1.2 wording overclaims.** It reads "Playwright through the real modal (... OutputControlsEditor/subtype saves)". The
  executor's evidence says honestly that the subtype saves were covered by code reading only. I closed this gap independently in Phase 3
  (see below): the result is benign. This is a non-blocking text fix.

### Phase 2: Code Review — PASS
Issues: none blocking.

I ran these gates myself in `WORKTREE_PATH`. Logs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1615/eval1-*.txt`.
- `npm run lint` exit 0; `npm run format:check` exit 0; `npm run typecheck` exit 0.
- `npm test` (3 workers, nice 19): root suite 71/71 suites and 621 tests passed; frontend 918/918 suites and 10589 tests passed.
- `npm --prefix frontend run build`: exit 0.
- `sbt -J-Xmx3g testFull`: **the full suite, run in 6 shards** (`HELIO_TEST_SHARD_INDEX=0..5`, `COUNT=6`), all "All tests passed".
  Totals: 797 + 1720 + 2228 + 1723 + 1987 + 1837 = 10292 succeeded, 0 failed. The executor ran only the targeted spec. The new
  HEL-1615 guard ran in shard 1 and passed.
- `npm run check:scala-quality`: clean (soft warnings only, none new from this change).
- Playwright `e2e/hel1615-panel-modal-appearance-save.spec.ts`: I re-ran it against the lane servers (DB `helio_hel1615`, 2 workers) and it
  **passed**. The live log shows that after a title-only save and before the flush, B keeps `chart.chartType "pie"` and transparency 0.555 in Redux, and the pending
  entry is `{title}` only. The rendered type before the flush is `pie`. Global teardown deleted its user.

Code review:
- **Correctness:** the reducer merges `fields.appearance` over the stored item and over the prior pending patch. The comment states plainly
  that the merge is shallow (no server `null` mirroring), which the design allowed. `clearSentPendingPanelUpdates` JSON equality
  still holds on the merged object, and a test covers it. In the modal, `initialBackground/Color/Transparency` are derived from the current
  `panel` prop, and transparency is compared on the seeded rounded integer, so an untouched 0.555 is never sent.
- **Type safety:** `PanelAppearancePatch = Partial<PanelAppearance>` is applied to `PanelUpdateFields` and `PanelBatchItem`. tsc is clean. The
  red-test cast `patch = (a) => a as PanelAppearance` remains in `panelsSlice.test.ts` (see suggestions).
- **Backend guard:** I did not run its named mutation, because the evaluator does not modify code. By construction it discriminates: it
  establishes `chart` and 0.555 through `batchUpdate`, then sends `{background}` only and asserts that chart, color and transparency survive. A
  replacing `applyPatchJson` (which ignores `existing`) would return `chart = None` and the default transparency, and fail it. The guard is
  labelled as a guard together with its mutation, as design Decision 5 requires.
- No dead code, TODO/FIXME, `any` or stray `console.log` in the frontend source changes. No over-engineering.
- CONTRIBUTING size budget: `panelsSlice.ts` was already 549 lines before this change and is now 567. `ApiRoutesSpec.scala` is now 3740 lines (+64). The soft rule
  says "propose a split in the PR description" (see suggestions).

### Phase 3: UI Review — PASS
Issues: none attributable to this change.

Servers were started with `start-servers.sh` (DB `helio_hel1615`, confirmed in the backend log; `ANTHROPIC_API_KEY` empty; ports 7047/9954) and
stopped with `stop-servers.sh`. Both ports are free afterwards and no PIDs are left. The shared Playwright MCP tab was on another lane's port (7056),
so I did not navigate it. I ran an independent scratch Playwright probe instead (headless, 1 worker). Its evidence log was persisted at
`/home/matt/Development/helio/.concertino/runs/HEL-1615/evidence/.concertino/scratch/HEL-1615/eval1-ui/eval1-ui-log.json`.

- **OutputControlsEditor save with a title change:** this was not exercised in the executor's runs. The controls save sent
  `PATCH /api/panels/:id {"config":{"controls":[...]}}`, which carries **no appearance**. The title went in its own `updateBatch` as
  `{"fields":["title"],"panels":[{"id","title"}]}`. After both, the server holds chart `pie`, transparency 0.555, `#112233` and `#aabbcc`, and the
  rendered type is `pie` both before and after.
- **Subtype (markdown content-only) save:** sent `PATCH {"config":{"content":"# changed"}}` only, and the pending entry is `null`. On the server,
  appearance is unchanged (pie, 0.555).
- **Keyboard:** focusing Save and pressing Enter on an unchanged form stages nothing (`pending null`). The Escape behaviour is unchanged:
  the first press leaves edit mode and the second closes the modal. The Edit and Save buttons have accessible names.
- **Breakpoints:** the modal markup and CSS are unchanged by this diff. At 1440 there was no horizontal overflow on the document or the dialog. At 1100, 768 and 375 the board renders
  without breakage and the stored `pie` chart is preserved. The per-panel actions button was not reachable by my selector at those
  widths: it is hover-revealed on desktop and the mobile layout differs. This is pre-existing navigation behaviour, not this change.
- **Console errors:** the only errors were `502 GET /api/pipelines/:id/run-events`, which the Vite dev proxy logs about once a minute for the long-lived SSE stream
  (`[vite] http proxy error ... run-events`). The diff does not touch it and it is unrelated to the modal. There were no page errors.
- **Test residue:** I deleted the 6 throwaway evaluator users by exact id with `buildUserDeleteSql` (0 remaining), and their board, pipeline and source rows are gone
  (0/0/0).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `tasks.md` 1.2: reword it, or add a line to `probe-evidence.md`, to say that OutputControlsEditor and subtype saves were confirmed by code reading in
  the executor's probe and by the evaluator's browser run in cycle 1. The checkbox should not imply a Playwright check the executor did not run.
- `panelsSlice.test.ts`: the cast `const patch = (a: Partial<PanelAppearance>) => a as PanelAppearance` existed only so the
  red run compiled against the old type. Now that `PanelUpdateFields.appearance` is `PanelAppearancePatch`, drop the cast.
- This is pre-existing and out of scope, so consider a spinoff. When one modal save both stages an appearance or title change and saves OutputControlsEditor controls,
  `updatePanelOutputControls.fulfilled` replaces the local item with the server copy. The staged title or background then reverts locally
  until the batch flush. The evaluator probe saw `item.title "EV out"` while pending was `{title:"EV out2"}`. It heals on flush.
- PR description: note the soft size budget for `panelsSlice.ts` (567 lines) and `ApiRoutesSpec.scala` (3740 lines) and propose a split, as
  CONTRIBUTING asks.
- C1 wording: if the constraint is meant for the browser probe and guard only, say so. Unit and backend specs cannot read a rendered chart type.
