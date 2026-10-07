## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `ac4631c691cff324ef5682d8e497bfb12a4fb301` against live base `469f4ea9377729f90d32e640a22b61be3c487439`
(origin/main). This is a CI-only change: `.github/workflows/ci.yml`, `scripts/ci-sbt.sh`, `scripts/lib/ci-sbt-diag.sh`,
`scripts/e2e-backend.sh`, the selftest, the static guard and `package.json`.

### Phase 1: Spec Review — FAIL

Each acceptance criterion is addressed:
- Client-mode decision and its startup cost: met (`--server`, measured with D1a metrics).
- Thread dump with a PID from a recorded source: met, and proven on real CI.
- osv timeouts: met.
- Multi-run evidence: met.

Tasks 1.1-4.5 are all done and match the code. There is no scope creep, and the throwaway commits left nothing behind
(see below). The phase fails for one reason: the C2 gate outcome recorded in `ci-evidence.md` is wrong as written, and
one of the numbers behind it is miscounted.

**C2 / D1 ruling (the orchestrator asked for an independent read).**

D1 trips the gate on either of two clauses:
1. A median regression of 10 s or more on a gated step or startup metric.
2. "Any run breaching backend median 5.5 min / e2e 7 min".

I re-derived the numbers from the GitHub jobs API for every cited run: SERVER (7 runs), THIN-AB (4) and BASE10 (10).
- **Clause 1 is not tripped.** These medians match `ci-evidence.md` exactly:
  - Compile and test: 179.5 s vs 177.5 s.
  - SBOM: 19 s vs 17.5 s.
  - Wait for backend health: 45.5 s vs 47.5 s.
  - Backend leg: 220 s vs 220.5 s.
  - e2e leg: 389 s vs 374.5 s.
  - Run e2e suite: 212 s vs 201.5 s.

  I spot-checked the e2e backend-ready metric from downloaded logs (run 37579760599 a2, run 37586488590 a1). The values
  are 90-121 s in both modes and consistent with the reported medians. No gated metric moves by 10 s or more.
- **Clause 2 is tripped as written, twice, and the evidence undercounts it.** Two SERVER runs had an e2e leg over the
  7-minute line:
  - 37579760599 attempt 2, e2e (4): 441 s.
  - 37579760599 attempt 3, e2e (4): 423 s.

  `ci-evidence.md:42-44` says "441 s once in 7 runs" and "SERVER (1 of 28)". The correct count is 2 of 28 legs and 2 of
  7 runs. The 423 s leg is even included in the "417 median of per-run max" that the same line quotes.
- **The executor waived the clause instead of escalating.** The argument for the waiver is factually sound:
  - The thin-client baseline breaches the same line at the same rate.
    - BASE: 3 of 36 legs, 3 of 9 runs (452 s, 439 s, 430 s).
    - THIN-AB: 1 of 16 legs, 1 of 4 runs (423 s).
    - SERVER: 2 of 28 legs, 2 of 7 runs.
  - The HEL-1288 target behind "e2e <= 7 min" is a *median of the slowest leg*, and it still holds. The median
    per-run slowest leg is 417 s for SERVER, 412 s for THIN-AB and 411 s for BASE.
  - `Compile / run / fork := true` (`backend/build.sbt:100`) means the backend JVM that Playwright talks to is a
    build.sbt-configured fork in both modes. That supports "the sbt mode cannot reach the Run e2e suite step".

  However, waiving it is a reinterpretation of a binding constraint. C2 and D1 both say that when the gate trips, the
  executor stops and the orchestrator raises the numbers. The executor did not stop: it declared "C2 gate outcome: NOT
  tripped" (`ci-evidence.md:46`), which is not true of the gate as written.

**My read on "no real time cost".** The evidence supports it for every metric the sbt mode can plausibly affect
(backend, SBOM, backend-ready, all within ±4.4 s). The +14.5 s on the whole e2e leg sits almost entirely in `Run e2e
suite`, and THIN-AB has only 16 legs to compare against. Per-shard medians swing both ways (my numbers agree), so this
is best described as "no measurable cost, within runner noise", not "proven zero".

My recommendation to the owner is to accept `--server`. But accepting is the owner's decision under C2, not the
executor's or mine.

**Other Phase 1 checks**
- Throwaway residue: none. `git diff 3efd794bd HEAD -- . ':!openspec'` is empty. `git diff ef5873054^ c4cad37c3` is
  empty, so the control and its revert cancel out. f710ca2e7 removed `--server` from `e2e-backend.sh` and 7c380f213
  restored it, for a net change of zero. `git grep "Thread.sleep(600000)"` outside openspec only hits the selftest's
  intended `Hang.java`.
- The positive control is verified:
  - Run 37583797617: security failed at "Generate backend SBOM" and `ci-complete` failed, both on ef5873054.
  - `control-artifact/threads-2564.txt:20-24` shows the "main" thread in `Thread.sleep` from `$sbtdef`.
  - `ps-session.txt` shows PID 2564 = PGID = SID, and that PID is the java process.
- Mode proof: the downloaded SERVER logs show `ci-sbt: mode=server ... exe=.../temurin-21-jdk-amd64/bin/java` and
  `ans: Long = 3221225472`.
- osv sizing: re-derived from the API for 21 security jobs. Every install/scan step took 0-1 s, and the slowest job
  took 94 s. A 1-minute floor is correct.

### Phase 2: Code Review — FAIL

The listed gates (frontend lint/format/test/build, backend `sbt testFull`) are not triggered, because no changed file
matches `frontend/**` or `backend/**`. I ran these fresh in the worktree, and all passed:
- `npm run lint` and `npm run format:check` (repo-wide).
- `check:ci-sbt-guard` (OK, 4 files) and `check:ci-sbt-guard:selftest` (13/13).
- `selftest:ci-sbt`: 16/16 in 19.3 s.
- `check:precommit-ci-parity`, `check:openspec` and `check:no-credential-leak` (0 violations).
- `bash -n` on the three shell scripts, and a YAML parse of `ci.yml`.

**Mutation reds, reproduced by me** on scratch copies (each mutant's selftest goes red):
- Launch through `| tee`: 8 FAILED, recorded exe `/usr/bin/tee`.
- cwd check bypassed in `_diag_is_backend_jvm`: 2 FAILED, (c).
- `ci_sbt_capture` neutralised in the `e2e-backend.sh` `die` path: 1 FAILED, (d).
- **Extra mutation, not in the executor's set:** `ci_sbt_stop_group` neutralised in `ci-sbt.sh`: 6 FAILED. The
  "group gone/stopped" checks are failable.
- Injected `x=$(pgrep -f sbt)`: the guard exits 1 at `scripts/lib/ci-sbt-diag.sh:132`, and the guard selftest's "real
  tree is clean" goes red.

C1 (no pattern-matched process selection) holds in the code. Every PID comes from `$!`, from `/proc/<p>/stat` PGID
equality, or from the active.json socket path, and is checked as java plus backend cwd before any dump or individual
signal.

Issues:
1. **`scripts/e2e-backend.sh:55` and `:57` hard-code `mode=server`.** The spec says the mode line must name the mode.
   Here it is a literal, not derived from how sbt was launched, and the A/B runs show it printing something false.
   THIN-AB run 37586488590 a1 logs `e2e-backend: mode=server pgid=2676 exe=.../sbt/bin/sbtn-x86_64-pc-linux` (job
   112677690549). `ci-sbt.sh` derives its mode from `--mode`, so the two helpers are inconsistent.
2. **`.github/workflows/ci.yml:330` comment says "measured 0-1 s in the 6 security jobs sampled (ci-evidence.md)".**
   `ci-evidence.md` (and my API re-derivation) uses 20+ security jobs, so the citation contradicts the file it points to.

### Phase 3: UI Review — N/A

No trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The change's spec
deltas live under `openspec/changes/`.

**Secrets in `ci-logs/`: clean.**
- The CI-only `CONNECTOR_MASTER_KEY` value from `ci.yml:169/512` appears in no committed log. Every occurrence is
  `<elided: CI-only test value from ci.yml>`.
- `GITHUB_TOKEN` and the git `AUTHORIZATION` extraheader appear only as GitHub's own `***` mask.
- There are no `ghp_`/`ghs_`/`github_pat_`/`AKIA`/`sk-ant-`/PEM/JWT-shaped strings.
- Postgres `helio`/`helio` and `placeholder` OAuth values are public CI fixtures already in `ci.yml`.
- `check:no-credential-leak` passes.

### Overall: FAIL

### Change Requests

1. **The C2 escalation must be raised before shipping (orchestrator, per D1).** The D1 "any run breaching ... e2e
   7 min" clause is tripped as written: two SERVER runs (37579760599 a2 e2e (4) 441 s, a3 e2e (4) 423 s). Raise it to
   the owner with this table instead of shipping on the executor's waiver:

   | group | e2e legs over 420 s | runs over 420 s | median per-run slowest leg |
   | --- | --- | --- | --- |
   | SERVER | 2/28 | 2/7 | 417 s |
   | THIN-AB | 1/16 | 1/4 | 412 s |
   | BASE | 3/36 | 3/9 | 411 s |

   Supporting numbers: gated deltas are all under 10 s (largest +4.4 s backend-ready); the e2e leg median is +14.5 s,
   almost all of it in `Run e2e suite`. Recommended option: accept `--server` (the breach rate is the same as the
   baseline and is not caused by the mode). The alternative is to ship the diagnostics with the thin client (`--mode
   client` / no `--server` in `e2e-backend.sh`).
2. **Correct the gate outcome in `ci-evidence.md`.**
   - `ci-evidence.md:42-44`: replace "SERVER 441 s once in 7 runs" and "SERVER (1 of 28)" with the correct counts:
     423 s and 441 s, 2 of 28 legs, 2 of 7 runs. The per-run breach rate is then about equal to the baseline (BASE
     3/9, THIN-AB 1/4), not "lower".
   - `ci-evidence.md:46`: replace "C2 gate outcome: NOT tripped" with a statement that the step/startup clause is not
     tripped, the any-run clause is tripped as written (and is also tripped by the unchanged baseline), and the
     decision went to the owner. Record the owner's ruling once it is given.
3. **Derive the e2e mode label instead of hard-coding it.** In `scripts/e2e-backend.sh:49,55,57`, define the sbt mode
   flag once (for example `SBT_MODE_FLAG=--server` and `MODE=server`). Use it in the `start` launch, and print `$MODE`
   in the `wait` mode lines. Alternatively, print the mode inferred from the exe (`java` → server, `sbtn*` → client)
   rather than a literal, so the line can never claim `server` while the exe is `sbtn`.
4. **Fix the sample-size citation in the comment.** In `.github/workflows/ci.yml:330`, change "the 6 security jobs
   sampled" to match `ci-evidence.md` ("20 security jobs"), or drop the count.

### Non-blocking Suggestions

- `scripts/ci-sbt.sh` `--mode client` has no caller in the final tree. Keep it only if it is wanted as the documented
  fallback for CR 1's alternative option; otherwise drop it (YAGNI).
- The static guard is line-based. It would not catch a `ps` … `grep` pipeline split across a line continuation, or
  `ps | awk '/java/'`. That is acceptable for three small scripts, but say so in the guard's header comment.
- The two unrelated flaky tests the evidence found are good spinoff candidates, as noted in `ci-evidence.md`:
  - `OutputRoutesSpec.scala:756`, a ~200 ms `eventually` window.
  - `ProductEventRollupServiceSpec.scala:85`, which depends on time of day.
