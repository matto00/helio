## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `9f1cb8e13dce7aa80c3d97c94186bc78b1b9e730` (local, deliberately unpushed; PR #782 head is
`65b09ffd1`, and the only difference is openspec-only: `ci-proof.md` plus `tasks.md`).
Diff base was resolved live with `resolve-review-base.sh` and is the merge-base `e043566d1`. `origin/main`
(`90f8a949c`) has not touched `.github/workflows/ci.yml` since that base.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (step timeout): "Generate backend SBOM" has `timeout-minutes: 2`. The job keeps `timeout-minutes: 5` and its
  comment is updated. This matches D1.
- AC2 (cause investigation): design.md records the hung run's log timeline and a hedged conclusion ("consistent
  with the outage, not proven"). That conclusion matches what the log can support.
- AC3 (coordinate with HEL-1287): the ci.yml diff has four hunks, all inside `security:` (lines 245–392). There is
  no backend-job or e2e-job hunk. `git diff --name-only e043566d1...HEAD` shows no `playwright.config.ts`, no
  `e2e/**` and no `.gitignore`.
- Scope addition (unmask the audits): each audit and chain step has
  `if: ${{ !cancelled() && steps.<prereq>.outcome == 'success' }}`, with exactly the D2 prerequisites:
  - setup-node depends on checkout.
  - Both npm installs depend on setup-node, so npm-ci-frontend does not depend on npm-ci-root.
  - sbom depends on setup-java and setup-sbt.
  - sbom-control depends on sbom, osv-install on sbom-control, osv-scan on osv-install, and CVSS on osv-scan.
  - The root audit depends on npm-ci-root.
  - The frontend/ audit depends on npm-ci-frontend only.
  - The helio-mcp audit depends on npm-ci-root.

  Only checkout, setup-java, setup-sbt and Cache sbt keep implicit `success()`, as D2 states. Every referenced id
  is declared (checked with a YAML parse). There is no `continue-on-error` anywhere, which satisfies D3.
- All 10 tasks are marked done and match the diff. The planning artifacts reflect the final behaviour.
- `workflow-state.md` CONSTRAINTS is `[]`, so there is nothing more to honour.

### Phase 2: Code Review — PASS
Issues: none.

Gates. The changed files match neither `frontend/**` nor `backend/**`, so the npm and sbt gates do not apply. I ran
these instead:
- actionlint v1.7.12, downloaded fresh to the scratchpad, on `.github/workflows/ci.yml`: exit 0.
- Prettier `--check` on ci.yml and every changed openspec md/yaml file: all formatted.

Throwaway fully reverted:
- `git diff 9b1df7cda HEAD -- . ':!openspec'` is empty, so the final tree equals the real-change commit for every
  non-openspec file.
- The throwaway `5ef060b57` touched only `backend/build.sbt` (+`Thread.sleep(600000)`) and
  `frontend/.audit-ci.jsonc` (high to moderate). `65b09ffd1` reverts both.
- `git diff e043566d1 65b09ffd1 -- backend` is empty.

CI evidence, verified independently with `gh api repos/matto00/helio/actions/...`:
- **Red run 37430487422.** Head `5ef060b57`, PR #782, attempt 1, conclusion `failure`. Security job 112159948344
  ran 07:34:18Z to 07:37:07Z, conclusion `failure`.
  - Step API: SBOM `failure` (07:34:50 to 07:37:03). The positive control, osv-install, osv-scan and CVSS steps are
    `skipped`. The root audit is `success`, the frontend/ audit `failure`, and the helio-mcp audit `success`.
  - Log, line 447: `##[error]The action 'Generate backend SBOM' has timed out after 2 minutes.`
  - Log, line 1402: `Failed security audit due to moderate vulnerabilities.`, then `Process completed with exit
    code 1.`
  - Log, lines 1483–1513: `Run npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`, with a
    summary (`"moderate": 0`) and `Passed npm security audit.`
  - Conclusion: the earlier audit failed, the later audit executed and reported, and the job failed. The step
    timeout fired at 2 min and the job finished at about 2m49s, inside 5 min.
- **Final-head run 37432926643.** Head `65b09ffd1`. Security job 112167785314 is `success`, and every step,
  including all chain steps and all three audits, is `success`. This proves the "all audits pass" scenario.
- ci-proof.md's tables and quotes match the API and log data.

Attribution of the final-head `backend (0)` failure (job 112167785535): it is not attributable to this change.
- The failing test is ConnectorRepositorySpec, `rotateCredential` "replaces the plaintext ... makes the old
  credential id unresolvable". The failure is `Some(ConnectorCredentialMeta(...)) was not equal to None`
  (ConnectorRepositorySpec.scala:423). The suite result was 1264 succeeded, 1 failed.
- `git diff e043566d1 65b09ffd1 -- backend` is empty, so the backend code on this head is byte-identical to the
  merge-base. On the red-run head, whose only backend difference is a `Thread.sleep` inside the `generateSbom` task
  body (not run by the test task), `backend (0)` (job 112159948696) passed with 1265 succeeded and 0 failed.
  `ci.yml`'s backend job is untouched by this diff.
- Probable root cause, read from code but not probe-confirmed:
  - `ConnectorRepository.scala`, in `rotateCredential`, deletes the OLD credential fire-and-forget:
    `existing.credentialId.foreach(old => credentialRepo.delete(old, user.id).recover { case _ => false })`. It does
    not await that delete before returning `Right(...)`.
  - The spec then asserts `credentialRepo.get(oldCredentialId.get, owner) shouldBe None` immediately.
  - That is a race that already exists on main and is timing-dependent. It is consistent with flaking under the
    sharded or forked backend CI from HEL-1287.

### Phase 3: UI Review — N/A
This is a CI workflow and openspec change only. It touches no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or
`openspec/specs/**`, and no dev servers were started.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- File a spinoff bug for the `rotateCredential` flake. The un-awaited old-credential delete in
  `backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorRepository.scala`
  (`rotateCredential`) races the spec's immediate `shouldBe None` at `ConnectorRepositorySpec.scala:423`. The
  options are to await the delete (still best-effort via `recover`) before returning, or to use `eventually` in the
  test. It is outside this ticket's scope. The PR's `ci-complete` will need a green backend run before merge, either
  a re-run or the next push.
- The follow-ups in design.md (timeouts on the osv-scanner download and scan steps, and investigating sbt
  thin-client mode in CI) are worth filing so they are not lost.
