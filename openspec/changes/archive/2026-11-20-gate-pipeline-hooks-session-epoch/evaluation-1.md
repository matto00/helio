## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `cad8f1a6b5a10ba0adae1b8cbc7ba082d337d287` against the live-resolved base `98b8c40e9ffd99491482a28b609cbe556f293a45`
(two commits: red `b017acee6`, fix `cad8f1a6b`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (a test per hook, red on current code), for all eight hooks: met. I checked it myself (see Phase 2). There are 17 tests in
  8 `*.sessionEpoch.test.tsx` files. The red commit `b017acee6` changes no source file: `git diff --stat 98b8c40e9 b017acee6`
  touches only tests, the test kit and openspec. The test files are byte-unchanged from the red commit to HEAD. So running
  the tests at `b017acee6` runs them against the pre-fix hook code.
- AC2 (HEL-1634 guard and e2e still pass): met. The guard passes (8 tests, down from 9 at base, which is exactly the one removed
  duplicate). `e2e/hel1634-logout-user-switch.spec.ts` passes in full.
- AC3 (tidy):
  - The removed test was a verbatim duplicate at base `sessionResetGuard.test.ts:173-182` / `184-193`.
  - The cast comment is at `recentVisitsListeners.ts:75`.
  - The allowlist is split into `sessionStorageAllowlist.ts` (107 lines) and `sessionModuleStateAllowlist.ts` (444 lines).
- Scope: the eight hooks per owner ruling `fold-in-all-8`. `usePipelineDraftUndo.ts` is untouched, and no CI or shard files
  changed (C10).
- Constraints C1–C10 are honoured in the diff. C6 holds: the red run was committed before the fix (`b017acee6` precedes
  `cad8f1a6b`).
- Enumeration: I re-grepped every `await`/`.then(`/`unwrap()` in the eight hooks. Each one is either gated or correctly SAFE:
  - `syncStepsFromServer` and `handleToggleStepEnabled` only set local state.
  - `reorderPipelineSteps` only sets local state.
  - `update`/`remove` in `useOutputImmediateActions` have nothing after the await.
  - `handleSave` makes no request carrying an id.
  - No in-scope site is missing.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates, all run fresh in WORKTREE_PATH:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test` (`HELIO_JEST_MAX_WORKERS=3`, lane DB env exported): exit 0
  - root: 71 suites / 621 tests
  - frontend: 902 suites / 10479 tests
- `npm --prefix frontend run build`: exit 0

No `backend/**` changes, so no sbt run.

Red check (independent). I ran all 8 files at `b017acee6` in a throwaway detached worktree and got 17/17 failed. Every failure
is an assertion of the form `expect(<follow-on service/dispatch/callback mock>).not.toHaveBeenCalled()`, "Received number of
calls: N", i.e. the post-sign-out follow-on actually ran. None was a crash, timeout or import error. The run/dry-run tests also
tripped the network guard: `POST /api/pipelines/pipe-A/preview?outputId=out-1`, which is exactly A's id going out.
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/red-eval.txt`.
All 17 pass at HEAD.

Mutation check (independent, stronger than the executor's one-per-hook evidence). I removed each of the 18 new epoch checks
individually. Every one turned exactly the test for that site red: 18/18 killed, 0 survived. This includes the four
`usePipelineDraftSave` checks (pending / settle / catch / reload), the three `usePipelinePageLoad` checks (steps / Outputs /
retry), and the three `usePipelineStepStructure` checks (after `createPipelineStep`, after resync, after `createOutput`).
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/mutation-eval.txt`.
The executor's own `mutation-runs/*.txt` agree, one site per hook.

Allowlist split:
- `cat sessionStorageAllowlist.ts sessionModuleStateAllowlist.ts` diffed against base `sessionStateAllowlist.ts` differs only
  in the new 5-line header doc comment of the module-state file, which replaces one blank line. Every entry and type is
  byte-identical.
- There are no other importers of the old path (repo-wide grep finds no hits).
- The guard's `walk()` scans both new files exactly as it scanned the old one: both are non-test `.ts` files under `src/`.
- Behaviour probe: I added a scratch file with an unlisted `localStorage` key and an unfrozen exported `let`. The guard failed
  on both: "every browser storage key is in a keep list" and "every module-level mutable identifier is registered or
  allowlisted". So the guard still bites after the split.

Code-quality notes:
- D2 is implemented as designed. In `usePipelineStepStructure.ts`, the checks after `createPipelineStep` and after the resync
  sit before the `try`, so the `deletePipelineStep` rollback (a request carrying A's step id) cannot run under B's session.
- D3: the thrown `Error("Signed out before the Output was created.")` is caught by `OutputEditorSheet.tsx` as a failed save, as
  `post-await-sites.md` states.
- `finally` blocks still run (`draftSaveInFlightRef`, `setSaving`).
- Imports are relative, with no inline FQNs, no new `any`, no dead code and no TODOs.
- The checks are minimal one-liners, so there is no over-engineering.
- Within a single session the gates are no-ops (epoch unchanged), so behaviour there is preserved. The full jest suite and e2e
  confirm this.

### Phase 3: UI Review — PASS
Issues: none.

Servers were started with `start-servers.sh` and `assert-phase.sh servers` passed. The setup was:
- `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1798`, `DB_USER=matt`, `ANTHROPIC_API_KEY` exported empty.
- `pg_stat_activity` showed connections only to `helio_hel1798`.

E2E (task 5.2, which the executor had not run). Ten full spec files, Playwright with 2 workers, all passed:
1. `e2e/hel1634-logout-user-switch.spec.ts`: sign-out / user switch, the HEL-1634 guard e2e.
2. `e2e/hel1631-draft-mode.spec.ts`: draft save, step duplicate/remove, add/remove source, retry. Exercises `usePipelineDraftSave`, `usePipelineRootAndToggleActions`, `usePipelineStepMutations`, `usePipelinePageLoad`.
3. `e2e/hel1734-draft-roots.spec.ts`: roots, plus phone light/dark.
4. `e2e/hel910-pipeline-to-dashboard-flow.spec.ts`: page load, Output create, run.
5. `e2e/hel968-multi-root-editor-flow.spec.ts`: add/remove root.
6. `e2e/hel1632-live-output.spec.ts`: Output create and preview (`useOutputImmediateActions`).
7. `e2e/hel1733-draft-outputs-shapes-desktop.spec.ts`: Output shapes, aggregate.
8. `e2e/hel1582-mobile-pipeline-motion-and-states.spec.ts`: dry run, phone breakpoint states.
9. `e2e/hel1774-modal-scroll-pipeline-dialogs.spec.ts`: run-history dialog (`useRunHistory`).
10. `e2e/hel1705-live-output-refresh.spec.ts`: run and Output preview refresh (`usePipelineRunAndSaveActions`).

Results: 24 + 33 + 12 = 69 passed, 0 failed, 0 flaky, so no rerun was needed. The specs' own cleanup deleted their throwaway
users. The `users` count in `helio_hel1798` is 1 both before and after, so there is no residue. No root-level screenshots were
written, and `git status` is clean.

Logs:
- `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/e2e-1.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/e2e-2.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/e2e-3.txt`

The change has no visual surface. It adds no markup, styles or tokens, so DESIGN.md's mechanical rules do not apply. The
breakpoint coverage above comes from the phone and desktop projects inside those specs.

Servers were stopped with `stop-servers.sh` (`STOPPED ports=7230,10137`). Frontend node PID 3250080 and backend java PID
3249846 are both confirmed gone, and nothing is listening on either port. The throwaway verification worktree was removed with
`git worktree remove --force`.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `post-await-sites.md`, "Out of scope" row for `usePipelinePreviewCache.ts:27, 41`. The disposition "follow-up candidate" is
  not correct, and it should be SAFE:
  - Both `refresh` callbacks dispatch `previewOutput`/`previewUnsavedOutputStep` before their single `await`, and nothing
    follows that await.
  - Their only caller (`ui/outputEditor/useOutputSheetNode.ts:67-72`) runs `refresh` from a 400 ms `setTimeout`, which is
    cleared on unmount, and sign-out unmounts the page.
  - So no request carrying A's ids is started after the session changes.
  - Recommend correcting the row to SAFE (dispatch-before-await, debounced timer cleared on unmount) before Delivery triage, so
    that no non-defect follow-up ticket gets filed. The other three follow-up candidates (`usePipelineDraftCreate.ts:70`,
    `usePipelineShapeInstantiation.ts:83-103`, `usePipelineRunStream.ts:75`) are reasonable follow-up candidates.
- `usePipelineRunAndSaveActions.handleSave` still calls `navigate("/pipelines")` after an `updatePipeline` that resolves after
  sign-out. It carries no id and no request, so it is outside the AC. A late navigation is still a possible (harmless) UX
  oddity if it can fire after the page has unmounted, and it is worth a line in the same follow-up triage.
- D4 mentions asserting "the reset slice holds no entry for A's pipeline". The tests assert only on the absence of follow-on
  service, dispatch and callback calls, which is the stronger and sufficient check here. Consider trimming that sentence from
  design.md so the artifact matches the tests.
