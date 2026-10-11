## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `a0ab703c62ce7aadf74a4864d66ffccc35e8a56e` against the live-resolved base `e56d94b107acfc72ac100803c9b26fa471ac3ad9` (from `resolve-review-base.sh`, exit 0). cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/ci-parity-yaml-needs/HEL-1462`.

### What I verified (with evidence)

I ran everything below myself. Mutations were done on temp copies under `.hel1462-scratch/skeptic/`; the real ci.yml was not edited. Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1462/evidence/.hel1462-scratch/skeptic/skeptic-mutations.txt`.

- **AC1 (structural parse, fail-closed).** I read the full diff. `parseCiCompleteNeeds` and `extractJobBlocks` (the regex code) are deleted. Parity now imports `readCiTopology`, `jobRunCommands` and the token extractors from `check-ci-complete-needs.mjs`, so one parser reads ci.yml. Any topology error, or a `steps` that is not a list, is returned as an error. It never becomes an empty covered set. Ad-hoc probes against HEAD:
  - A decoy inside a quoted string (`name: "needs: [frontend, backend]"`) is detected.
  - An anchor elsewhere in the file listing all jobs does not stand in for the real list.
  - A real `needs: *alias` resolves correctly. GitHub resolves aliases the same way, so this is not a bypass.
- **AC2 (red-first).** I copied the new selftests next to the base-commit implementations (`git show e56d94b10:...`).
  - Parity selftest: 7/14 fail on the old code, including `(f)` comment decoy ("no errors — check passed") and `(k)` command named only in a comment.
  - Needs-guard selftest: the 4 new anchor cases fail on the old code.
  - Both pass on HEAD: parity 14/14, needs-guard "all passed".
- **Defect 1 is red now.** I put a decoy comment `# needs: [frontend, ...]` above a real `needs` with `frontend` dropped, on the base ci.yml. The OLD parity exits **0**. The same mutation on HEAD: parity exits **1** (27 scripts uncovered) and the guard exits **1** (`job "frontend" is missing`).
- **Defect 2 / AC3.** I dropped `frontend` from needs on HEAD's ci.yml, and `node scripts/check-ci-complete-needs.mjs <copy>` exits **1** naming `frontend`. In ci.yml at HEAD, `ci-complete` runs checkout, setup-node, root `npm ci`, then `npm run check:ci-complete-needs`. These steps have no step-level `if:` and sit after the unchanged results step. `frontend` dropped only its non-selftest guard step. Root `package.json` has `js-yaml` 4.3.2 as a devDependency. The `npm ci`/setup-node shape mirrors the `frontend` job.
- **Removing the guard step and dropping frontend in one edit:** the guard exits 1 with both errors, and parity exits 1.
- **No behaviour change in check-ci-complete-needs beyond D5.** I compared the base function line by line with `readCiTopology` + `checkCiCompleteNeeds`:
  - Same structural early returns, error strings, and needs-entry and missing-job errors.
  - The only addition is the self-anchor, which runs after the structural early return.
  - `main()` is unchanged. Its closing remediation hint still says "Add every job to needs", even when the failure is the anchor. That is cosmetic.
- **AC4 (hook).** On the clean HEAD tree, `nice -n 19 sh .husky/pre-commit` exits **0**: jest 525 suites / 5669 tests passed, plus 46/447. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1462/evidence/.hel1462-scratch/skeptic/hook-clean.log`. With m1, m2, or the guard step removed, the hook-invoked guard exits 1 (above). `.husky/pre-commit` is unchanged. The evaluator says gate-chain isolation evidence exists. I did not re-run `assert-phase.sh delivery`, because the orchestrator owns that at delivery.
- **Fixture edit, case (e).** The base fixture interpolated a literal `undefined` under `steps:`, which is invalid YAML. The edit is a correction, not masking: the assertion pattern is unchanged.

### Verdict: CONFIRM

### Non-blocking notes
- **Neutering residual, a follow-up candidate.** Adding `if: false` or `continue-on-error: true` to the guard step in `ci-complete` leaves **both** the guard and parity green (my mutations `ifalse` and `coe`: exit 0/0). The same applies to `|| true` inside the run string, or `continue-on-error` at job level on `ci-complete`.
  - Design Risks says these are "caught only by the hook". That is slightly overstated: the hook does not catch the neutering edit itself. It only catches a later `frontend` drop locally.
  - This is not a regression (the old `frontend`-hosted step had the same weakness), and the design gate accepted it as out of scope.
  - Cheap follow-up: make the D5 anchor reject a step-level `if`/`continue-on-error` on the guard step and a job-level `continue-on-error` on `ci-complete`.
- **Pre-existing parity gap.** A needed job with job-level `if: false` still counts as coverage (probe `jobIfFalse`: no errors). Skipped jobs pass `ci-complete`. The base code had the same gap, and it is outside this ticket.
- The `ci-complete` duration with the new checkout and `npm ci` steps is unmeasured, and the first run will miss the cache (root-lockfile-only key). Record the measured time in the PR body, as D4 says.
- Remove `.hel1462-scratch/` (including my `skeptic/` subdir) before squash/push. It is untracked and not ignored.
