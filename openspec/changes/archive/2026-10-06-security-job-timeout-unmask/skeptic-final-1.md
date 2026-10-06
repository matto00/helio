## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 9f1cb8e13dce7aa80c3d97c94186bc78b1b9e730 (local, unpushed; remote/PR #782 head is 65b09ffd1, draft).
Review base: `resolve-review-base.sh` gave e043566d1a0534c5aa98085dfa2b94431775ad28 (exit 0).

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` gave `READY ambient=/home/matt/Development/helio branch=task/security-job-timeout-unmask/HEL-1296`.

**Diff scope (`git diff e043566d1...HEAD`).**
- Only `.github/workflows/ci.yml` outside the change dir. All ci.yml hunks fall inside the `security:` job, in lines 245–392. There are no e2e-job hunks.
- `git diff e043566d1 HEAD --stat -- backend frontend helio-mcp e2e playwright.config.ts .gitignore` is empty.
- `git diff e043566d1 origin/main -- .github` is empty. Main moved (HEL-1300, HEL-1292) but did not touch ci.yml. `git merge-tree origin/main HEAD` merges cleanly.

**Throwaway reverted.**
- 5ef060b57 touched only `backend/build.sbt` (`Thread.sleep(600000)`) and `frontend/.audit-ci.jsonc` (`high` changed to `moderate`).
- `git diff 9b1df7cda 65b09ffd1` is empty, so the trees are identical.
- `git diff 9b1df7cda HEAD` touches only ci-proof.md and tasks.md.

**Workflow validity.**
- A YAML parse lists every security step's `if`. Only checkout, setup-java, setup-sbt and Cache sbt use implicit `success()`.
- `timeout-minutes: 2` is set only on the SBOM step. The job keeps `timeout-minutes: 5`.
- There is no `continue-on-error` anywhere in ci.yml (grep count 0).
- actionlint 1.7.12 (scratchpad binary) exits 0, re-run by me.

**AC1: step timeout.** ci.yml security job: `sbom` step has `timeout-minutes: 2` and the job has 5. Proven on CI below.

**Scope-addition AC: every audit reports, job still fails.** I checked this via `gh api`, not ci-proof.md.
- Run 37430487422: head_sha 5ef060b57e48…, attempt 1, conclusion failure.
- Security job 112159948344 step conclusions:
  - SBOM: failure, 07:34:50 to 07:37:03 (133 s).
  - positive control, osv install, osv scan, CVSS: skipped.
  - Frontend audit (root): success.
  - Frontend audit (frontend/): failure.
  - helio-mcp audit: success, 07:37:05.
  - Job conclusion: failure, total 2 min 49 s.
- Job log, which I fetched myself:
  - L447: `##[error]The action 'Generate backend SBOM' has timed out after 2 minutes.`
  - L1402: `Failed security audit due to moderate vulnerabilities.`
  - L1482: `exit code 1`
  - L1483: `Run npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`
  - L1513: `Passed npm security audit.`
- So a later audit executed and reported after an earlier one failed. That is exactly the owner's required demonstration, and it also proves a step timeout does not count as `cancelled()`.

**Final-head run 37432926643** (head_sha 65b09ffd1beebef8…, matches PR head).
- Security job 112167785314: success. All 16 steps succeeded, including SBOM (20 s) and all three audits.
- Run conclusion is failure, from `backend (0)` (job 112167785535) and ci-complete.

**backend (0) failure: not attributable to this change.**
- Log: `ConnectorRepositorySpec … rotateCredential - should replaces the plaintext … *** FAILED ***`, `Some(ConnectorCredentialMeta(…)) was not equal to None (ConnectorRepositorySpec.scala:423)`, `succeeded 1264, failed 1`.
- Root cause from the code: `ConnectorRepository.rotateCredential` (backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorRepository.scala:216ff) deletes the OLD credential fire-and-forget. It calls `existing.credentialId.foreach(old => credentialRepo.delete(old, user.id).recover…)` and does not sequence it before returning `Right`. The spec then immediately asserts `credentialRepo.get(oldCredentialId) shouldBe None`. That is a race, so the test is timing-flaky by construction.
- This branch has zero backend diff vs base. The same test passed in backend (0) on red run 37430487422. The change only alters `if:`/`id:`/`timeout-minutes` keys in the security job, which cannot affect a backend-shard test.

**AC2: cause analysis honesty.** I checked every claim in design.md myself via `gh api` against job 111938037178 and its log:
- attempt 1, conclusion cancelled, `steps` length 0.
- Timeline and log lines, all matching design.md:
  - 19:20:04 thin client "BEEP WHIRR" and server in the background.
  - 19:20:07 welcome.
  - 19:20:11 loading project.
  - 19:20:20 "set current project".
  - Then nothing until 20:03:56, "runner has received a shutdown signal" / "operation was canceled".
  - Orphan java pid 2615 terminated.
  - completed_at 20:03:53Z.
- The sbt cache hit is `sbt-7ddfc283…`, the same key as passing attempt 4 (job 111998385391), confirmed in that job's log.
- Attempts 2 and 3 (111962099406 and 111972572841): empty runner_name, 0 steps, cancelled after about 15 min.
- The log has no lock, resolution or OOM lines.
- design.md says explicitly that the log cannot tell an outage network stall from a thin-client/server stall, and records the cause as "consistent with the outage, not proven". It does not overclaim.

**AC3: HEL-1287 coordination / security-only.** Satisfied, as above. The job-level timeout is unchanged; only its comment was updated.

**Gate-defect check (CON-160).** No load-bearing mtime-ordering evidence is used in this review or accepted from upstream reports. All evidence comes from the GitHub API and git content diffs.

### Verdict: CONFIRM

### Non-blocking notes
- `ConnectorRepositorySpec` rotateCredential is a pre-existing race between the un-awaited old-credential delete and the spec's immediate `get`. The Delivery squash push's full CI run can hit it again. If it does, re-running the failed backend shard is legitimate. It should also get its own follow-up ticket: await the delete, or make the assertion eventually-consistent. It is not this change's defect.
- `openspec/changes/security-job-timeout-unmask/evaluation-1.md` is untracked in the worktree. The orchestrator should commit it with the delivery artifacts if that is the convention.
- When setup prerequisites fail (an install fails, so its audit is skipped and the job fails), correctness rests on expression review only. ci-proof.md discloses this honestly. The logic is simple and actionlint-clean.
