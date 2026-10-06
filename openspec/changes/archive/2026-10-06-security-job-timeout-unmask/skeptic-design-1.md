## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD e043566d1a0534c5aa98085dfa2b94431775ad28 (change dir untracked, nothing committed yet).

### What I verified (with evidence)

- **Security job as it stands** (`.github/workflows/ci.yml` lines 246-366): the step order matches design.md Context:
  checkout, java, sbt, sbt cache, node, `npm ci`, `npm --prefix frontend ci`, then SBOM → positive control → osv
  install → scan → CVSS gate, then the root, frontend/ and helio-mcp audits. No step has an `id`, an `if`, or a
  `timeout-minutes`. The job has `timeout-minutes: 5` (HEL-1287). CI triggers only on `pull_request` and on pushes to
  main, and the concurrency group sets `cancel-in-progress` for PRs. Both match D4's premises.
- **Step timings** (`gh api .../runs/37361823617/attempts/4/jobs`, security job 111998385391): Set up job starts at
  22:01:35. SBOM starts at 22:02:23 (48 s of setup), SBOM takes 20 s (22:02:23→22:02:43), the backend chain after it
  takes about 2 s, the audits take about 1 s each, post-steps take 10 s (22:02:48→22:02:58), and the job totals
  83 s. All match the design.
- **Hung-run log** (`gh api --allow-escape-sequences .../jobs/111938037178/logs`, 441 lines): `sbt -batch
  generateSbom` starts at 19:20:04.8. Then "entering thin client - BEEP WHIRR" / "starting sbt server in the
  background", the welcome banner at 19:20:07, the project-definition load at 19:20:11, and "set current project to
  helio-backend" at 19:20:20.8. The next line is at 20:03:56.8: "The runner has received a shutdown signal", "The
  operation was canceled", "Terminate orphan process: pid (2615) (java)". Grepping for lock/resolve/download/OOM finds
  nothing inside the step. The sbt cache is an exact hit on `sbt-7ddfc283…`. Attempt 1 has 0 steps in the API.
  Attempts 2 and 3 have an empty `runner_name`, 0 steps, and about 15 min each between created and completed.
  Attempt 4 succeeded. Every factual claim in the design's log section holds.
- **Owner-cited masking runs**: in both 37396677223 (job 112059145702) and 37400422292 (job 112066252568),
  "Frontend audit (frontend/)" ends `failure`, "helio-mcp audit (helio-mcp/)" ends `skipped`, and the job ends
  `failure`. Confirmed.
- **D2 prerequisites**: `audit-ci` is a devDependency in the root `package.json:65` and in
  `frontend/package.json:53`, but not in helio-mcp. So frontend/ audit → root and frontend installs, and helio-mcp
  audit → root install. Both mappings are correct.
- **Actions semantics**:
  - `!cancelled()` skips on job-timeout or supersede cancellation, where `always()` would not. That is correct.
  - `steps.<id>.outcome` is the pre-`continue-on-error` result (success/failure/cancelled/skipped). A skipped
    upstream install yields `skipped`, so the outcome check is transitive, as D2 says.
  - A failed step without `continue-on-error` fixes the job conclusion at `failure` (D3). That is correct, and it is
    demonstrated by the cited runs, where the job is `failure` with later steps skipped.
  - A step-level timeout marks the step failed. It does not cancel the run, so `!cancelled()` steps still run.
    D4 tests this on a real run instead of assuming it, which is the right call.
- **D1 budget**: 48 s + 120 s + about 7.5 s kill grace + about 5 s of audits + 10 s of post-steps ≈ 3 min 10 s,
  which is under the 5 min job timeout. The bound is 6× the measured 20 s step. Sound.
- **D4 proof plan vs the ACs**: in the combined red run, the frontend/ audit (an earlier audit step) fails and the
  helio-mcp audit (a later one) must still run and print audit-ci output, with the job `failure`. That proves owner
  AC point "show on a run…". The 10-min `Thread.sleep` in `generateSbom` against a 2-min step bound and a 5-min job
  bound separates "the step timeout fired" (SBOM fails at about 2 min, audits run) from "the job timeout fired"
  (everything cancelled at 5 min). The revert run proves the all-pass scenario. The plan demonstrates both acceptance
  points. The sleep runs server-side behind the thin client, which is the same shape as the real hang. That is good
  fidelity.

### Verdict: REFUTE

### Change Requests

1. **The spec and design contradict each other on the backend SBOM scan chain, and the contradiction leaves a live
   masking path.** `specs/ci-security-job-reporting/spec.md` Requirement 1 lists "the backend SBOM scan chain" among
   the audit steps that "SHALL run whenever its own setup prerequisites succeeded and the run was not cancelled". The
   chain's own prerequisites are checkout, java, sbt and the sbt cache. design.md D2 keeps the chain on implicit
   `success()`, on the reasoning that it "is first after setup, so no other audit can mask it". But the chain is
   ordered *after* `npm ci` and `npm --prefix frontend ci` (ci.yml lines 280-281), and those steps are not its
   prerequisites. Under D2, a failed `npm --prefix frontend ci` (for example a registry flake) skips "Generate
   backend SBOM" and the whole osv/CVSS chain, even though every backend prerequisite succeeded. The implementation
   would then violate the spec's SHALL as written. That is also the exact "one failure hides another audit" pattern
   behind the owner's "every audit step reports on every run" addition, so an evaluator could not reconcile the two
   documents. Resolve it in the artifacts, and pick one of these options explicitly:
   - (a) Give the backend setup steps and the SBOM step ids. Then gate "Generate backend SBOM" on
     `!cancelled() && <java/sbt setup outcomes> == 'success'`, and gate each later chain step on
     `!cancelled() && steps.<previous chain step>.outcome == 'success'`. The implicit `success()` does not work for
     those later steps once an npm install has failed.
   - (b) Narrow Requirement 1 to the three npm audit steps, and record in design.md that a failed npm install
     knowingly suppresses the backend scan, with the reason that is acceptable against the owner's AC.

   Option (a) is what the owner's AC actually asks for. Either way, the spec's audit-step list, D2, and tasks 1.2/1.3
   must agree. If (a) is chosen, add a task, and add an expected-outcome line to D4 if the plan should exercise it.

### Non-blocking notes

- The design says the hung run's "The runner has received a shutdown signal" line was "the lane's cancel". The job's
  `completed_at` (20:03:53Z) comes just before the log line (20:03:56Z), which fits a cancel. But that message text
  usually appears when the runner service itself is stopped. Word it as "the cancel (or runner shutdown)" rather
  than asserting it was the lane's, since this is part of the cause record.
- D4 step 2(a) says to set `frontend/.audit-ci.jsonc` to `"moderate": true`. The file currently has
  `"high": true`. State that `high` is replaced, not added alongside it. Task 2.1's local run must show a genuine
  advisory failure, not a config error.
- D4 expects the helio-mcp audit to end `success`. The AC only needs it to *execute and report*. If a new moderate
  advisory lands in helio-mcp before the proof run, a `failure` with output still satisfies the AC. Don't treat that
  as a failed proof.
- The "A setup prerequisite fails" scenario is proved only by expression review, not on CI. That is acceptable for
  a non-AC scenario, but say so in ci-proof.md.
