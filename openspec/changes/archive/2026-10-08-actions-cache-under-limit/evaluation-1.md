## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `fa86475f2b571223b71f866108d124483c875b0f` (branch `task/actions-cache-under-limit/HEL-1299`).
Diff base: `2dd4ed6237817b1feef22d69f8bc8058e58541db`, resolved live by `resolve-review-base.sh`.
Changed code: `.github/workflows/{ci,cd-frontend,cache-janitor,cache-cleanup-pr}.yml`, `scripts/ci-prune-sbt-cas.sh`,
`scripts/cache-janitor.mjs`, `scripts/check-cache-cleanup-pr.mjs`, three `*.selftest.mjs` files, and `package.json` (scripts only).
No lockfile changed.

### Phase 1: Spec Review — PASS
- AC1, AC2 and AC5 are explicitly deferred to driver-run post-merge measurement, following the HEL-1287/1288 precedent. This is
  stated in proposal.md ("Post-merge acceptance") and accepted at the design gate. The exact commands are in
  `post-merge-measurement.md`, so the deferral is declared and not a silent reinterpretation.
- AC3 is demonstrated on PR #860. Commit 7ac2dcec changed `backend/build.sbt`, and `ac3-pr860-cache-listing.txt` shows only a
  51 KB setup-sbt entry under `refs/pull/860/merge` (no `sbt-*` and no `backend-compile-*`). Both temporary commits are
  reverted. I confirmed that the diff against base touches nothing under `backend/`.
- AC4: CodeQL default setup is unchanged. The PR's checks still show Analyze (actions / javascript-typescript / python).
- All tasks are ticked and match the diff. I found no scope creep.
- C1 is honoured: the prune ran only in PR CI. The local run was `report` mode, which deletes nothing and writes only a mktemp
  dir. C2 is honoured: S ≈ 275 MB and the projection is ≈ 2.1 GB. Leg 3 on attempt 1 was +31 s / +17%, which crosses the C2
  line. It was re-run under skeptic-design-3's explicit "re-run before treating it as a real regression" note and disclosed
  transparently in `ci-evidence-pr860.md`.
- The spec delta (`specs/ci-actions-cache-budget/spec.md`) matches the implemented behaviour.

### Phase 2: Code Review — FAIL

Gates I re-ran myself in WORKTREE_PATH:
- `frontend/**` and `backend/**` are not touched, so the ticket gates `npm test`, the frontend build and `sbt testFull` are not triggered.
- I ran the gates relevant to this diff:
  - `npm run lint`: rc 0
  - `npm run format:check`: rc 0
  - `npm run selftest:cache-janitor`: pass
  - `npm run selftest:ci-prune-sbt-cas`: pass
  - `npm run check:cache-cleanup-pr`: pass
  - `npm run check:cache-cleanup-pr:selftest`: pass
  - `npm run check:precommit-ci-parity`: OK
  - All four touched workflows parse as YAML (python `yaml.safe_load`).
  - `actionlint` and `shellcheck` are not installed here, so neither was run.
- Mutation reds I re-ran myself:
  - Removing `c.ref === MAIN_REF &&` from the janitor makes its selftest fail 4 checks.
  - Removing the `sub(/\//,"-",b)` normalisation from the prune script makes its selftest fail 3 checks.
  - Both guards can fail, as claimed.
- `gh` 2.97 help confirms `gh cache delete --all --ref ... --succeed-on-no-caches` is a supported combination.

Issues:
1. **Bug in `scripts/ci-prune-sbt-cas.sh:40-43`.** Under `set -euo pipefail` the script exits 1, printing nothing and deleting
   nothing, whenever the last symlink that `find` yields under `OUT_DIR` does not resolve into `v2/cas`.
   - Cause: the loop body `[ "$(dirname -- "$t")" = ... ] && basename -- "$t"` returns 1 for a non-CAS link. A `while` loop's
     status is the status of the last body command, and `pipefail` carries that status out of `find | while | sort`, so
     errexit kills the script.
   - The header comment (line 39: "absolute (or resolvable) symlinks pointing into the CAS") says non-CAS links are filtered
     out, not that they are fatal.
   - Reproduced on a fixture under the scratchpad (not `~`):
     - Fixture: one link into `cas` (`out/x.jar`) and one link to a non-CAS file (`out/d1/e/y.txt`, which `find` yields last).
     - Result: exit=1, no output, CAS unchanged.
     - Control: the same fixture without the non-CAS link exits 0 and prints the summary.
     - Minimal shell probe: `set -euo pipefail; printf "a\nb\n" | while read -r l; do [ "$l" = a ] && echo $l; done | sort -u >/dev/null; echo survived` exits 1 without printing "survived".
   - Today's sbt output does not trigger it. All 17 symlinks in the main checkout's `backend/target/out` point into `v2/cas`,
     and PR CI pruned successfully.
   - It is still a latent, order-dependent failure. On main shard 0 it would turn a green backend job red after `testFull`,
     with no diagnostic, and skip the compile-cache save. On PRs it would fail every backend leg. Any sbt change that adds a
     non-CAS link under `target/out` would set it off.
   - The selftest has no non-CAS symlink case, so it cannot catch this.

Everything else checked out:
- DRY, naming and modularity are fine. `selectDeletions` is pure and tested, and `check()` is pure and tested.
- Security:
  - `pull_request_target` workflow: no checkout, the PR number reaches `run:` only through `env`, `actions: write` only,
    and a single exact-ref delete. The static guard enforces all of this, with 8 mutations shown red.
  - Janitor: checks out the default branch only, `actions: write` only, and has a concurrency group.
  - Janitor `DRY_RUN` expression: the `&& ||` form gives `'false'` correctly for dispatch with `dry_run=false`.
- Error handling: the janitor's `gh` wrapper throws on non-zero exit. The prune script refuses when the output references no
  blob or the output dir is missing, and both refusals are tested.
- I found no dead code and no TODO/FIXME.

### Phase 3: UI Review — N/A
The diff does not touch any UI trigger: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The spec
delta lives under `openspec/changes/`. No servers were started.

### Orchestrator claims, verified independently
- **(a) main CI on 2dd4ed62 (run 37838151040) fails `security` for a reason unrelated to this change.** CONFIRMED, but the
  attribution is wrong.
  - The run is a `push` to `main` at head 2dd4ed6237817b1feef22d69f8bc8058e58541db. Only `security` failed (plus
    `ci-complete` because of it); every frontend, backend and e2e job succeeded.
  - Both `Frontend audit (root)` and `Frontend audit (frontend/)` fail on **Handlebars** advisories, not braces:
    GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f and GHSA-xw65-4hp5-5hc7 (that last one is critical).
  - braces (GHSA-vfj7-8cjw-p6xm) appears in the audit JSON, but `.audit-ci.jsonc` already allowlists it under HEL-1246
    (`*micromatch>braces*`). It is not in the "Vulnerable advisories are:" list.
  - PR #860's own run 37840348347 at fa86475f fails `security` on the identical three-GHSA list.
  - This diff changes no lockfile and no dependency.
  - Classification: a pre-existing failure on main from a new upstream npm advisory, independent of HEL-1299. It needs its own
    ticket (the Handlebars advisories, not braces).
- **(b) AC1, AC2 and AC5 are driver-run post-merge.** CONFIRMED as declared in the planning artifacts and the design-gate
  CONFIRM, with the measurement commands recorded in `post-merge-measurement.md`.

### Overall: FAIL

### Change Requests
1. `scripts/ci-prune-sbt-cas.sh:40-43`: make a non-CAS symlink a skip, not a fatal error.
   - The fix: change the loop body to `if [ "$(dirname -- "$t")" = "$casreal" ]; then basename -- "$t"; fi`, and compute
     `casreal="$(readlink -f -- "$cas")"` once before the loop (this also stops it being recomputed for every link). An
     equivalent `|| true` on the body also works.
   - Add a case to `scripts/ci-prune-sbt-cas.selftest.mjs`: a fixture where `OUT_DIR` holds a symlink to a file outside
     `v2/cas`, placed so `find` yields it last (for example a deeper subdirectory, like `out/zz/deep/other.txt` next to the
     CAS links).
   - The new case must assert: exit 0, referenced blobs kept, unreferenced blobs dropped, and the non-CAS link's target untouched.
   - Show this new case red against the current script (it exits 1 there).

### Non-blocking Suggestions
- `ci.yml` "Report sbt cache composition" uses both `continue-on-error: true` and `|| true`; one is enough.
- `~/.ivy2/cache` was measured absent on every runner (`ci-evidence-pr860.md`). Dropping it from the restore/save path lists
  is a safe follow-up; it is correctly not done here on evidence grounds.
- Keep the deliberate fail-loud behaviour of the main-side prune (a prune refusal skips the save rather than saving an
  unpruned entry). It is worth one comment line in `ci.yml` so a future reader does not add `continue-on-error`.
