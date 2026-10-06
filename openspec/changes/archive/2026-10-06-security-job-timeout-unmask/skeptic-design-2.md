## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD e043566d1a0534c5aa98085dfa2b94431775ad28. The change dir is untracked and nothing is committed yet.
I read ticket.md, proposal.md, design.md, tasks.md, specs/ci-security-job-reporting/spec.md, skeptic-design-1.md, and
`.github/workflows/ci.yml` lines 240-366 in the worktree.

### What I verified (with evidence)

- **The step order is real.** In `gh api repos/matto00/helio/actions/runs/37361823617/attempts/4/jobs`, the security
  job's steps run: 2 checkout, 3 setup-java, 4 setup-sbt, 5 Cache sbt, 6 setup-node, 7 `npm ci`, 8
  `npm --prefix frontend ci`, 9 SBOM, 10 positive control, 11 osv install, 12 scan, 13 CVSS, 14 root audit, 15
  frontend/ audit, 16 helio-mcp audit. This matches ci.yml lines 252-366. No step has an `id`, `if` or
  `timeout-minutes` today. The job has `timeout-minutes: 5`.
- **Round-1 CR1 is resolved by option (a).**
  - The spec's Requirement 1 still lists the backend chain as an audit.
  - The spec now has a scenario "An npm install fails but the backend scan's prerequisites succeed".
  - D2 gates "Generate backend SBOM" on `!cancelled() && setup-java/setup-sbt outcome == 'success'`, and gates each
    later chain step on the previous chain step's outcome.
  - Tasks 1.2 and 1.3 add the ids and conditions.

  A failed `npm ci` or `npm --prefix frontend ci` no longer skips the backend scan. The spec, design and tasks now
  agree on this direction.
- **The backend chain's own gating is sound.**
  - SBOM → setup-java and setup-sbt. Checkout is covered transitively: if checkout fails, setup-java is skipped by
    implicit `success()`, so its outcome is `skipped`.
  - Leaving the sbt cache out of the prerequisites is a reasonable call.
  - positive control → `sbom`, osv install → `sbom-control`, scan → `osv-install`, CVSS → `osv-scan`. Every
    downstream step needs the SBOM artifact, so chaining them is correct.
  - osv install does not strictly need `sbom-control`, but skipping it when there is no valid SBOM to scan does no
    harm.
- **The npm audits' named prerequisites are correct.** Root audit → `npm-ci-root`. frontend/ audit →
  `npm-ci-root` + `npm-ci-frontend` (audit-ci is a devDependency of both root and frontend). helio-mcp audit →
  `npm-ci-root`. setup-node is covered transitively through `npm ci`.
- **D3: the job still fails.** No `continue-on-error` is added, so a failed step fixes the job conclusion at
  `failure`. The owner-cited runs 37396677223 and 37400422292 already show this (round 1 verified it), and D4 proves
  it again.
- **D4 still demonstrates both acceptance points.**
  - Timeout: a 10-min sleep against a 2-min step bound and a 5-min job bound separates "the step timeout fired"
    from "the job timeout fired".
  - Unmasking: the frontend/ audit fails, and the helio-mcp audit must still execute and print output, with the job
    ending `failure`.
  - The revert run covers the all-pass scenario.
  - D4 tests on real CI whether a step timeout leaves `!cancelled()` true, instead of assuming it. That is the
    right call.
  - Recording the npm-install-fails/backend-runs scenario as expression-review only is acceptable and disclosed.
- **Round-1 non-blocking notes are folded in.** The cancel is now worded as "the cancel (or a runner shutdown)",
  `high` is *replaced* with `moderate`, a helio-mcp `failure` that prints output counts as success, and the
  expression-review-only scenarios are disclosed in ci-proof.md.
- **The D1 budget holds.** 48 s + 120 s + kill grace + about 5 s + about 10 s post-steps is about 3 min 10 s, under 5 min.

### Verdict: REFUTE

### Change Requests

1. **The mirror image of round-1 CR1 is still open. A failed backend toolchain setup masks all three npm audits,
   because the node/npm setup steps stay on implicit `success()`.**
   - D2's "Transitivity" paragraph says "The setup steps themselves keep implicit `success()`". In the real step order
     (ci.yml lines 253-281, confirmed by the step list above), `actions/setup-java`, `sbt/setup-sbt` and "Cache sbt"
     all run **before** `actions/setup-node`, `npm ci` and `npm --prefix frontend ci`.
   - Under D2, if `setup-java` fails (for example a Temurin download flake, the same class of outage this ticket was
     born from), `setup-sbt` or the sbt cache step fails, then setup-node, `npm ci` and `npm --prefix frontend ci` are
     all skipped by implicit `success()`. Their outcome is `skipped`, so all three npm audits are skipped too, even
     though none of them depends on Java or sbt.
   - That is exactly the pattern the owner's scope addition forbids: an unrelated failure hides other audits. "Every
     audit step reports on every run" does not hold for this path. It is also the same defect class round 1 refuted,
     just with the direction reversed (round 1: npm setup masked the backend scan).
   - The spec's wording hides the gap rather than covering it. "SHALL run whenever its own setup prerequisites
     succeeded" is satisfied vacuously, because `npm ci` did not succeed. But it was skipped only for an unrelated
     reason, so the implementation would pass a literal reading while still masking.

   **Required revision.** In design.md D2, tasks.md and spec.md:
   - Give `actions/checkout` an id (for example `checkout`) and `actions/setup-node` an id (for example `setup-node`).
   - Gate setup-node on `${{ !cancelled() && steps.checkout.outcome == 'success' }}`.
   - Gate `npm ci` (`npm-ci-root`) on `steps.setup-node.outcome == 'success'`.
   - Gate `npm --prefix frontend ci` (`npm-ci-frontend`) on `steps.npm-ci-root.outcome == 'success'`, each with
     `!cancelled()`.
   - Replace the "setup steps keep implicit `success()`" sentence. It should say which steps stay on implicit
     `success()` and why that is safe: setup-java, setup-sbt and the sbt cache, which only gate the backend chain.
   - Add the mirror scenario to the spec: "WHEN a java/sbt setup or sbt cache step fails while setup-node and the npm
     installs succeed, THEN the three npm audits still run and report, AND the job is `failure`".
   - Add the ids and conditions to task 1.2 and task 1.4.
   - List this scenario among the expression-review-only cases in D4 and ci-proof.md, unless the executor chooses to
     exercise it.

   Reordering the node/npm setup ahead of java/sbt does **not** fix this, because a node failure would then mask the
   backend chain. Reordering is also against D2's no-reorder non-goal. The explicit outcome gating is the fix.

### Non-blocking notes

- The D4 throwaway changes `backend/build.sbt`, which is the security job's sbt cache key (`hashFiles('**/build.sbt')`).
  If other jobs key their caches on build.sbt the same way, the red run may save a short-lived cache entry under the
  throwaway hash. That is harmless, but the executor should not misread a restore-key (partial) hit in the revert run
  as a regression.
- The red run proves the unmasking with two earlier failures in front of the helio-mcp audit (the SBOM timeout and
  the frontend/ audit). That is a strictly stronger demonstration than the AC needs, and it is fine. ci-proof.md
  should still quote the helio-mcp step's audit-ci output lines, not just its conclusion.
