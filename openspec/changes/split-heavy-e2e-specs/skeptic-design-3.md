## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 3bf3590ec2cb2bf4b1478159a8cae832274becf6 (branch task/rebalance-heavy-e2e-specs/HEL-1778; the change dir is untracked and there is no code diff yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/rebalance-heavy-e2e-specs/HEL-1778`.
- **Round-2 CR1 (PR #1172 data source): resolved.** I re-ran the evidence:
  - `gh api .../runs/44428229791/artifacts` returns `total_count` 13. Its `playwright-json-shard-*` artifacts were created from 02:31:10Z to 02:35:05Z, which is attempt 6 only.
  - `/attempts/2/jobs` gives `e2e (3)` as job 135248708940, 00:44:31Z to 01:08:32Z, which is the 1441 s leg.
  - The design now covers each part of the CR:
    - (a) The Context states that only attempt 6's reports survive.
    - (b) Attempts 1-5 are parsed from the job logs' `list` lines, in Context and task 1.1.
    - (c) Every number carries its source, and the per-worker idle tail is derived from log timestamps or marked unavailable (Decision 1(c)).
    - (d) Each PR attempt's reports are downloaded before the next measurement rerun, with a fallback to logs that is marked as such (Decision 6, task 5.1).
- **Round-2 non-blocking notes: all taken up.**
  - The spec-delta scenario now says "the median across runs of the summed duration".
  - The Risks entry no longer claims that ticket-id describes make title paths unique. It names hel1665's describe-less titles and puts the weight on the stderr re-attribution list.
  - Task 2.3 records a zero-hit grep for `:554` and does not chase it further.
- **Round-1 resolutions still hold.**
  - The Goals cap only the parts of the three named specs.
  - Decision 1 keeps the whole-suite driver analysis, the out-of-scope rule, the AC3 expectation and the stop branch.
  - Decision 6 still goes through the balance requirement clause by clause.
- **Planning-probe numbers (independent recompute).** I wrote my own walker over `.concertino/scratch/HEL-1778/runs/{44488684006,44498291938}`:

  | spec | tests | summed (s) | max test (s) |
  | --- | --- | --- | --- |
  | hel1665 | 90 | 756 / 723 | 10.2 |
  | hel1733 | 32 | 334 / 336 | 16.3 |
  | hel1583 | 30 | 203 / 209 | 14.3 |
  | hel1608 | 5 | 103 / 86 | 41.6 |

  - These match the design's table.
  - Title paths (describe chain plus title, root suite excluded) are unique within each file: 90/30/32/5 unique, so attribution rule 2 has a one-to-one key.
  - The part sizes in Decision 2 (4/3/2 parts, about 185/112/105 s each) are well under the 250 s goal.
- **Shard tool.**
  - `fileSumsForRun` sums `results[].duration` per top-level suite `file`, and `weightsFromRuns` takes the median per file.
  - `fileArg` is anchored (`(^|/)e2e/<escaped>$`), so a part named `hel1583-glass-nav-light.spec.ts` cannot over-select a sibling. `verifySelection` would fail loudly if it did.
  - The header's `# Regenerate:` line is where Decision 4's `--list` form goes.
- **Split feasibility and isolation.**
  - Every hel1733 test calls `registerAndLogin` with its own label, and `registerUser` builds the address with `uniqueEmail(prefix, label, domain)`. Per-test `seed()` creates its own source, pipeline and dashboard.
  - There is no module-level `let` and no `beforeAll`. The `counter` `let` and the `beforeEach`/`afterEach` hooks sit inside `describeMode`'s describe.
  - So parts of a split hel1733 that run concurrently in a leg's two workers do not share server state.
  - hel1665 and hel1583 already run in `mode: "parallel"`, and hel1583 has one describe per theme (line 256).
- **Gate chain and references.**
  - `.husky/pre-commit` runs `check:e2e-types`, `check:e2e-evidence-paths`, `check:e2e-user-cleanup` and `check:e2e-shard:selftest`. Task 2.5 and the Gate-Chain checklist name them.
  - Outside the change dir and the weight table, a repo-wide grep for the three file names hits only `frontend/src/features/home/ui/HomePage.css.test.ts` (task 2.3).
  - `playwright.config.ts` `testIgnore` names none of the three specs, and none of them carries `@prod-build`, so splitting cannot move a test between projects or into an ignore list.
  - The e2e job keeps `timeout-minutes: 25` (ci.yml:620).
- **AC coverage.**
  - AC1 (cause per spec, then cut or split): tasks 1.x and 2.x.
  - AC2 (regenerate from 7-leg main runs, hel1608 row): Decision 5, task 4.1.
  - AC3 (slowest and mean leg on 5 or more counting runs with headroom): Decision 6, task 5.1.
  - Driver constraints are covered: before/after test list (Decision 3), no sibling-spec edits, no CD/release edits, apt timeouts described but not fixed.
  - I found no placeholders, TBDs or tasks that contradict the design.

### Verdict: CONFIRM

### Non-blocking notes

- **Order of the Delivery re-regeneration and the PR measurement.** Decision 5 allows "redone at Delivery if main has gained counting runs". If the table is regenerated after task 5.1's measurement attempts, the measured partition is no longer the one that ships, and AC3's evidence would describe a different table. Any Delivery regeneration should come before the measurement reruns, or the measurement should be taken again on the new head. The final gate will check this.
- Decision 2 rejects `mode: "parallel"` on hel1733 partly because it "changes in-file isolation assumptions". A split also lets the parts run concurrently, in a leg's two workers. As verified above, hel1733 is per-test isolated (its own user and its own seed), so this is harmless. The executor should still confirm it in task 2.2's cross-state check rather than assume it.
- `weights` sums only `results[].duration`, so hook and worker-fixture time outside a test result is not in any weight. Splitting into more files adds per-file module import (Risks entry 3). That cost shows up only in leg wall time, never in the table, so the after-set measurement is the only place it is visible.
