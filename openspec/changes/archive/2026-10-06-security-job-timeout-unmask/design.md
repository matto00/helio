## Context

The `security` job (`.github/workflows/ci.yml` lines 246–366 on e043566d) runs these steps in order: setup
(checkout, java, sbt, sbt cache, node, `npm ci`, `npm --prefix frontend ci`), then the backend chain (Generate SBOM →
positive control → install osv-scanner → scan → CVSS gate), then three npm audits (root, frontend/, helio-mcp).
Every step uses the implicit `if: success()`, so the first failure skips everything after it. HEL-1287 set the
job-level `timeout-minutes: 5` and left step-level timeouts to this ticket. No step declares one today.

Measured timings (run 37361823617 attempt 4, the passing security job 111998385391): setup takes 48 s,
"Generate backend SBOM" 20 s (sbt reports "elapsed time: 3 s"), the backend chain after the SBOM about 2 s, the three
audits about 1 s each, and post-steps about 10 s. The job total is 83 s.

### What the hung run's log shows (job 111938037178, run 37361823617 attempt 1)

- 19:20:04Z — the step starts. sbt 2.0.9 prints "entering thin client - BEEP WHIRR" / "starting sbt server in the
  background".
- 19:20:07Z — welcome banner. 19:20:11Z — loading the project definition. 19:20:20Z — "set current project to
  helio-backend".
- 19:20:20Z → 20:03:56Z — no output at all for 43.5 min.
- 20:03:56Z — "The runner has received a shutdown signal" / "The operation was canceled". This is the cancel (or a
  runner shutdown; the message text cannot tell them apart). The job's `completed_at` is 20:03:53Z. The orphaned
  java pid 2615 (the background sbt server) is terminated.
- There is no resolution, download, lock ("waiting for lock"), network or OOM message. The sbt cache was an exact-key
  hit (`sbt-7ddfc283…`), the same key as the passing attempt 4, so cache state is not the difference.
- The API records this job with zero steps. Attempts 2 and 3 (jobs 111962099406 / 111972572841) never got a runner
  (empty `runner_name`, 0 steps, log blob 404). Each was cancelled after about 15 min in the queue. Attempt 4 at
  22:01Z passed normally.

**Cause assessment:** the hang came after project load, inside `generateSbom`'s only work: resolving
`Compile / externalDependencyClasspath` and writing a file. The output is silent because the thin client prints
nothing while the background server works. Attempts 2–3 could not get a runner at all, and attempt 1 has missing job
metadata. That evidence favours the 2026-10-05 Actions outage, consistent with a network or IO stall during
resolution that has no timeout surfacing in sbt/Coursier's output. A lock is unlikely: there is no "waiting for lock"
line, and the runner is fresh. **The log cannot distinguish an outage-induced network stall from a thin-client/server
handshake stall.** Recorded as "consistent with the outage, not proven". The step timeout below bounds both causes,
whichever it was.

## Goals / Non-Goals

**Goals:** a hung SBOM step fails in minutes; one failing audit never hides another; the job still fails on any
failure.
**Non-Goals:** see proposal.md. Also: no edits outside the `security` job's step list, and no step reordering
(minimal diff, and the e2e job hunks of PR #774 stay untouched).

## Decisions

**D1 — Step timeout on "Generate backend SBOM": `timeout-minutes: 2`.** That is 6× the measured 20 s step. A
cold-ish cache after a `build.sbt` change still restores via `restore-keys: sbt-` and downloads only the delta.
Budget check against the unchanged 5-min job timeout: 48 s setup + 120 s worst-case SBOM + about 5 s of remaining
audits + about 10 s of post-steps ≈ 3 min 3 s, which leaves about 2 min of headroom. The npm audits after a timed-out
SBOM step therefore still run inside the job timeout. Alternatives: 3 min (the margin shrinks to about 1 min with
runner jitter); raising the job timeout (HEL-1287 owns that number, and D1 makes it unnecessary). The job-level
`timeout-minutes: 5` stays. Its comment is updated to say the step-level timeouts now exist.

**D2: unmask every audit with `!cancelled()` plus each audit's own prerequisites, not bare `always()`.** There are
four independent audits: the backend SBOM scan chain, the root, frontend/ and helio-mcp npm audits. Each one gets an
`if: ${{ !cancelled() && ... }}` that names only the steps it actually depends on, via new step ids:
- **Backend chain.** "Generate backend SBOM" (id `sbom`) runs when `steps.setup-java.outcome == 'success' &&
  steps.setup-sbt.outcome == 'success'`. The new ids go on `actions/setup-java` and `sbt/setup-sbt`. The sbt cache is
  deliberately not a prerequisite, because a failed restore still leaves sbt usable. The later chain steps each
  depend on the previous chain step's outcome, so implicit `success()` no longer applies to them:
  - "Backend SBOM positive control" (id `sbom-control`) depends on `sbom`.
  - "Install osv-scanner" (id `osv-install`) depends on `sbom-control`.
  - "Scan backend SBOM" (id `osv-scan`) depends on `osv-install`.
  - "Enforce backend CVSS >= 7 threshold" depends on `osv-scan`.

  This closes the path the design-gate skeptic found (round 1): today, a failed `npm ci` or `npm --prefix frontend
  ci` would skip the whole backend scan, because those installs are ordered before it although they are not its
  prerequisites.
- **"Frontend audit (root)"**: root `npm ci` (id `npm-ci-root`).
- **"Frontend audit (frontend/)"**: `npm --prefix frontend ci` (id `npm-ci-frontend`) **only**. It runs `npx audit-ci`
  from `frontend/`, which resolves the frontend-local devDependency. The frontend install has no install/prepare
  scripts and no `file:`/workspace links to the root, so it uses nothing the root install produces (design round 3).
- **"helio-mcp audit (helio-mcp/)"**: `npm-ci-root` only. The root-pinned audit-ci reads helio-mcp's lockfile, per
  the HEL-1204 comment.

**Why `!cancelled()` and not `always()`.** `always()` also runs on a cancelled run (a job timeout or a superseding
push), which wastes time on a run nobody will read.

**Why the outcome checks.** Without them, a failed install would make `npx audit-ci` silently download an unpinned
audit-ci, or fail confusingly. A failed java/sbt setup would run sbt against a missing toolchain. Requiring
`outcome == 'success'` keeps those cases "skipped, job already failed".

**The node/npm setup is gated as well (design round 2).** `actions/setup-java`, `sbt/setup-sbt` and "Cache sbt" all run
*before* `actions/setup-node` and the npm installs. Under implicit `success()`, a Java/sbt setup failure would
therefore skip setup-node, both installs, and every npm audit. That is the mirror image of round 1. So:
- `actions/checkout` gets id `checkout`.
- `actions/setup-node` gets id `setup-node`, with `if: ${{ !cancelled() && steps.checkout.outcome == 'success' }}`.
- `npm ci` (`npm-ci-root`) gets `if: ${{ !cancelled() && steps.setup-node.outcome == 'success' }}`.
- `npm --prefix frontend ci` (`npm-ci-frontend`) gets `if: ${{ !cancelled() && steps.setup-node.outcome ==
  'success' }}`. It is gated on setup-node, not on the root install, so a root-only `npm ci` failure (lockfile drift,
  a husky `prepare` failure) cannot mask the frontend/ audit (design round 3).

**Which steps stay on implicit `success()`, and why that is safe.** Only `actions/checkout` (first, nothing to
mask), `setup-java`, `setup-sbt` and "Cache sbt". These three come after checkout and before node, so the only thing
that can skip them is a checkout failure, which every audit genuinely needs. They also gate only the backend chain.
A failure in any of them leaves the node/npm path intact, because that path is gated on `checkout` and its own
steps, not on implicit `success()`.

**Transitivity.** A checkout failure gives every downstream outcome check a `skipped` or `failure` prerequisite, so
every audit is skipped and the job fails.

**D3 — Job still fails.** In GitHub Actions, a failed step with no `continue-on-error` sets the job conclusion to
`failure`, whatever later steps do. No `continue-on-error` is added anywhere, and `ci-complete` already fails on a
`failure` result. This is proved on the red run (D4), not assumed.

**D4 — Proof by one combined throwaway CI run, then a clean run.** CI triggers only on `pull_request` (and on pushes
to main), so the branch is opened as a **draft PR** during Execution. The sequence is:
1. Commit the real change.
2. Make one throwaway commit with two deliberate breaks: (a) in `frontend/.audit-ci.jsonc`, **replace** `"high": true`
   with `"moderate": true`. The frontend tree carries real moderate advisories (HEL-1320), so this is a genuine audit
   failure. Verify that locally first with a project-local npm cache, and check that the failure is an advisory
   failure, not a config error. (b) A `Thread.sleep` of about 10 min inside `generateSbom` in
   `backend/build.sbt`, which is a real hang inside the real step command.
3. Push and wait for the run to **complete**. A new push supersedes it, because the concurrency group has
   `cancel-in-progress` set for PRs.
4. Expected outcome:
   - The SBOM step ends `failure` at about 2 min (timeout).
   - The positive control, osv install, scan and CVSS steps are `skipped` (the chain gating works).
   - The root audit succeeds and the frontend/ audit fails.
   - The helio-mcp audit **executes, with its audit-ci output in the log**. Its conclusion is `success` if helio-mcp
     is still clean. A `failure` that still prints audit output also satisfies the AC, because the AC asks that it
     run and report, not that it pass.
   - The job ends `failure`, with a total well under 5 min.
5. Revert the throwaway with `git revert`, push, and wait for the green run on that head.

Both run ids and step conclusions are recorded in the evidence. Some cases are proved only by expression review, not
on CI, and `ci-proof.md` says so: the "setup prerequisite fails" scenario, and the backend chain running after a
failed npm install, and the npm audits running after a failed java/sbt setup (round 2 scenario), and the frontend/ audit running after a failed root `npm ci` (round 3 scenario). Only one CI run is in flight at a time. The
throwaway touches files outside `ci.yml`. This is allowed because it is reverted, and the Delivery squash removes it
from history.

## Gate-Chain Implications Checklist

Not applicable. The change touches no `.husky/**` file and no script the pre-commit hook invokes.

## Risks / Trade-offs

- [Risk] 2 min is too tight after a large dependency change → Mitigation: the step fails loudly with a clear
  timeout, and a re-run uses the now-populated cache. Raise the bound if this is observed.
- [Risk] The throwaway red run never completes because of a runner outage → Mitigation: re-run it. It is not a code
  problem.
- [Risk] The Delivery squash force-pushes over the draft PR's branch → expected. The run ids stay attached to their
  SHAs on GitHub.

## Planner Notes

- Self-approved: `timeout-minutes: 2` (D1); `!cancelled()` plus outcome checks on all four audits, incl. backend chain gating (D2, after design round 1 option (a)) node/npm setup gating (design round 2), and frontend install/audit independent of root install (design round 3); a draft PR during Execution
  for the proof (D4).
- Follow-ups (noted, not filed): the osv-scanner `curl` download and the `osv-scanner scan` step have no timeouts
  either; it is unclear whether sbt 2's thin-client mode in CI is desirable (`sbt --client=false`/`-Dsbt.server.forcestart`
  investigation); a hang diagnostic (jstack of the sbt server on timeout).
