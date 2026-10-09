## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed HEAD: `91e12a2dc8aafaf6803a23f090ff8125da61af13`.
- Diff base: `2dd4ed6237817b1feef22d69f8bc8058e58541db`, resolved live by `resolve-review-base.sh`.
- Cycle delta: `fa86475f..91e12a2d`, one commit. It touches only:
  - `scripts/ci-prune-sbt-cas.sh`
  - `scripts/ci-prune-sbt-cas.selftest.mjs`
  - `.github/workflows/ci.yml`
- Everything that passed in evaluation-1.md is unchanged by this delta. I did not re-review it.

### Phase 1: Spec Review — PASS
- The delta adds no scope. The task list and planning artifacts still match the code.
- C1 and C2 still hold. The prune ran only in PR CI. On run 37841651996 it took 7–10 s on each leg, and the CAS dropped from 2,082,868 KB to 97,120 KB.

### Phase 2: Code Review — PASS
**Change request 1 from cycle 1 is resolved.**
- At `scripts/ci-prune-sbt-cas.sh:40-47`, the CAS path is now resolved once (`cas_real`). The loop body is now an `if`, and it also guards against an empty `t`.
- A non-CAS symlink is now skipped instead of stopping the script.

**The new selftest case is a real red test.**
- It uses a non-CAS link at `out/zz/zz-last.txt`, so `find` returns it last.
- I ran the selftest against the cycle-1 script (`git show fa86475f:scripts/ci-prune-sbt-cas.sh`) three times. Each run failed 2 checks: "non-CAS symlink does not abort prune -- status 1", and all 4 CAS blobs left in place.
- Against the new script it passed 3 out of 3 runs.

**Gates I re-ran myself in WORKTREE_PATH:** all rc 0.
- `npm run lint`
- `npm run format:check`
- `selftest:cache-janitor`
- `selftest:ci-prune-sbt-cas`
- `check:cache-cleanup-pr`
- `check:cache-cleanup-pr:selftest`
- `check:precommit-ci-parity`
- A YAML parse of `ci.yml`

`frontend/**` and `backend/**` are untouched, so the ticket's frontend and backend gates do not apply.

**ci.yml changes:**
- The redundant `|| true` is removed. `continue-on-error: true` remains, so a missing `~/.ivy2/cache` shows as a soft step failure and does not fail the job.
- A comment now records that the main-side prune must fail loudly, with no `continue-on-error`.

**PR #860 CI on 91e12a2d (run 37841651996):**
- Green: frontend, backend 0–3, e2e 1–4.
- The prune log is the same on all four backend legs:
  - `cas: total=481 kept=271 dropped=210 dangling_links=0`
  - `ac: total=2211 kept=2070 dropped=141`

**The red `security` job is the same pre-existing failure, and nothing else.**
- The only failing steps are `Frontend audit (root)` and `Frontend audit (frontend/)`.
- Every other step passed: the backend SBOM and its positive control, osv-scanner, the CVSS ≥ 7 check, and the helio-mcp audit.
- Advisory IDs in the failed log:
  - Handlebars GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f and GHSA-xw65-4hp5-5hc7, which make up the "Vulnerable advisories are:" lists.
  - braces GHSA-vfj7-8cjw-p6xm, which appears once, only in the JSON body. It is already allowlisted under HEL-1246.
- This matches main's run 37838151040 on 2dd4ed62. The change touches no lockfile or dependency, so the failure is independent of HEL-1299.

### Phase 3: UI Review — N/A
No UI-trigger paths changed.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- The new selftest case could also assert that the non-CAS target (`elsewhere.txt`) still exists. The script only ever deletes inside `v2/cas` and `v2/ac`, so this is belt-and-braces only.
- The Handlebars advisories (red `security` on main as well) need their own ticket. They are not a HEL-1299 concern.
