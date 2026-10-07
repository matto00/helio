## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `ba567283b5d0bfb9db4e2464360a1ad8e025c04b` against the live-resolved base `469f4ea9377729f90d32e640a22b61be3c487439` (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/createplacement-test-timeout-under-load/HEL-1353`.

### What I verified (with evidence)

**Diff.** One product-tree file is changed: `frontend/src/features/pipelines/ui/PipelineDetailPage.createPlacement.test.tsx` (+42/-2). The change mocks `outputService.listOutputs` with `...requireActual` for the other exports, sets `jest.setTimeout(40000)` at file scope with a measured-reason comment, adds `configure({asyncUtilTimeout: 20000})` in `beforeAll` and restores it in `afterAll`, and drops case (a)'s literal `20000`. The other 41 files are openspec artifacts, including 22 `.gz` logs and `probe-instrumented.test.tsx.txt`. No product file, `jest.config.cjs`, `ci.yml`, `playwright.config.ts` or `.gitignore` is changed.

**AC1, root cause by probe.** `probe-evidence.md` names every driver-required class:
- Fixed wait is refuted. The case (b) phases scale with load (render 21 -> 308 ms, insertAt 317 -> 3453 ms) and have no constant floor.
- An unresolved promise is refuted. The case finishes when it gets enough time, and the held `deferredCreate` is resolved through `act`.
- Fake timers are refuted (zero grep hits).
- Genuinely long work is confirmed.
- The escaped XHR is confirmed as real and as a partial cause, through an ablation that cut the failure rate from 6/10 to 3/10.

I read the helpers myself (test file :208-276). The dominant phase, `insertAt`, is a gap click followed by a document-wide `findByRole("option", {name})`. That is real CPU-bound query work, not a wait. **Met.**

**AC2, proper fix and stated reason.** The XHR leak is fixed at its source. My own unloaded run at HEAD gave 12/12 passing in 7.5 s, with 0 `AggregateError` and 0 `ECONNREFUSED` (`grep -c` = 0). The timeout raise comes with a measured reason in the comment (file :282-297). **Met.**

**AC3, 20+ green runs under nice with load.** The `after3-final/summary.txt` runs that went red are r1, r2, r9 and r10. I decompressed every `after3-final/FAIL-*.log.gz` and `after2/FAIL-r16.log.gz`. Their `^FAIL ` lines name only `draftCreate`, `creatingStep` and `PipelineDetailPage.test`, never `createPlacement`. That means createPlacement went 0/20 in both after3-final and after2. In BEFORE (`before-sib1x/FAIL-*.gz`), createPlacement shows `FAIL` in r2, r3, r4, r8, r9 and r10 (6/10), and the dominant failure message is `Exceeded timeout of 5000 ms`. The red was genuinely reproduced, so the green result is not vacuous.

Independent reproduction: I ran recipe R myself at HEAD for 6 runs. That means 3 `taskset -c 0 nice -n 19` burners, with PIDs 886746-886748 written to a pidfile and killed only by `kill <pid>` from it (`kill -0` afterwards: "No such process" x3), plus `taskset -c 0 nice -n 19 npx jest src/features/pipelines/ui/PipelineDetailPage --maxWorkers=3 --json`. Results:
- createPlacement passed 6/6. Per-case max per run was 8509, **18673**, 7695, 8460, 8190 and 7859 ms, and the minimum was 2.1-2.9 s.
- One run (r2) went red, on `draftCreate` only (6 cases), which is the out-of-scope sibling the probe already disclosed.

Full logs are kept at `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/skf/after/r{1..6}.{log,json}`. **Met.**

**AC4, PanelCard note.** It is present and argued as not shared: a microtask-ordering render-count assertion at `PanelCard.test.tsx:625`. It is labelled as a static read only. **Met.**

**Orchestrator question (a): is "genuinely long work" proven, or papered over?** Mostly proven. The per-phase numbers scale uniformly with contention, from 6-9x, with no floor. My independent R runs reproduce cases that run to 18.7 s and still pass, and in those runs the sibling files that kept the 5 s default still go red by the same mechanism.

Unloaded cases take 0.3-1.3 s. That is high for jsdom, but it is explained by a full-page render plus 8-15 document-wide `*ByRole` queries, which are known to be expensive in jsdom. It is real work in the test, not a hang.

A real hang is still caught. Every awaited wait in the file is a positive `waitFor`/`findBy`; the two `.not` cases at :506 and :626 are inside `waitFor` and resolve on the first passing poll. These waits now fail with the unmet assertion at 20 s, which is below the 40 s case limit, so no assertion is weakened.

One reservation, not blocking: the margin is thin by R's own numbers. 40 s against the worst observed 19.3 s (theirs) or 18.7 s (mine) is about 2.1x. R is roughly 2-3x harsher than the HEL-1277 incident (createPlacement took 66-105 s under R against 34.6 s in the incident), so the margin against realistic load is larger.

**Orchestrator question (b): is the `taskset -c 0` deviation sound?** Yes, and it is disclosed honestly. Unpinned, 3 burners plus 3 workers on 12 cores does not contend; the evidence shows 0/10 for both the single file and the siblings. R was applied identically to BEFORE and AFTER. It reproduces the incident's failure mode, the jest 5 s case timeout. It is harsher than the incident, which makes the after-green stronger, not weaker. The probe also states that case (b) itself never failed under R, and that the red appeared on other cases of the same file.

**Orchestrator question (c): is any of the evidence vacuous-green?** No, for the reasons under AC3. The comparison includes per-case maximum durations, not just pass counts. One wording error remains, which the evaluator also caught: "case (b) never failed in my reproduction" is false for `after1-timeout-only` FAIL-r3, where (b) hit the 1 s findBy expiry.

**Orchestrator question (d): is the committed evidence acceptable?** No. See Change Request 1. Measured facts:
- `git ls-files .../evidence` totals 383,986 bytes. The entire existing `openspec/changes/archive/**/evidence*` tree is 410,699 bytes, so this one change roughly doubles the repo's archived evidence.
- These 22 files are the first `.gz` blobs under `openspec/`.
- `check:no-credential-leak` skips `.gz` (evaluator, confirmed by its `BINARY_FIXTURE_EXTENSIONS`). CONTRIBUTING.md:204-209 makes "every future evidence file under `openspec/` must carry a marker or elide the value" a standing repo-wide constraint, enforced by that gate. Gzipped logs are exactly the case the gate cannot see.
- `probe-evidence.md:8` cites `evidence/*/burner-kill.log` as the proof of PID-file kills. Those files exist only locally: `git check-ignore` matches `.gitignore:27:*.log`, and `git ls-files ... | grep -c burner` = 0. In the archived record the citation therefore points at nothing.
- None of the run evidence was persisted out of repo. `.concertino/runs/HEL-1353/evidence/` holds only the planning docs and `evaluation-1.md`, so the committed blobs are currently the only copy. Moving them takes a persist step, not just a delete.
- Once merged, the blobs are permanent in git history. Now is the only cheap point to fix this.

**Gates.** I re-ran only the target file, unloaded and under R (above). I rely on the evaluator's pasted rc-0 lint, typecheck, format:check and `src/features/pipelines/ui` jest output, which is unambiguous. There is no UI surface, so no servers were started and no screenshots were taken.

### Verdict: REFUTE

The test fix itself is sound and I would ship it as-is. The refute is only about the committed change-dir artifacts.

### Change Requests

1. **Move the raw run evidence out of the repo and keep only a reviewable text record.**
   - Persist the full-log evidence durably with `scripts/concertino/persist-evidence.sh HEL-1353 <path>`, so the driver's "keep full logs of any failing run" still holds. That covers every `evidence/**/FAIL-*.log.gz`, `before-sib1-FAIL-r2.log.gz`, every `evidence/*/burner-kill.log` and `evidence/probe-instrumented.test.tsx.txt`.
   - Then `git rm` the 22 `.gz` files and `probe-instrumented.test.tsx.txt` from `openspec/changes/createplacement-test-load-timeout/evidence/`.
   - Keep the `summary.txt` files and `run-recipe.sh.txt`.
   - Add a small plain-text `failures.txt`, or a section in `probe-evidence.md`. For each red run it should list the `^FAIL <file>` lines and the de-duplicated failure messages with counts. That makes the 6/10 -> 0/20 attribution checkable from the committed record, and keeps it visible to `check:no-credential-leak`.
   - Cite the persisted `READY ref=` paths in `probe-evidence.md`.

2. **Fix the dangling burner-kill citation at `probe-evidence.md:8`.** `evidence/*/burner-kill.log` is gitignored and was never committed. Either cite the persisted refs from CR1, or inline the PID and `killed <pid>` lines into the committed summary files.

3. **Correct the honesty note in `probe-evidence.md` ("case (b) itself never failed in my reproduction").** Change it to "never failed in BEFORE". Case (b) did fail in `after1-timeout-only` FAIL-r3, at the 1 s findBy expiry. In the same edit, make the "CPU shared 6 ways" in the test comment at file :285 match the probe's "~7 ways" (3 burners + 3 workers + the jest parent on one core), or reword one so they agree. This touches a comment only; no code behavior changes.

### Non-blocking notes

- The dominant cost is document-wide `findByRole("option", {name})` after a gap click (`insertAt`, test file :247-250). Scoping that query to the open listbox with `within(...)` would cut the work itself, not just the margin to the limit. It is optional and could fit with the sibling-file follow-up.
- Follow-ups for the orchestrator to file, already noted by the evaluator and reconfirmed by my run r2: `draftCreate`, `creatingStep` and `PipelineDetailPage.test` still go red under R by the same mechanism, and they still leak the unmocked `GET /api/pipelines/:id/outputs` XHR.
- Margin: 40 s against an observed R worst of 18.7-19.3 s is about 2.1x, which meets D2's ">= 2x". If a future R-class observation exceeds 20 s, the floor is breached; the constant's comment already documents how to re-derive it.
- No evidence in this review relies on mtime ordering. Every BEFORE/AFTER attribution above comes from content: the `^FAIL` lines inside the logs and the summary rc/test counts.
