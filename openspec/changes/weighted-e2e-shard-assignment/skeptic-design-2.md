## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `33dcf8fd22fe21f4823697aec101033e7f637c30`. The change dir is untracked.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1361`.

- **Prior CR1 (D5 aggregation) is RESOLVED.**
  - D5 and the C1 constraint now say: sum per file across all shard reports of one run, then take the median across runs.
  - D1 defines `weights <runDir>...` with `<runDir>/<shard>/results.json`. The baseline artifact tree really has that shape: `scratchpad/art/<run>/{1..4}/results.json`, 5 runs.
  - D7 adds the split-file selftest case.
  - I recomputed the numbers from the artifacts with my own script, `scratchpad/w.mjs`:
    - 38 files, each present in all 5 runs.
    - Total is **1455.2 s**, which matches Context's "~1455 s".
    - `hel773-top-anchored-mobile-nav-sheet.spec.ts` is **69.9 s**, which matches "~70 s".
    - `state-surface-contrast-guard.spec.ts` is 273.5 s.
    - The median known weight is 23.6 s.
  - I simulated D3's LPT with hel1351 defaulted to the median. The legs come out at **368 / 370 / 370 / 371 s** summed, so D3 achieves the balance it claims.

- **Prior CR2 (task 1.2 vs hel1351) is RESOLVED, using option (b).**
  - D5 names the acceptance signal: "has a row OR printed as `defaulted`", and never a hand-added row.
  - Task 1.2 uses the same signal.
  - D5, task 1.2 and D8 all refer to the same 5 run ids named in Context.

- **Prior non-blocking notes are folded in.**
  - `--reporter=json` (stdout) is used on both list passes (D2/D4).
  - A `code === null` exit maps to non-zero (D4, plus a selftest case).
  - The comment at `ci.yml:81-85` is added to D6 and task 1.3. I confirmed the comment exists at those lines.
  - D8 adds the 5-run like-for-like baseline.

- **Fresh review: discovery.**
  - There are 49 `e2e/*.spec.ts` files. Removing the 8 named `testIgnore` quarantines and the 2 `*.regression.spec.ts` files leaves 39, which matches Context.
  - `e2e/support/` contains no spec or test files.
  - The config has no `webServer` or `globalSetup`, so a `--list` pass needs no servers (D2's claim).
  - The CI env does not set `PLAYWRIGHT_JSON_OUTPUT_*`. So the CLI `--reporter=json` replaces the config's reporters, writes to stdout, and leaves `test-results/results.json` alone.

- **Fresh review: no hidden coupling.**
  - No `openspec/specs/*` capability references `--shard` or `npx playwright test`, so a new capability with no MODIFIED delta is correct.
  - No script parses the ci.yml run line.

- **Fresh review: wiring precedent and internal consistency.**
  - The selftest wiring precedent exists: `package.json` has `check:*:selftest` entries and `.husky/pre-commit` runs them.
  - On empty shards, the spec says "runs no tests, never falls back" and D4 says "exits non-zero". These are consistent: the leg runs nothing and fails loudly.
  - The tasks cover AC1-AC4. AC1's evidence is the CI-JSON weights, AC2 is D3/D6 plus the profile, AC3 is task 2.4, and AC4 is D2-D4 plus task 2.3.
  - I found no placeholders or TBDs.

### Verdict: CONFIRM

### Non-blocking notes

- **Stale README section.** `e2e/README.md:89-104` ("CI runtime: sharding and parallel-mode files") will be false after this change. It says CI runs `npx playwright test --shard=<i>/<N>`, that "Sharding splits by test count", and that parallel mode lets a file spread across shards.
  - Task 1.4 only says "document regeneration".
  - The implementer should rewrite this section, not just append to it. It should say:
    - assignment is file-level LPT from `e2e/shard-weights.tsv`;
    - parallel mode now only spreads a file across the leg's 2 workers;
    - unknown files get the median weight.
  - The evaluator should check this.
- **Median definition.** D3 says "median known weight". Make it the median of the weight-table rows for currently discovered files, ignoring stale rows, so a stale entry cannot skew the default. State the choice in the script header.
- **AC2 margin.** Balanced summed time is ~370 s per leg, so the `Run e2e` step should be ~185-190 s at 2 workers. Add the two `--list` passes and the ~175 s non-test overhead, and the leg lands near 365-375 s against a ~390 s target. That is achievable, but the margin is thin, so profile.md must report the `--list` cost as the Risks section promises.
