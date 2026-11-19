## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: d4facfea875dd04d942045425f8cd01a6d92d6ca. Base resolved live with `resolve-review-base.sh`: 5f137cb5ffbf358b4ac47f044ad6fe26fce74d37 (exit 0, non-empty).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1772`.
- **The owner ruling is real and first-hand.** In the main checkout's `.concertino/runs/HEL-1772/events.jsonl`, line 22 is `escalation.raised` (options: add-seventh-leg, merge-as-is-with-followup, more-reruns-first, halt). Line 23 is `escalation.answered` with `answer: add-seventh-leg`, `answer_source: human` and `resolution_channel: chat`. The fold-in AC in ticket.md matches it.
- **The code diff against the base is exactly what the ruling needs:**
  - `ci.yml`: `shard: [1..7]`, `max-parallel: 7`, plus comments. `timeout-minutes: 25` is unchanged.
  - `scripts/e2e-shard.mjs`: only the `DEFAULT_E2E_LEGS = 7` constant and its comment. The partition logic is untouched.
  - The selftest fixtures, plus comments and docs in `playwright.config.ts`, `e2e/README.md` and `MISTAKES.md:211`.
  - No cd-*.yml, HEL-1743 or HEL-1732 file is in the diff.
- **Every consumer of the leg count follows the matrix, so nothing still assumes 6.** The run step is `node scripts/e2e-shard.mjs run ${{ matrix.shard }} ${{ strategy.job-total }}`, so CI legs take the count from the matrix, not from the constant. Artifact names are per `matrix.shard`. `ci-complete` gates on the whole `e2e` job (`needs: [..., e2e, ...]`), not on named legs. A `git grep` for `e2e-shard` and `playwright-json-shard` in every other workflow and script found no other consumer. The `e2e-ci-sharding` spec never hardcodes a leg count, so `skip_specs` holds.
- **Selftest at HEAD:** `npm run check:e2e-shard:selftest` printed "18 e2e-shard selftest cases passed". It also runs in ci.yml:93 and .husky/pre-commit:33.
- **The drift guard fails, and the fixtures follow the constant.** I re-ran these myself in a scratch copy (`.concertino/scratch/HEL-1772/skeptic-final-2-mut`, since deleted), so the worktree was never mutated:
  - A. Matrix only set to 8: `AssertionError: ci.yml e2e matrix has 8 legs but DEFAULT_E2E_LEGS is 7`.
  - B. `DEFAULT_E2E_LEGS` only set to 8: `ci.yml e2e matrix has 7 legs but DEFAULT_E2E_LEGS is 8`. It fails at the drift assertion, not at a fixture.
  - C. Matrix, max-parallel and constant all set to 8: 18 cases pass. This proves the default-path fixtures derive from the constant and no 6 or 7 is left hardcoded.
  - D. Only max-parallel set to 6: `ci.yml e2e max-parallel is 6 but DEFAULT_E2E_LEGS is 7`.
- **Plan at HEAD** (`DEV_PORT=7204 node scripts/e2e-shard.mjs plan`):
  - 7 legs at 1382-1387 s weighted each, 114 files.
  - No `defaulted` line and no `stale` line after the merge from origin/main.
  - The tool's own exactly-once check passed.
- **Weights still fit 7 legs.** Weights are per-file sums across all of a run's reports, so they do not depend on the leg count. `--legs 6` exists for regenerating from older runs, and the README states this.
- **The heaviest spec still fits one leg.** hel1665 is about 674 s summed, against about 1387 s planned per leg.
- **The docs grep is clean.** A search for stale leg-count phrases outside `openspec/changes/` hits only historical HEL-1698/HEL-1772 context, marked as superseded.
- **Evaluator claims** (evaluation-2.md) that I reproduced: the selftest, the drift mutations, the plan output and the docs grep. Its API figures for the 6-leg premise (1433/1395/1340 s slowest) I took as stated. They feed the rationale, not the correctness of this diff, and the owner ruled on them.

**Is this the right thing to ship?** Yes. The cause the ticket asked for (stale weights) was fixed and measured in round 1. The leftover variance gap needed an owner decision, and the owner made it. This diff implements exactly that decision at the minimum surface, with a guard that has been shown to fail. The remaining AC, at least 3 attempts at 7 legs with the slowest leg, mean leg and headroom, is tasks.md section 3, owned by the orchestrator after push. I did not count its absence against this gate.

### Verdict: CONFIRM

### Non-blocking notes
- `.github/workflows/ci.yml:619` is one comment line of about 400 characters, in a block that wraps at about 120. Its last sentence, "Regenerate it again when a heavy spec is added", now follows the 7th-leg sentence, so "it" reads as the leg, not the weight table. Re-wrap the line and write "the weight table". This is cosmetic.
- Cost to state in the PR: about 16 CI jobs per run (backend 4, e2e 7, plus frontend, security, docker-image, e2e-prod-build and ci-complete). Two concurrent PR runs approach the account's roughly 20-job pool, so there may be queueing. A queued leg shows up as a later `started_at`, and job wall is measured from `started_at`. Report queue delay separately if run walls look inflated.
- Section 3 must use per-attempt job data (`/attempts/{n}/jobs`) and apply the counting rule. If counting attempts still miss 1200 s, the heavy-spec follow-up from the AC must be filed. The owner ruled that this needs no re-escalation.
