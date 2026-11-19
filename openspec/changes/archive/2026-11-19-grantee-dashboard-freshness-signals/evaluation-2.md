## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `0b27956bb0381ce948c5bfbcf5dc7f6dfe54e678`. The only change since cycle 1 is commit 0b27956bb. My transcripts are in `.concertino/scratch/HEL-1786/eval2-*.txt`.

### Phase 1: Spec Review — PASS

**Cycle-1 CR1.** The executor took the alternative cycle 1 accepted. `expectedFactPrefix()` reads both pipelines' `lastRunAt`/`lastRunStatus` through the owner API, takes the latest, and maps it to `refreshed ` or `last run failed `. `expectFact()` polls until the grantee's text starts with that prefix. It is used for the desktop meta-row fact (`e2e/hel1786-shared-dashboard-freshness.spec.ts:321`) and the phone caption (`:366`).

The comment at `:230-233` now describes the auto-run race accurately. The "accepts either" note is gone from `files-modified.md`.

**Proof the alternative goes red.** I mutated the grantee-side code and ran the full e2e file on the live dev server (Vite hot reload), restoring the file with `git checkout` after each run:

| Mutation | Change in `frontend/src/features/panels/state/dashboardMeta.ts` (`deriveDashboardMetaFromStatus`) | File result | Which tests went red |
| --- | --- | --- | --- |
| Wrong latest-item pick | picks the EARLIEST `lastRunAt` | exit 1 | 2 of 3: viewer and phone. Received `"refreshed <> last run failed just now"` |
| Wrong intent mapping | succeeded→danger, failed→success | exit 1 | 1 of 3: editor. Received `"refreshed <> last run failed 3 seconds ago"` |

Both mutations turn the file red. In each run, though, some tests still passed under the mutation. The likely mechanism: the grantee's snapshot can lag the owner's live view by up to one 15 s poll. If the checked pipeline's auto-run flips which run is latest inside that window, a stale, inverted value can briefly equal the new truth. So each individual test catches these mutations only part of the time. The file as a whole caught both. This is recorded below as a non-blocking robustness note.

**Phone Refresh control.** The test now asserts exactly `before + 1` status reads after the click (`:367-373`). This addresses the cycle-1 suggestion.

### Phase 2: Code Review — PASS

- **`.get` removed.** `DashboardPanelStatusService.scala:54` now uses `collect { case op: OutputPanel => op.outputId.map(...) }.flatten`.
- **Gates (fresh):**
  - `npm run lint`: exit 0
  - `npm run format:check`: exit 0
  - `npm run typecheck`: exit 0
  - `DashboardPanelStatusRoutesSpec` + `ExistenceNotLeakedRoutesSpec`: 75 succeeded, 0 failed, project path is this worktree
- **Not re-run in this cycle:**
  - Full jest, because no `frontend/src` file changed since cycle 1, where I ran it green.
  - The frontend build, for the same reason.
  - Full `sbt testFull`, for the same reason as cycle 1: it takes more than the 600 s foreground limit. It stays an unverified claim from the executor.

### Phase 3: UI Review — PASS

- **Servers:** started on lane DB `helio_hel1786` with `ANTHROPIC_API_KEY` empty; `assert-phase.sh servers` PASS; stopped with `stop-servers.sh`.
- **New e2e file, unmutated:** 3 passed (40.8 s), covering viewer, editor and phone. The zero `/api/outputs/` and `/api/pipelines/` request rule, the no-4xx/5xx rule and the no-console-error rule all held.
- **Cycle-1 touched-selector runs:** not re-run (108 passed in cycle 1). The cycle-2 diff touches no selector and no `frontend/src` file.
- **Working tree:** clean after the mutations.

### Overall: PASS

### Non-blocking Suggestions
- **Make the freshness assertion robust per test, not just per file.** Two changes would help:
  - Drain the checked pipeline's pending auto-run in `beforeAll`: poll `pipeline_auto_run_debounce` for `checkedPipelineId` through `e2e/support/db.cjs` until it is empty, and wait until no run is in flight. With the latest run fixed, every test would reject an inverted fact.
  - Raise `expectFact`'s poll timeout from `15_000` to at least `PANEL_STATUS_POLL_MS` plus a margin (for example `30_000`). That removes a green-run flake risk when the latest run flips just before the assertion.
