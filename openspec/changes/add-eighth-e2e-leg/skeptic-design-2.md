## Skeptic Report — design gate (round 2, skeptic-design-1.md)

Filename note: `next-report-number.sh` returned number=1 because the round-1 report was persisted to the durable
evidence store, not left in the change dir. This is the round-2 design review.

Reviewed tree: 3fa325155ea67b61f7bab6b31efd9db416192d41 (worktree HEAD). The change dir is untracked planning artifacts.
The owner ruling (an 8th leg, no timeout raise, no paid or larger runner) is settled and is not re-argued here.

### What I verified (with evidence)

- **Spawn cwd**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/e2e-eighth-leg/HEL-1793`.
- **Round-1 CR1 (missing sites)**: fixed. D1's list now matches the tree exactly:
  - `ci.yml:619` (HEL-1772 7th-leg history), `:622` ("backend 4 + e2e 7 = 11"), `:631` `max-parallel: 7`, `:633`
    `shard: [1, 2, 3, 4, 5, 6, 7]`, `:857` "(6 by default)";
  - `scripts/e2e-shard.mjs:231,234`; `playwright.config.ts:192`;
  - `e2e/README.md:140,144,146`; `MISTAKES.md:211`.

  I ran a broad sweep with `git grep -i` for `seven|7-leg|7th leg|e2e (7)|shard-7|HEL-1772` and for `7` within 30
  characters of `leg`/`shard`. It found no other leg-count site. `openspec/specs/e2e-ci-sharding/spec.md` and
  `CONTRIBUTING.md` hard-code no leg count. Every other `ci.yml` use goes through `matrix.shard` or
  `strategy.job-total` (`:698-772`).
- **Round-1 CR3 (run cap vs counting floor)**: fixed. D4 and task 5.1 cap the runs at 6. If fewer than 5 of those 6
  count, the executor stops pushing and raises an escalation with named options. It never goes past the cap on its own.
- **Round-1 CR4 (post-merge main SHALL)**: fixed. D4a covers it: the orchestrator measures any main run that finishes
  before cleanup, the driver gets the rest of the watch, the result goes in a ticket comment, and the scripts' path is
  given. Task 5.2 carries it.
- **Round-1 non-blocking notes**: all addressed.
  - D2 and task 1.2 now name the same two mutations.
  - The absolute source path of the scripts is given.
  - The `counting()` extension is stated (`lib.mjs:54-56`).
  - 44786301818 is stated as eligible for the before set.
  - The HEL-1649 case is stated: regenerate if a counting run exists, otherwise leave defaulted and name it.
- **Selftest guard**: `scripts/e2e-shard.selftest.mjs:208-225` asserts that the matrix length and `max-parallel` both
  equal `DEFAULT_E2E_LEGS`. Both mutations in D2 go red.
- **D3 run list (gh API, read-only)**:
  - 44854332613 is push/main, `in_progress`, head 3fa325155. The design correctly says to wait for it.
  - The other 7 runs are push/main, `completed success`, attempt 1, newest first: 3b9f4c83d, 4f101209b, 16a6042d6,
    fef01cda9, ba30212be, 917c89172, 87cf01a5f.
- **Weights CLI**: `weights [--legs <n>] [--list <list.json>] <runDir>...` exists (`e2e-shard.mjs:6,336-354`). `plan`
  prints the `defaulted` files (`:302,305`).
  - The current `e2e/shard-weights.tsv` header lists runs 44697763503..44655001204.
  - The TSV has no row for `hel1735-feature-hover` or `hel1791-compact-counter-stack-height`, and both spec files exist.
    The design's premise holds.
- **AC coverage**:
  - AC1 (the 8th leg) maps to tasks 2.1-2.3.
  - AC2 (at least 5 counting runs, slowest and mean leg, per-leg CPU model) maps to task 5.1 and the spec scenario
    "Leg-count change measured on its own runs".
  - AC3 (at or under 1200 s, or the gap with its cause) maps to the D4 verdict rule and the spec's "A leg slower than 20
    minutes" scenario, which now names the CPU model and the leg factor.
  - Red-first is covered by task 1.3 and C12.
- **Spec delta**: the MODIFIED header matches the requirement at `openspec/specs/e2e-ci-sharding/spec.md:87`. Both
  existing scenarios are kept and one is added, so nothing is lost on archive.

### Verdict: REFUTE

The artifacts are now complete, and the measurement plan is honest. One verification signal can never pass as written,
and it is the same class of defect round 1 raised against task 2.3.

### Change Requests

1. **Task 2.3's "returns zero hits" grep cannot reach zero on the current tree.** I ran it twice on 3fa325155 with the
   same result: 10 hits.
   - Nine hits are the D1 sites, which is intended.
   - The tenth is `docs/superpowers/specs/2026-08-28-release-versioning-and-rulesets-design.md:120`: "(Note: GitHub's
     UI and `gh` abbreviate to 7 by default; ...)". The `to 7 by` pattern matches it. That line is about short SHA
     length, not e2e legs.

   As written, the executor has two bad choices. It can edit an unrelated design doc, which is scope drift, or it can
   report a failed verify. The `to 7 by` pattern also conflicts with history-preserving wording. If the MISTAKES.md:211
   edit keeps "HEL-1772 to 7 by owner ruling" and appends "HEL-1793 to 8", it still matches. That is the style the other
   sites use (ci.yml:619/622, playwright.config.ts:192, e2e/README.md:146 all keep the prior ruling).

   Fix the pattern so a correct edit yields zero hits. Either:
   - narrow it to `HEL-1772 to 7 by owner ruling, so`, or drop `to 7 by` and rely on `e2e 7`/`= 11 parallel`, which
     already pin MISTAKES.md:211; or
   - exclude `docs/superpowers/`, and say whether the MISTAKES.md history clause is kept or reworded, so the expected
     result is unambiguous.

   Then state the expected after-edit result as exactly zero hits.

### Non-blocking notes

- Task 2.1 says "`git diff` shows only these lines", but ci.yml:619/622/857 are edited under task 2.3. Read together
  they agree, but "only these lines" could make a strict executor split the ci.yml edit oddly. Consider "only e2e-job
  lines".
- After a leg-count change, the WHEN of the spec scenario "A leg slower than 20 minutes" ("any of those runs") now
  covers both the main runs and the change's own runs. That reading is fine and probably intended.
- The TSV rows are keyed by basename (`hel1735-feature-hover.spec.ts`), not `e2e/...`. Task 3.1's check "rows exist
  for hel1735-feature-hover" works either way.
