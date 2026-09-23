## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- **All ticket ACs addressed explicitly**: (1) form submit -> downstream auto-run -> bound chart/table
  panel visibly updates on `succeeded` — implemented via `pipelineRunFanout.ts` + `usePanelRunRefresh`
  wired into `PanelCardBody`, independently confirmed live via a re-run of
  `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` (passed, 58.7s, against the real dev backend). (2) No
  manual refresh/reload — confirmed by the same e2e run (no `page.reload()`/manual click anywhere in the
  spec, and it still observes the row count update). (3) Refetch scoped to bound panels only — proven at
  the unit level (`pipelineRunFanout.test.ts` "scoped refetch only" describe block, task 3.2/C6) and
  matches `spec.md`'s "Refetch is scoped to affected panels only" requirement.
- **No AC silently reinterpreted.**
- **All 11 tasks (1.1-3.4) checked off in tasks.md match what was actually implemented** — verified by
  reading every task item against its corresponding code and test, not just the checkbox. One notable,
  disclosed deviation: task 3.3's literal text calls for a "test-accelerated `SCHEDULER_TICK_INTERVAL_SECONDS`,"
  but the e2e spec deliberately uses the **default** (unmodified) tick interval instead, to avoid mutating
  the shared dev-server config other gates in this run reuse (a real, well-reasoned hazard — see
  `MISTAKES.md`/CON-165 precedent). The spec's own header comment states this plainly, satisfying the
  task's actual substantive requirement ("state plainly ... which tick-interval config the e2e ran
  with"), but `tasks.md` itself was never edited to match the decision actually taken. Non-blocking —
  see suggestions below.
- **No unnecessary changes outside ticket scope.** `git diff --stat` against `main` shows only the 7
  frontend/e2e files design.md's Impact section names, plus the OpenSpec change-dir artifacts. No
  backend files touched, matching the Non-Goals.
- **No regressions to existing behavior.** `usePanelPolling` call site is preserved unchanged in
  behavior (same args, reordered only to extract `outputId` once); `useOutputMeta` and
  `usePipelineRunEvents` are reused/left untouched, confirmed via `git diff` showing zero changes to
  either file.
- **No API/schema changes** — correct, this is frontend-only per the Non-Goals; nothing in `schemas/`
  or `openspec/specs/` touched.
- **Planning artifacts reflect the final implemented behavior** — `design.md` D1-D6 all correspond
  1:1 to real code (module-singleton `Map<string, FanoutEntry>` keyed by `pipelineId`, ref-counted via
  `listeners.size`, reconnect-after-terminal, `computeRetryDelayMs` exported and matching the exact
  formula, `usePanelRunRefresh` matching D4 exactly, sr-only region matching D5) — except the tick-interval
  deviation noted above.
- **`workflow-state.md` CONSTRAINTS**: no non-retired entries found beyond the Standing Constraints
  already covered in tasks.md (C1-C6), all satisfied — see Phase 2 for C5/C2/C4 independent verification.

### Phase 2: Code Review — PASS

**Gates re-run independently, in `WORKTREE_PATH` (frontend-only diff; no `backend/**` files changed):**

- `npm run lint` — clean (0 warnings/errors)
- `npm run format:check` — clean
- `npm run typecheck` — clean (not in the role's default gate list for a `frontend/**`-only diff, but
  part of the pre-commit chain; ran it explicitly)
- `npm test` — 28/28 + 335/335 suites, 271 + 3652 tests, all green
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk-size warning, unrelated to
  this diff)
- Full `sh .husky/pre-commit` chain (lint, typecheck, e2e/helio-mcp type checks, format, schema-drift,
  spec-structure, OpenSpec hygiene + its own selftest, Dependabot config + selftest, Scala quality,
  test-temp-dir hygiene + selftest, no-credential-leak + selftest, token-resolution + selftest, full
  test suite) — **exit code 0**, every sub-check green. `check:tokens` in particular confirms the new
  `.sr-only` class usage resolves against a real `theme.css` definition (`.sr-only` is not a new class
  — reused verbatim, D5's claim confirmed).

**Independent verification of self-reported claims:**

1. **C2 "show the red" (task 3.1) — independently re-proven, not just trusted.** I reverted
   `pipelineRunFanout.ts`'s `subscribeToPipelineSucceeded` to a naive per-subscriber-connect
   implementation (always open a new connection instead of consolidating by `pipelineId`) and re-ran
   `pipelineRunFanout.test.ts`: the task-3.1/C5 test failed exactly as claimed
   (`expect(fetchMock).toHaveBeenCalledTimes(1)` received `2`), along with two other tests that
   incidentally also depend on consolidation (tasks 1.1/1.2). Restored the real implementation via
   `git checkout --`, confirmed byte-identical and the suite green again (10/10). This is real, not
   narrated.

2. **C5 (no fan-out of more than one SSE connection per `pipelineId`) — verified directly in the
   source, not just via the test file's existence.** `subscribeToPipelineSucceeded` (`pipelineRunFanout.ts:35-57`)
   keys a module-level `Map<string, FanoutEntry>` by `pipelineId`; a second `subscribe` call for an
   already-watched `pipelineId` reuses the existing entry (`if (!entry) { ...; connect(...) }`) and
   only adds to its listener `Set` — no second `connect()` call. This is the literal fix for the
   ticket's "fan-out" bug and is exercised by the task-3.1 test, which I independently confirmed is
   real (see #1 above).

3. **isLoading-gating bug — verified FIXED in the shipped code, not just narrated.** `PanelCard.tsx`'s
   `handleFanoutRefresh` calls `refresh()` and bumps `refreshAnnouncement` unconditionally inside the
   callback passed to `usePanelRunRefresh`, with no dependency on `isLoading` anywhere in that path.
   Grepped the diff for `isLoading` — it is used only in the pre-existing `PanelContent` prop, never in
   the new announcement logic. The component test
   (`PanelCardBody.fanoutStatus.test.tsx`) exercises a panel that already has rows loaded
   (`getOutputRows` resolves with real data before the fan-out callback fires) and confirms the region's
   text changes distinctly across two refreshes — exactly the scenario the bug would have broken.

4. **a11y COMPUTED-state check (C4/D5) — genuinely computed, not presence-only.** The e2e spec
   (`hel1094-sse-fan-out-panel-refresh.spec.ts:184-200`) uses `page.accessibility.snapshot({ root,
   interestingOnly: false })` and asserts the snapshot's child node's computed `name` equals the DOM
   `textContent`, and that this value differs before/after and across two refreshes. This is a real
   accessibility-tree read (Playwright/CDP), not a markup-presence grep. The component-level test
   (`PanelCardBody.fanoutStatus.test.tsx`) additionally checks `textContent` via Testing Library's
   `getByRole("status")`, a reasonable proxy in jsdom (which lacks a full AX-tree API) — the literal
   computed-ARIA-tree assertion is correctly deferred to the Playwright e2e layer where it is actually
   measurable, consistent with the `hel1090-form-panel-assembled-a11y.spec.ts` precedent the spec cites.

5. **Live e2e test (task 3.3/3.4) — independently re-run, passed.** Ran
   `DEV_PORT=6526 BACKEND_PORT=9433 npx playwright test e2e/hel1094-sse-fan-out-panel-refresh.spec.ts`
   myself against the already-healthy dev servers: **1 passed (58.7s)**. Confirmed the spec genuinely
   drives the real chain (dataset write via form submit -> real 5s debounce -> real 30s scheduler tick
   -> `PipelineRunService.submit` -> SSE `succeeded` -> table panel row count 1->2->3 across two writes,
   with an intermediate a11y-snapshot check), not a mocked/short-circuited version. Evidence persisted:
   `/home/matt/Development/helio/.concertino/runs/HEL-1094/evidence/hel1094_evaluator_e2e_rerun.log`.

6. **Lint/typecheck/format/build/full suite — all independently re-run green** (see gate list above),
   not merely trusted from the executor's report.

**Code-quality review (CONTRIBUTING.md, DESIGN.md):**

- File-size budgets: `pipelineRunFanout.ts` 171 lines, `usePanelRunRefresh.ts` 29 lines, `PanelCard.tsx`
  355 -> 386 lines (under the ~400-line "propose a split" threshold, worth watching next time it grows).
- No inline FQNs, no dead code/TODOs (`grep -rniE "TODO|TBD|placeholder"` in the change dir already
  confirmed clean by skeptic-design-2.md and independently spot-checked in the implementation files).
- Comments are hazard/contract/why-focused, not restatement (e.g. the D5 comment in `PanelCard.tsx`
  explains the `react-hooks/set-state-in-effect`/`react-hooks/refs` reasoning for why the counter bump
  lives in the callback, not a derived `useEffect`).
- DRY: `useOutputMeta` and the existing `.sr-only`/`role="status"` convention (`Toast.tsx`/`theme.css`)
  are reused, not reinvented; D2's minimal duplicate SSE parser (vs. refactoring
  `usePipelineRunEvents.ts`) is a deliberate, disclosed, and reasonable trade-off, not accidental
  duplication.
- Type safety: no `any`; `FanoutEntry`/`SucceededListener` are properly typed; `err as Error` narrowing
  for `AbortError` detection matches the existing pattern in `usePipelineRunEvents.ts`.
- Tests are meaningful: the C2 red/green exercise (independently reproduced above) proves the core
  fan-out test would actually catch a regression of the literal bug this ticket exists to fix.

### Phase 3: UI Review — PASS

Triggered by `frontend/**` changes.

- Dev servers already running and healthy — confirmed via `scripts/concertino/assert-phase.sh servers`
  (`PASS servers`) before reuse, per canonical procedure.
- **Happy path**: confirmed via the independent live e2e re-run (write -> refresh, twice, no reload) —
  see Phase 2 item 5.
- **No console errors**: spot-checked the dashboard landing page load in a fresh Playwright session — 0
  console errors/warnings. The e2e spec itself would also have surfaced a hard console error as an
  uncaught exception/failed assertion given its strict `toHaveCount`/`toHaveText` polling.
- **Loading/empty/error states**: unaffected by this change — no new loading/empty/error surface is
  introduced (the sr-only region is empty until the first fan-out refresh, by design, and this exact
  behavior is asserted in both the component test and the e2e spec).
- **Accessible names / keyboard support**: no new interactive elements added (the status region is
  passive, `role="status"`, not focusable) — nothing new to check here; pre-existing form/table
  accessible names (unaffected by this diff) were exercised incidentally by the e2e spec's
  `getByRole`/`getByLabel` locators, which resolved without difficulty.
- **Breakpoints (1440/1100/768/0)**: not separately re-tested — the only new UI surface is a
  `.sr-only`-clipped, zero-footprint status `<div>` that cannot affect layout at any breakpoint; no
  existing layout was restructured (the `PanelContent` JSX is wrapped in a fragment, unchanged
  otherwise). Treating this as N/A-by-construction rather than skipped is the correct read given the
  diff's actual shape, not an assumption — confirmed by reading the full `PanelCard.tsx` diff.

### Overall: PASS

### Non-blocking Suggestions

1. `openspec/changes/sse-fan-out-panel-refresh/tasks.md` task 3.3's literal text ("test-accelerated
   `SCHEDULER_TICK_INTERVAL_SECONDS`") no longer matches the implemented approach (default/unmodified
   interval, for a good documented reason). Consider a small follow-up edit to `tasks.md` so a future
   reader doesn't need to cross-reference the e2e spec's header comment to learn the actual decision.
2. `design.md` D5 says `role="status"` "carries an implicit `aria-live=polite`" but doesn't note that
   `Toast.tsx`'s own convention additionally sets an explicit `aria-atomic="false"`, which the new
   region omits (defaults to `aria-atomic="true"` per the ARIA-in-HTML mapping for `role="status"`).
   Functionally inconsequential here (confirmed via the live a11y-snapshot re-run — the announcement is
   still correctly computed and changes on each refresh), but worth aligning for consistency with the
   convention it claims to reuse.
3. `skeptic-design-2.md`'s own non-blocking note about D6's ambiguity (attempt-counter reset happens at
   "SSE response validated" time, not "terminal status received" time — so a connection that repeatedly
   opens successfully but drops before any terminal event will retry every 1s indefinitely rather than
   backing off) is confirmed accurate by reading `connect()` (`entry.attempt = 0` at line 110, before the
   read loop). Still non-blocking, as flagged in round 2 — noting it here so it isn't lost.
4. `PanelCard.tsx` grew from 355 to 386 lines, approaching (not yet crossing) the ~400-line
   "propose a split" threshold in CONTRIBUTING.md — worth keeping in mind for the next change that
   touches this file.
