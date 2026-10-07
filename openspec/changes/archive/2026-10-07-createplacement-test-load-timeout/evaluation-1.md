## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `ba567283b5d0bfb9db4e2464360a1ad8e025c04b` against the live-resolved base `469f4ea9377729f90d32e640a22b61be3c487439` (`resolve-review-base.sh`, exit 0). Working tree clean. The diff touches one product-tree file, `frontend/src/features/pipelines/ui/PipelineDetailPage.createPlacement.test.tsx` (+42/-2), plus the openspec change dir.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (probe root cause): `probe-evidence.md` gives a confirmed or refuted line, with numbers, for each driver-named class: fixed wait, unresolved promise, fake timers, genuinely long work, and escaped XHR. The per-phase timings in case (b) scale with contention and show no constant floor. "Genuinely long work" is the primary cause. The escaped XHR is a real partial contributor: it fell from 6/10 to 3/10 in the `ablate-xhr-only` ablation.
- AC2 (proper fix, timeout justified): the escaped XHR is mocked, and the timeout raise carries an inline comment with the measured reason.
- AC3 (20+ green runs under nice with load): `after3-final` was 0/20 red for createPlacement under recipe R. I confirmed this from the logs (see Verification of claim 1).
- AC4 (PanelCard note): present. It is classed as not shared: a microtask-ordering render-count assertion. That is a static read only and is labelled as such.
- Tasks are all marked done and match the diff. No scope creep: only the target test file changed. C1-C4 are honored: no product file, no `jest.config.cjs`/`ci.yml`/`playwright.config.ts`/`.gitignore` change, burners were killed from a PID file (every `burner-kill.log` shows `killed <pid>` x3), and no hook bypass.

### Verification of the orchestrator's five questions

**(1) Before/after rates match the gzipped FAIL logs.** I decompressed every `FAIL-*.log.gz` and counted `FAIL <file>` lines and the `● ... step-create placement` failure blocks:

| set | runs red (any file) | createPlacement red | which runs (createPlacement cases failed) |
|---|---|---|---|
| before-sib1x | 7/10 | **6/10** | r2(7) r3(1) r4(8) r8(4) r9(1) r10(6). r5 was draftCreate only |
| ablate-xhr-only | 4/10 | **3/10** | r2 r3 r4. r9 was PipelineDetailPage.test only |
| after1-timeout-only | 5/20 | **4/20** | r3 r5 r6 r19. r4 was PipelineDetailPage.test only |
| after2 | 1/20 | **0/20** | r16 = draftCreate, creatingStep, PipelineDetailPage.test |
| after3-final | 4/20 | **0/20** | r1, r2, r9 = draftCreate. r10 = draftCreate + PipelineDetailPage.test |

Every number in `probe-evidence.md` matches, including the "1/1/4/6/7/8 failing cases" breakdown. I classified the before-sib1x createPlacement failure blocks: 19 `Exceeded timeout of 5000 ms`, 3 `Unable to find role`, 3 `expect(...)`. That matches the claim. The claim that all 4 red runs in after3-final were sibling files is **confirmed**.

My own independent check was recipe R (3 `taskset -c 0` niced burners, PID-file kill, plus the 6 `PipelineDetailPage*` files with `--maxWorkers=3`) for 3 runs at HEAD: 3/3 fully green (167/167, about 104-105 s each).

**(2) The deviations are justified.**
- File-scoped `jest.setTimeout` instead of a per-case shared constant. I reproduced the Prettier claim on a scratch sample with the repo's Prettier. A non-literal third argument (`}, T)`) makes Prettier break the whole `it(` call into the expanded form, re-indenting the body. A numeric literal keeps the test-call layout. Every case's loaded maximum is above 50% of 5 s (before minimum about 4.0 s; after2 minimum 2.8 s). So under D2's own rule every case qualifies, and file scope has the same effect. It stays out of `jest.config.cjs`, and jest-circus scopes it to this test file's module registry.
- `configure({ asyncUtilTimeout })`. `after1-timeout-only` shows that once the 5 s limit was lifted, testing-library's 1 s default became the binding limit: 4/20 red, all `Unable to find`/waitFor-expiry, no jest timeouts. That is measured, not speculative. The value is restored in `afterAll`, and 20 s stays below the 40 s case timeout, so a real hang still reports the unmet assertion.
- `taskset -c 0`. The evidence shows the unpinned design recipe never reproduced the red (0/10 single file, 0/10 siblings on 12 cores). The pin is applied identically to BEFORE and AFTER and is disclosed as a deviation. Justified.

**(3) asyncUtilTimeout does not hide a defect or weaken a negative assertion.** I listed every async utility in the file (`grep waitFor|findBy|queryBy|.not.`). The only negative assertions are:
- `waitFor(() => expect(queryByText(...)).not.toBeInTheDocument())` at :506 and :626. waitFor resolves on the first passing poll, so a longer timeout only lengthens the time before a real failure is reported. It cannot turn a failure into a pass.
- A synchronous `queryByRole(...).not` at :536. Not affected.

No test asserts absence by waiting out a timeout, and nothing uses `.rejects` on a `findBy`. The `toHaveBeenCalledTimes(N)` waitFors still fail if the count overshoots (after up to 20 s instead of 1 s). The setting is confined to this file's describe block, the only `describe` in the file, and is restored afterwards.

**(4) The escaped-XHR mock is correct.** `jest.mock("../services/outputService", () => ({ ...jest.requireActual(...), listOutputs: async () => [] }))` keeps every other export real. It returns a `Promise<Output[]>` that matches `listOutputs(pipelineId, nodeStepId?): Promise<Output[]>` (`outputService.ts:26`). My own unloaded single-file run at HEAD shows 0 `AggregateError`, 0 `ECONNREFUSED` and 0 `console.error`, against about 12 per file run before. The 144-155 `AggregateError` lines in the multi-file logs come from the sibling files, which still do not mock it.

**(5) Evidence hygiene: acceptable, with a suggestion.** There is precedent for committed evidence text files (for example `archive/2026-08-25-mobile-touch-target-guard/evidence/*.txt`, `archive/2026-09-05-delete-source-conflict-409/evidence/red-before-fix.txt`). However, these 22 `.gz` files are the **first gzipped blobs under `openspec/`** (`git ls-files 'openspec/**/*.gz'` gives 22, all from this change). `check:no-credential-leak` skips `.gz` (`scripts/check-no-credential-in-agent-surface.mjs`, `BINARY_FIXTURE_EXTENSIONS`), so the mechanical backstop from CONTRIBUTING.md:183-209 cannot see inside them. I ran its patterns by hand over all 393,413 decompressed lines: no `helio_pat_`/`sk-ant-` tokens, no high-entropy KEY/SECRET/TOKEN/PASSWORD values, no emails, no bcrypt hashes. The only personal data is absolute `/home/matt/...` paths in stack traces. The total is 548 KB, and the ticket's driver constraint asks for full logs of failing runs to be kept. Not blocking (see suggestions). `probe-instrumented.test.tsx.txt` uses a `.txt` extension, so jest, ESLint and Prettier never pick it up. It is text, so the credential gate scans it.

### Phase 2: Code Review — PASS
Gates, run fresh by me in `WORKTREE_PATH` at HEAD, with `npm_config_cache` set to scratch, `nice -n 19`, and `--maxWorkers=3` for jest:
- `npm run lint`: rc 0
- `npm run typecheck`: rc 0
- `npm run format:check`: rc 0, "All matched files use Prettier code style!"
- `npx jest src/features/pipelines/ui --maxWorkers=3`: rc 0, 67 suites / 875 tests passed, 26.4 s
- Target file alone (`--verbose`): 12/12 passed, 7.9 s, 0 escaped XHR

Code: no `any` and no dead code. The constants are named (`LOADED_CASE_TIMEOUT_MS`, `LOADED_ASYNC_UTIL_TIMEOUT_MS`), and the comments state the measured reason. Removing case (a)'s literal `20000` is correct, because the file-wide 40 s now covers it and the trailing comment points to the constant. No CONTRIBUTING.md mechanical violations (no inline FQNs, import style matches the file). DESIGN.md does not apply (no UI code).

Issues: none blocking.

### Phase 3: UI Review — N/A
The only `frontend/**` change is a `*.test.tsx` file. No rendered product code, route, schema or spec changed, so there is no observable UI surface. Per the orchestrator's directive, no dev servers were started and no dev-DB data was created.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `probe-evidence.md` "Honesty notes (1)" says case (b) "never failed in my reproduction". That holds for BEFORE, but both case (b) rows did fail in `after1-timeout-only/FAIL-r3` (1 s findBy expiry). Rewording it to "never failed in BEFORE" would make it exact.
- The test comment says "CPU shared 6 ways"; `probe-evidence.md` says "~7 ways". This is cosmetic.
- For future changes, consider keeping gzipped run logs out of git: persist them via `persist-evidence.sh` and commit only `summary.txt` plus plain-text failure excerpts. `.gz` is invisible to `check:no-credential-leak`, so a later log that captures a real credential would pass every gate. (Scanned by hand here: clean.)
- Follow-ups for the orchestrator to file: (a) the sibling files `draftCreate`, `creatingStep` and `PipelineDetailPage.test` still go red under recipe R (after3-final draftCreate 4/20); (b) the same sibling files still leak the unmocked `GET /api/pipelines/:id/outputs` XHR (144 `AggregateError` lines per after-run log).
