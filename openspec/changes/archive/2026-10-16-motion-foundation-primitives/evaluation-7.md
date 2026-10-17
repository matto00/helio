## Evaluation Report — Cycle 3, targeted re-check (evaluation-7.md)

Scope: a mechanical delivery fix only (owner-answered escalation: regenerate-in-this-pr).
evaluation-6.md PASSed e2de6fd55. Reviewed HEAD: 15f1b5e598d3034b149d404ea2cf2e350b090a8c.

### Phase 1: Spec Review — PASS
Issues: none.
- `git diff e2de6fd55 HEAD --stat -- . ':(exclude)openspec/changes/archive'` shows exactly one file,
  `e2e/shard-weights.tsv` (65+/39-). Commits since e2de6fd55: ed53cfbae (archive reports only) and
  15f1b5e59 (the weights table only).
- The commit message names the source runs (38982340014, 38984979723) and records why 38987195427 was
  excluded. This matches the escalation answer.

### Phase 2: Code Review — PASS
Issues: none.
- **Artifact provenance checked, not assumed.** I re-downloaded `playwright-json-shard-*` for all three
  runs with `gh run download` into `.concertino/scratch/HEL-1573/art-verify/`. Each run has 4 shard
  reports, and all 12 `results.json` files are byte-identical (`cmp`) to the cached copies in `art/`.
  Run metadata from `gh run view`:
  - 38982340014: main, 95b3c9fd9, success
  - 38984979723: this branch, 400dbd24a, success
  - 38987195427: main, d777803c1, failure
- **Byte-for-byte regeneration.** I ran `node scripts/e2e-shard.mjs weights art-verify/38982340014
  art-verify/38984979723` (exit 0) and compared the output to the committed `e2e/shard-weights.tsv`.
  `cmp` finds them identical, and both have sha256
  `841a29262391700777c9e8d736dbec483ec711ab900f23adda8c7c78adc2fa75`. Nothing was hand-edited.
- **Run 38987195427 was correctly rejected.** On its own, and together with the other two runs, the
  script exits 1 with `shard playwright-json-shard-3 report has unexpected=1`. The raw stats in that
  shard's report agree: `{"expected":97,"unexpected":1,"flaky":0}`. The failure is real, and the guard
  at `scripts/e2e-shard.mjs:183-184` did its job.
- **No guard was weakened.** `git diff origin/main HEAD -- scripts/e2e-shard.mjs` is empty, and so is
  the diff against the merge base. The only `scripts/` change in this PR is `scripts/check-tokens.mjs`,
  which predates e2de6fd55 and was covered by evaluation-6.
- **Selftest.** `npm run check:e2e-shard:selftest` passes all 15 cases, including the RED guard cases
  for "not exactly 4 reports" and "unexpected/flaky > 0" (exit 0).
- **`plan 4`.** Exit 0. `plan()` calls `verifyExactlyOnce` (`scripts/e2e-shard.mjs`, plan function),
  which throws on any file that is unassigned, duplicated or not discovered. Across the 4 legs there
  are 68 files (14+17+19+18) and 68 unique names. The 10 spec files on disk that are not in the plan
  are the ones `playwright.config.ts` `testIgnore` excludes (`*.regression.spec.ts`, plus the
  HEL-951/HEL-960 quarantines such as hel665/hel666/hel908/hel912), so they are not discovered and not
  a partition gap.
  - `hel1575-dashboard-tabs.spec.ts` (700s, now weighted) is on leg 1.
  - `hel1578-home-changed-dot.spec.ts` (35s, still defaulted) is on leg 4.
  - So the two are on different legs. In the before plan both were on leg 1.
  - The legs are balanced at 1067-1069s weighted. The only defaulted files left are the two HEL-1578
    specs, which is expected because their run was rejected.
  - My fresh plan output is identical (`diff`) to the recorded after-plan evidence.

### Phase 3: UI Review — N/A
This re-check touches only an e2e timing table, which the CI shard planner reads. It has no runtime
or UI effect. As the orchestrator directed, I did not re-run UI, jest or e2e (evaluation-6 covers
those at e2de6fd55).

### CI status (PR #1050 at HEAD 15f1b5e59, informational, not blocking)
- Passed: CodeQL Analyze (actions, java-kotlin, python), security.
- Pending: Analyze (javascript-typescript), backend (0-3), e2e (1-4), frontend, docker-image.
- Skipped: CodeQL aggregate, label-update-type.
- PR is OPEN and MERGEABLE. I made no merge-readiness claim, because CI has not finished.

### Overall: PASS

### Evidence
- Fresh plan: /home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/.concertino/scratch/HEL-1573/plan-eval7.txt
- Before/after plans: /home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/.concertino/scratch/HEL-1573/shard-plan-{before,after}.txt
- Regenerated table: /home/matt/Development/helio/.concertino/scratch/HEL-1573/regen-weights.tsv (sha256 above)

### Non-blocking Suggestions
- After this merges, regenerate again from a green main run that includes the HEL-1578 specs, so
  they stop defaulting.
