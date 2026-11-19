## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed: the fold-in revision (ticket.md AC bullet, proposal.md, design.md Decisions 4-5 + Risks, tasks.md 2b + section 3 heading), working tree on HEAD 8cdc5525a06dd455bfef6d13ba94398ec0faa435 (merged origin/main 5f137cb5f). Spawn-cwd guard: READY.

### What I verified (with evidence)

1. **Owner ruling is real.** Main checkout `.concertino/runs/HEL-1772/events.jsonl` lines 22-23: `escalation.raised` (options add-seventh-leg, merge-as-is-with-followup, more-reruns-first, halt) then `escalation.answered` `answer":"add-seventh-leg"`, `answer_source":"human"`, `resolution_channel":"chat"`. The ticket AC bullet matches it.
2. **6-leg PR figures (Decision 4), fresh from the GitHub API** (`/actions/runs/44410691147/attempts/{1,2,3}/jobs`, job wall = completed_at - started_at):
   - att1: 967 / 1090 / 1031 / 1433 / 922 / 1266 -> slowest 1433, mean 1118.2
   - att2: 1211 / 1016 / 1395 / 1172 / 965 / 946 -> slowest 1395, mean 1117.5
   - att3: 1003 / 1340 / 1001 / 1061 / 931 / 1274 -> slowest 1340, mean 1101.7
   Matches the design (1433/1395/1340, 1118/1118/1102, headroom 67-160 s). Not disclosed by the design: att1 leg 4 and att2 leg 1 concluded `failure`. From the reports: att1 L4 `unexpected=1` is hel1583-glass-nav:554 (failed after 9 s), att2 L1 `unexpected=1` is hel1573-motion-grid-chart:104 (failed after 24 s); both on the C9 known-flake list; `retries: 0`, so neither failure inflated a leg. Under Decision 5's own counting rule only att3 counts; att3 alone (1340 s) still misses 1200 s, so the conclusion that motivated the ruling stands.
3. **Artifacts match their attempts.** `att2-arts.txt`/`att3-arts.txt` artifact timestamps fall at each attempt's job completion times; report `startTime`s are inside each attempt's window.
4. **Per-worker claim.** Re-ran `workers.mjs` over the three report sets: within-leg worker busy-time gaps max 122 s (att3 L2 1020/1142), most under 15 s. "Within about 120 s" holds. Fixed overhead (job wall minus report wall): 162-211 s; "about 180 s" holds.
5. **Heavy-spec variance.** Summed per-file seconds att1/att2/att3: hel1665 712/672/903 (row 674), hel1733 397/579/386 (row 358), hel1583-glass-nav 296/235/190 (row 160), hel1608 121/100/84 (row 8). Matches the design's ranges.
6. **Projection arithmetic.** (1110-180) x 6/7 + 180 = 977 s; x1.22..1.28 = 1192-1251 s; normal window (980-180) x 6/7 + 180 = 866 s, x1.22..1.28 = 1056-1108 s. Ratios from data: 1433/1118 = 1.28, 1395/1118 = 1.25, 1340/1102 = 1.22. Correct, and labelled a projection. (Caveat, non-blocking: at 7 legs one heavy spec's variance is a larger share of a smaller leg, so the ratio may rise; the Risks bullet covers the miss case.)
7. **Weights independent of leg count.** `scripts/e2e-shard.mjs` `fileSumsForRun` sums per file across all reports of a run; the claim holds. `--legs <n>` exists (`parseWeightsArgs`).
8. **Selftest red claim, run in a scratch copy** (`.concertino/scratch/HEL-1772/skeptic/r3/{a,b,c}`, worktree untouched):
   - baseline: 18 cases pass.
   - matrix-only (`shard: [1..7]`): exits 1 at selftest.mjs:197, `7 !== 6`. Task 2b.1's red is real.
   - constant-only (`DEFAULT_E2E_LEGS = 7`): exits 1, but at the first fixture test, `runX: expected exactly 7 shard reports, found 6`. The drift guard at :197 is never reached. **The selftest hardcodes 6**: `six()` (line 152) feeding the default-validated cases at 155, 158-160, 203-213; the literal strings `"expected exactly 6"` (160, 188) and the `[...six(), rep("7")]` over-count case (159, which would pass, not throw, at 7). The proposal's "selftest.mjs only if it hardcodes 6" is wrong: it does, in about 8 places, and no task plans that edit.
9. **Every place that states or depends on the leg count** (`git grep` outside archive and this change dir):
   - Planned and correct: ci.yml:631/633 (max-parallel, matrix; the selftest asserts both at :197-198), ci.yml:614-624 comments, `scripts/e2e-shard.mjs:169-172`, `playwright.config.ts:192`, `e2e/README.md:140, 143, 146`.
   - Workflow consumers are count-agnostic: the step runs `e2e-shard.mjs run ${{ matrix.shard }} ${{ strategy.job-total }}`; artifact names use `matrix.shard`; `e2e-setup` saves caches on `matrix.shard == 1` only; `ci-complete` needs the aggregate `e2e` job; the only required check (ruleset) is `ci-complete`, so there is no per-leg required-check list to update; `e2e-slow.yml` and `scripts/e2e-profile.mjs` do not enumerate legs.
   - **Missed:** `MISTAKES.md:211` says "owner cap: backend + e2e share ~8 legs of a ~20-job free-plan pool; never add legs". It is a cap statement that this change contradicts, and it was already stale after HEL-1698. Task 2b.3's grep ("states the e2e matrix runs 6 legs") cannot find it.
   - **Missed:** `scripts/e2e-shard.selftest.mjs` (item 8).
10. **Spec.** `openspec/specs/e2e-ci-sharding/spec.md:42` ("e2e shard balance is measured in CI") requires at least five sequential CI runs for any change to shard assignment, and a leg-count change is one. :69 ("leg count is an owner decision recorded with the change that sets it") is satisfied by Decision 4.

### Verdict: REFUTE

The fold-in is sound and grounded: the numbers, the per-worker model and the projection all check out against the API and the reports. But the revision added the 7-leg decision without removing the statements it overrides. As a result, the artifacts now tell an implementer two opposite things in several places, and they miss two files that state or depend on the leg count.

### Change Requests

1. **tasks.md:9, Standing Constraint C7** says "No `timeout-minutes`, matrix or e2e-shard.mjs logic change", which directly forbids task 2b. Narrow it to "no `timeout-minutes` change and no partition-logic change; the matrix/max-parallel/`DEFAULT_E2E_LEGS` change is 2b's, per the owner ruling".
2. **design.md:28, Non-Goals** lists "changing the leg count" and contradicts Decision 4. Remove it or mark it superseded by Decision 4.
3. **design.md:66, Migration Plan**: "Data-only change. Rollback is reverting `e2e/shard-weights.tsv`" is no longer true. Rollback now also reverts the ci.yml matrix/max-parallel and `DEFAULT_E2E_LEGS` (together, or the selftest fails), plus the selftest edits.
4. **proposal.md:8** still says "comment only; no change to ... the matrix", which contradicts the fold-in bullet two lines below. Scope it to the original change or reword it.
5. **Run count: tasks.md section 3 contradicts itself, and Decision 5 is under the spec.** The section 3 heading says "at least 3 attempts at 7 legs"; its body (tasks.md:34) says "at least 5 counting runs of the PR's final head" and "so all six legs run together". The spec (e2e-ci-sharding spec.md:42) requires at least 5 for a change to shard assignment, and the owner's "at least 3" is a floor. Make Decision 5 and section 3 say one number: at least 5 counting 7-leg attempts, which satisfies both the spec and the ruling. Otherwise state explicitly that the spec's 5-run bar is not met and why. Fix "six legs" to "all legs".
6. **The selftest needs an explicit task.** Add a 2b step to update `scripts/e2e-shard.selftest.mjs`: derive the default-path fixtures from `EXPECTED_SHARD_REPORTS` instead of `six()` and the literals "expected exactly 6" (lines 152-160, 188, 203-213). Keep every RED case able to fail: the over-count case at :159 must stay one more than the default, and the under-count case one fewer. The "--legs 4 ... refuses 5-of-6" case may keep its explicit 6. Verify the guard both ways, and record both outputs: (a) matrix-only change -> fails at the drift assertion; (b) after the fixture rewrite, constant-only change -> fails at the drift assertion (not at a fixture). Today (b) fails for an unrelated reason (item 8), so the design's claim "must fail red when only one of the two is changed" is not yet proven for that direction. Correct proposal.md's "only if it hardcodes 6": it does.
7. **MISTAKES.md:211** ("owner cap: backend + e2e share ~8 legs ... never add legs") must be updated in 2b.3 to the current ruling (backend 4 + e2e 7 = 11, HEL-1698 then HEL-1772 owner rulings). Widen 2b.3's grep so it catches cap statements like "~8 legs" or "never add legs", not only "runs 6 legs".
8. **Decision 4 disclosure**: say that att1 (leg 4, hel1583-glass-nav:554) and att2 (leg 1, hel1573-motion-grid-chart:104) each had a known-flake failure, so under Decision 5's counting rule only att3 (slowest 1340 s) counts. Also say that `retries: 0` and the 9 s / 24 s failures mean neither inflated the wall figures. The ruling's premise survives; the record should not overstate it.

### Non-blocking notes

- Task 2b.1's selftest failure prints `7 !== 6` at selftest.mjs:197, not a named "leg-count mismatch". It would help to pass a message to that `assert.equal` (it is a selftest edit, so do it under CR 6).
- The design names hel1608 at "about 100 s against its 8 s row" (measured 84-121 s), but the AC follow-up list includes it as a "heavy, variable" spec. It is a stale row more than a heavy spec, so the follow-up could say so.
- Concurrency: 11 jobs per CI run against a ~20-job pool means two concurrent PR runs queue. Job wall starts at `started_at`, so queuing does not count toward the timeout, but it does lengthen time to merge. The Risks bullet covers this adequately.
