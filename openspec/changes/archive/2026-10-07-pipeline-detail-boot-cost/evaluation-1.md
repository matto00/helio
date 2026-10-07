## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `45c1800c5ddf4cff617f6424b0047a4ce88adeb6` (commits 1a4c07dce product+tests, 45c1800c5 evidence).
Review base resolved live by `resolve-review-base.sh`: `70b063a47` (merge-base; main is at 469f4ea93 / HEL-1350,
which touches none of this branch's files — `git merge-tree` against 469f4ea93 is clean).

### Phase 1: Spec Review — FAIL

Product behaviour matches the ticket, design D1-D4, the spec delta and tasks 2.x/3.x. The evidence artifacts that
AC1 and AC3 rest on are not durable. Details:

- AC1 (duplicate removed, probe-proven root cause): PASS on substance. The ON/OFF StrictMode flip (2 -> 1
  run-history GETs, same harness, same initiator `usePipelineDetailPage.ts:386`) is a sound both-ways proof, and the
  fix is at the cause (an unguarded effect), not a StrictMode removal. **But** the two probe logs it cites
  (`logs/probe-strictmode-ON-baseline.log`, `logs/probe-strictmode-OFF.log`) match `.gitignore:27 *.log` and are
  NOT committed (see CR1).
- AC2 (defer/consolidate): PASS. Run history is deferred; `boot-audit.md` records a first-paint consumer and a
  keep/defer decision for every other call. The data-sources x2 -> x1 dedupe is correct (see Phase 2).
- AC3 (before/after numbers): present and honestly characterized. "No measurable change" for direct-goto TTI and
  hel910, and a ~3% post-create 6x gain from interleaved ABAB on one server, are fair readings of the tables. The
  hel910 before batch ended at load 13.43 and the after batch at 7.53; both are disclosed and neither side is
  claimed against HEL-1298's quiet-host f8. C1 was followed: load gate < 2 passed (1.77 / 1.98), 3 burners with
  recorded PIDs, n=20, loadavg before/after, `--workers=2`, and `throttle-hel910-spec.diff` matches HEL-1298's hook.
  Two gaps:
  - Most raw logs behind the tables are gitignored and uncommitted (CR1).
  - The "after" direct-goto TTI and request-count batches (`after-a-meta.log`, `after-b-meta.log`) ran at
    `SHA=70b063a47 ... dirty-frontend-files=9` at 00:11 and 00:15, before commit 1a4c07dce (00:48). D5 requires
    "after" on the final head, and `measurements.md` labels them "after :6786" without saying they came from an
    uncommitted tree (CR2). The same applies to the `pcafter-*` batches (`frontend-diff-files=7 70b063a47`).
  - The headline "1 per truncated open" has no probe log, although task 2.2's verify clause requires one (CR2). I
    verified the claim live myself (Phase 3, scenario D: 1 GET and the banner renders).
- AC4 (no regressions, RTL tests for what was deferred): PASS. See Phase 2 for mutation results.
- Tasks: all checked. Behaviour matches, except for the 2.2/3.4 evidence points above.
- Scope: clean. No changes to `ci.yml`, `playwright.config.ts`, `.gitignore`, `outputEditor/**` or
  `buildChartOption`. No `e2e/zz-hel1354-*` in the tree or the diff. `.npm-cache/` is ignored and uncommitted.
  `workflow-state.md` is present as expected.
- CONSTRAINTS C1: honored (above).
- Driver constraints: dev-DB residue is recorded by exact id/email, and `matt@helio.dev` was never touched
  (grep: 0 hits). But `logs/created-ids.log` is itself an uncommitted `*.log` (CR1).

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH under `nice -n 19`:
- `npm run lint`: 0. `npm run format:check`: 0. `npm run typecheck`: 0. `npm --prefix frontend run build`: 0.
- `npm test`: the first run had 1 failure, in `src/features/panels/ui/PanelCard.test.tsx` ("PanelCardBody does not
  re-render…", expected 2 got 3). That file is untouched by this branch, and the failure is a contention flake: it
  passed 35/35 three times in isolation, and a second full run was green (456/456 suites, 4764 tests).

Mutation check, in my own throwaway detached worktree at 45c1800c5 (removed afterward). Each mutation was run
against `PipelineDetailPage.runHistory.test.tsx` and `pipelinesSlice.test.ts` (78 tests, green at baseline):

| mutation | result |
|---|---|
| thunk `condition` always true | 1 failed |
| post-run refresh without `force` | 1 failed |
| `fulfilled` without the latest-request-wins check | 2 failed |
| modal not closed on in-place id change | 1 failed |
| token not regenerated on id change (A->B->A) | 1 failed |
| data-sources once-per-mount ref removed | 1 failed |
| freshness ignores openId | 3 failed |
| boot chain ignores `lastRunTruncated` | 4 failed |

Every specified behaviour has a test that turns red.

Design points verified in code:
- Per-open `openId` comes from a module counter: lazy `useState` plus the derived-state branch.
- In StrictMode the token is stable and the boot effect is ref-guarded, so the revisit test gives 1 GET.
- A->B->A gives a new token on each change, and the derived branch also closes the modal.
- There is no reactive refetch effect. The opener is click-time `openRunHistory`, and Retry calls `load`.
- `force: true` is set on all three post-run callers: `onTerminal` at `usePipelineDetailPage.ts:280`, and
  `handleRunPipeline` / `handleDryRun` at `:1274` / `:1287`.
- Latest-request-wins applies on both `fulfilled` and `rejected`.
- Stale-while-revalidate: `fresh` stays true during a same-open refresh because `loadedOpenId` is unchanged.
- The `onRetry` error path now goes through the hook's `retryPipelineLoad`, which runs the same chain as boot.
- The boot chain has no cleanup/cancel flag, as D3 requires.
- Effect ordering is correct: `useRunHistory`'s ref-sync effect is declared before the boot effect, so the boot
  chain captures the current open's token.

data-sources dedupe:
- `sourcesSlice` status only returns to `"idle"` from the initial state (`sourcesSlice.ts:54`). The pending,
  fulfilled and rejected handlers at :257/:263/:268 never set it back.
- Every other refetch path dispatches `fetchSources()` directly.
- So the per-mount `sourcesRequestedRef` can only suppress StrictMode's second effect run. That is correct and not
  a regression. Sources are global, so keeping the ref across an in-place pipeline switch is right.

Standards:
- No inline FQNs. No `any` or `eslint-disable`.
- `RunHistoryModal` reuses the shared `PageStatus` for its loading and error states, and adds no new CSS or
  hard-coded values.
- Comments state the decision inline rather than only a ticket ref.
- `usePipelineDetailPage.ts` is 1428 lines, up from 1408. It was already far over the ~250/400 soft budget, and
  the run-history logic was extracted into `useRunHistory.ts` (131 lines) rather than grown in place. Non-blocking
  (see suggestions).

### Phase 3: UI Review — PASS

I checked live against this worktree's own Vite on :6786 (process cwd verified as `HEL-1354/frontend`) and backend
:9693, using my own headless Chromium script (not the shared MCP browser, no /tmp cookie jars), run under
`nice -n 19` with one browser. Dev-DB ids I created: user `zz-hel1354-eval-1791363566914@example.com`, source
`56c1afec-f88a-43c2-8afc-217189db8e87`, pipeline `d02c121c-8ec6-4c12-805b-2313c12f3c8d`, output
`747fe8d4-373d-461f-959d-fcb499d1973d`, plus one real run of that pipeline. Results are quoted verbatim from the
probe output:

- A, non-truncated open:
  - 10 `/api/` requests: auth/me x2 (App-level, out of scope, named as a follow-up), pipelines, pipeline, steps,
    analyze, schedule, outputs, data-sources x1, dashboards.
  - `run-history` GETs = 0.
  - The Outputs tab click shows its tabpanel.
- B, modal open:
  - Exactly 1 GET, and the modal shows "No runs recorded yet" titled `Run history (0)`.
  - Escape closes it.
  - Reopening in the same page open issues 0 GETs (fresh).
- C, Run pipeline: the forced refresh issues 1 GET, and the reopened modal reads `Run history (1)` with the new
  run. At 1100/768/375 the horizontal overflow is 0 px.
- D, truncated open: the pipeline GET was intercepted to set `lastRunTruncated: true`, and run-history was given a
  truncation notice. Exactly 1 run-history GET, and the persisted banner rendered.
- E, run-history 500:
  - 0 boot GETs, then 1 on modal open.
  - The error state shows "Couldn't load run history." with Retry and the count-free title "Run history".
  - No automatic re-dispatch: still 1 after 1.5 s.
  - Retry via keyboard (focus plus Enter) issues exactly 1 more GET, and the list renders.
- F, delayed response: the modal shows "Run history" and "Loading run history…", not the empty state.
- Console errors: only browser "Failed to load resource" lines. The 404 appears on every page and is the
  pre-existing no-schedule response, which the tests also mock as 404. The 500 was the one I injected. No
  pageerrors and no unhandled exceptions.

### Overall: FAIL

The product change is correct and well tested. The failure is in the evidence trail: the files that prove the root
cause and record the dev-DB residue do not survive this branch.

### Change Requests

1. **Commit the cited raw evidence; it is currently gitignored.**
   - `.gitignore:27` (`*.log`) excludes 44 files under `openspec/changes/pipeline-detail-boot-cost/logs/`. Only
     the 29 `*.run.txt`/`.json`/`.diff`/`.txt` files are tracked.
   - The ignored files include the files `measurements.md` and `boot-audit.md` cite as load-bearing:
     - the AC1 root-cause flip: `probe-strictmode-ON-baseline.log` and `probe-strictmode-OFF.log`
     - the before inventory: `before-requests-6787check.log`
     - every TTI table source: `before-*.log`, `after-*.log` and `pc*.log`
     - C1 compliance: `*-hel910-b1.meta.log` and `*.samples.log` (burner PIDs, load gate, loadavg)
     - the dev-DB residue record: `created-ids.log`, 367 lines of exact ids, required by the driver constraints
     - the kept failed-run logs: `failed-*.log`
   - `cleanup.sh --phase4` will destroy all of them.
   - Fix without touching `.gitignore` (driver constraint): rename them to a non-ignored extension, e.g.
     `git mv`-equivalent renames to `*.log.txt` or `*.txt`. Then update every reference in `measurements.md` and
     `boot-audit.md` to match, and commit. Confirm `git check-ignore` reports nothing for each cited file.
2. **Make the "after" provenance and the truncated-open claim honest in `measurements.md`.**
   - (a) The `after-a`/`after-b` request and TTI batches and the `pcafter-*` batches ran on an uncommitted tree:
     the meta logs read `SHA=70b063a47 … dirty-frontend-files=9` and `frontend-diff-files=7`, at 00:11 and 00:15,
     before commit 1a4c07dce at 00:48.
   - D5 requires "after" on the final head. Do one of the following:
     - re-run at least the request-count batch and the direct-goto TTI batch (n=10, idle and 6x) on the committed
       head, with SHA and loadavg recorded;
     - or state plainly in the "Detail tables" section that these batches ran on the pre-commit working tree, and
       show it equals the committed product code (e.g. a content checksum of the five product files at measurement
       time, if one exists). Do not rely on mtime ordering.
   - The hel910 "after" batch is fine: `sha=1a4c07dce dirty-frontend=0`.
   - (b) The headline row "1 per truncated open" has no probe log; task 2.2's verify clause requires one. Either
     add a probe log of a truncated open (route interception of the pipeline GET is enough) or cite the RTL test
     `PipelineDetailPage.runHistory.test.tsx` "a truncated pipeline's open issues exactly one run-history GET…" as
     the evidence for that cell.

### Non-blocking Suggestions

- `usePipelineDetailPage.ts` (1428 lines) is far over CONTRIBUTING.md's soft budget. Per that rule ("propose a
  split in the PR description"), name a split in the PR body.
- `PipelineDetailPage.runHistory.test.tsx`: in the forced-refresh test, `queryByText("1 rows")` may be vacuous if
  the modal renders a singular "1 row". The `getByText("123 rows")` assertion already carries the check. Consider
  a distinct count such as 7 for the stale record.
- `PipelineDetailPage.test.tsx` flakes are not this branch's, but the `PanelCard.test.tsx` contention flake I hit
  (HEL-579 re-render count) may be worth a follow-up.
