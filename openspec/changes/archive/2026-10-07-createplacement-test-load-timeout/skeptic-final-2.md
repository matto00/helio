## Skeptic Report — final gate (round 2, skeptic-final-2.md)

I reviewed HEAD `ef6d51e89f957a7d70f24002b7bde8d6f5c5fec4` (parent `ba567283b`) against the live-resolved base `469f4ea9377729f90d32e640a22b61be3c487439`. The base came from `resolve-review-base.sh` with exit 0. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=bug/createplacement-test-timeout-under-load/HEL-1353`. The working tree was clean before and after my review; I wrote nothing except this report.

### What I verified (with evidence)

**Diff scope.** `git diff --stat BASE...HEAD` shows one product-tree file changed: `frontend/src/features/pipelines/ui/PipelineDetailPage.createPlacement.test.tsx`. Everything else is under `openspec/changes/createplacement-test-load-timeout/`. That covers 10 `summary.txt` files, `failures.txt`, `run-recipe.sh.txt` and the planning and review docs. No `.gz` file, no `probe-instrumented.test.tsx.txt`, and no product, `jest.config.cjs`, `ci.yml`, `playwright.config.ts` or `.gitignore` change. Constraints C1 and C4 are honored.

Between `ba567283b` and `ef6d51e89`, the only test-file change is a comment edit at :285-286. Code behavior is unchanged from what the round-1 skeptic measured.

**CR1 (move the raw evidence out of the repo; add a text record): addressed, and I verified it by content.**
- I took each of the 23 removed blobs (22 `.gz` files plus `probe-instrumented.test.tsx.txt`) from `git show ba567283b:<path>` and sha256-compared it with its persisted copy under `/home/matt/Development/helio/.concertino/runs/HEL-1353/evidence/openspec/changes/createplacement-test-load-timeout/evidence/`. Result: `ok=23 bad=0`. All 10 `burner-kill.log` files are also persisted and match the local copies (`cmp`: same x10). The driver's "keep full logs of any failing run" requirement therefore still holds.
- I recomputed `^FAIL <file>` from every persisted log (`zcat | grep '^FAIL '`) and compared the result with each `== <log>` section of the committed `failures.txt`: 22/22 match.
- The tallies in `failures.txt` reproduce the attribution in `probe-evidence.md`:
  - **before-sib1x, createPlacement:** 19 jest 5 s timeouts, 3 "Unable to find" and 3 assertion failures, across 6/10 runs.
  - **after1-timeout-only:** 10 "Unable to find" and 10 waitFor-expired failures across 4/20 runs.
  - **after2 and after3-final:** no createPlacement `FAIL` line at all.
- `check:no-credential-leak` passes with rc=0. The committed evidence is now plain text that this gate can scan. A keyword grep (api key, token, password, secret, bearer) over all the persisted logs found 0 hits.

**CR2 (dangling burner-kill citation): addressed.** `probe-evidence.md:8` now points to the inlined PID and `killed <pid>` record at the end of `failures.txt`, which is present for all 10 recipes, and to the persisted logs.

**CR3 (wording): addressed.**
- `probe-evidence.md` now reads "case (b) itself never failed in BEFORE".
- The test comment now says "~7 ways (3 burners + 3 workers + the jest parent)", which matches the probe.

**AC1 (root cause by probe; classification names the driver's classes).** Each class gets a confirmed or refuted line with numbers in `probe-evidence.md`:
- **Fixed wait:** refuted. The phases scale with load and have no floor.
- **Unresolved promise:** refuted.
- **Fake timers:** refuted, with zero grep hits.
- **Genuinely long work:** confirmed as the primary cause.
- **Escaped XHR:** confirmed as a partial cause. The ablation took the red rate from 6/10 to 3/10.

These numbers agree with the persisted logs, as checked above. **Met.**

**AC2 (proper fix; any timeout raise is justified).**
- The XHR leak is fixed at its source by mocking `outputService.listOutputs` with `requireActual` for everything else.
- My fresh unloaded run is 12/12 passing in 8.1 s, with `grep -cE 'AggregateError|ECONNREFUSED'` = 0.
- `jest.setTimeout(40000)` is scoped to this file and carries a comment giving the measured reason.
- `asyncUtilTimeout` is set to 20 s in `beforeAll` and restored in `afterAll`. That is below the case limit, so a real hang still reports the unmet assertion.

**Met.**

**AC3 (20+ green runs under nice with load).** The committed record shows `after3-final` at 0/20 createPlacement red and `after2` at 0/20, against BEFORE at 6/10. I verified this from the logs above.

My fresh independent reproduction at HEAD `ef6d51e89` used recipe R:
- 3 burners, each `taskset -c 0 nice -n 19`. Their PIDs (929384-929386) were written to a pidfile and killed only by `kill <pid>` from it. A follow-up `kill -0` returned "No such process" x3.
- `taskset -c 0 nice -n 19 npx jest src/features/pipelines/ui/PipelineDetailPage --maxWorkers=3 --json` over the 6 files, run 4 times.

| run | all tests | createPlacement passed | max case (ms) | min case (ms) | wall time |
|---|---|---|---|---|---|
| r1 | 167/167 | 12/12 | 8345 | 2441 | 123 s |
| r2 | 167/167 | 12/12 | 7877 | 2222 | 104 s |
| r3 | 167/167 | 12/12 | 7378 | 2356 | 102 s |
| r4 | 167/167 | 12/12 | 7356 | 2264 | 102 s |

The load is real: the case maximum runs well past the 5 s default that the old code would have hit, and the cases now pass. Logs are at `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/skf2/r{1..4}.{log,json}` and `burner-kill.log`. **Met.**

**AC4 (PanelCard note).** The note is present. It classifies the PanelCard flake as not shared, because it is a microtask-ordering render-count assertion at `PanelCard.test.tsx:625`. It is labelled as a static read only, and PanelCard was not changed. **Met**, and there was correctly no escalation.

**Gates (fresh, on HEAD).**
- rc=0: `prettier --check` and `eslint --max-warnings=0` on the test file.
- rc=0: `tsc --noEmit` for the frontend.
- rc=0: `check:no-credential-leak`, `check:openspec`, `check:repo-integrity`.
- rc=0: `prettier --check` on the change dir.

**UI.** This is a test-only change with no UI surface, so I started no servers and took no screenshots. Starting servers was also excluded by the driver.

**Evidence ordering.** None of my conclusions depend on mtime or directory ordering. Every attribution comes from content: sha256 comparisons, `^FAIL` lines and JSON test results.

### Verdict: CONFIRM

### Non-blocking notes

- **Comment wrap at test file :285-286.** The CR3 edit left a 118-character line followed by the orphan fragment `// scaling with`. That line is above the 100-column width the rest of the comment uses. It is ugly but not blocking, for three reasons:
  - The sentence still reads correctly ("a case runs up to ~19s, every phase scaling with contention ...").
  - Prettier does not reflow comments, and no lint rule enforces comment width. Prettier and eslint both returned rc=0.
  - Six other comment lines in `src/features/pipelines/ui/*.tsx` already exceed 100 characters.

  A one-line reflow would be good hygiene if the file is touched again. It does not justify another cycle on its own.
- **`files-modified.md` is stale.** Its third bullet still says `evidence/**` holds "run logs, burner PID/kill logs, instrumented probe copy (.txt)". After `ef6d51e89` it actually holds `summary.txt`, `failures.txt` and `run-recipe.sh.txt`.
- **Old relative paths in `probe-evidence.md`.** Some body text still cites the removed files by in-repo path, such as `evidence/before-sib1x/FAIL-r*.log.gz`, `before-sib1-FAIL-r2.log.gz`, "logs gzipped in `evidence/`" and `evidence/probe-instrumented.test.tsx.txt`. The new "Persisted evidence" section gives the durable directory and states that the relative layout is the same, so every citation resolves. I checked: all 33 files are present there.
- **Sibling flakes still open, as noted in round 1.** `draftCreate`, `creatingStep` and `PipelineDetailPage.test` still go red under R and still leak the outputs XHR. They are a follow-up candidate and out of scope here.
