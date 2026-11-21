## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: 3fa325155ea67b61f7bab6b31efd9db416192d41 (worktree HEAD). The change dir holds untracked planning
artifacts. Live origin/main is 13180246a (HEL-1649 merged after planning; see below). The owner ruling (an 8th leg, no
timeout raise, no paid or larger runner) is settled and is not re-argued here.

### What I verified (with evidence)

- **Spawn cwd**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/e2e-eighth-leg/HEL-1793`.
- **Round-2 CR1 (task 2.3 grep could never reach zero)**: fixed. The revised pattern drops `to 7 by` and adds
  `= 11 parallel`, `6 by default`, `[1, 2, 3, 4, 5, 6, 7]` and `max-parallel: 7`. I ran it on 3fa325155 and got 9 hits,
  every one a D1 site: ci.yml:622, :631, :633, :857; MISTAKES.md:211; e2e/README.md:140, :144, :146;
  playwright.config.ts:192. The unrelated `docs/superpowers/...:120` hit is gone. The same grep on origin/main also
  gives 9, so HEL-1649 adds no new site.
- **Zero hits is reachable with history-preserving edits.** I read every hit in context:
  - ci.yml:622: D1 rewrites the parenthetical total to "backend 4 + e2e 8 = 12".
  - MISTAKES.md:211: task 2.3 keeps "HEL-1772 to 7", which no longer matches, and rewrites the total.
  - README:144: "7 since HEL-1772" becomes a range such as "7 from HEL-1772 to HEL-1793", which does not match.
  - README:140, README:146 and playwright.config.ts:192: each becomes "8 legs".

  The prior-ruling wording ("up from 7 (HEL-1772)") matches nothing. The expected result is stated as exactly zero.
- **Round-2 non-blocking note (task 2.1 "only these lines")**: addressed. It now says "only e2e-job lines", and the
  ci.yml:619/622/857 edits belong to 2.3.
- **Selftest guard**: `scripts/e2e-shard.selftest.mjs:211-225` asserts that the matrix length and `max-parallel` equal
  `DEFAULT_E2E_LEGS`, and that `EXPECTED_SHARD_REPORTS` has not drifted from it. Both D2 mutations go red. The other
  selftest uses (`:152-200`) are generic in `EXPECTED_SHARD_REPORTS`, so the constant can move to 8 safely.
- **`weights --legs 7`**: `scripts/e2e-shard.mjs:336-339` gives `--legs` and defaults it to `EXPECTED_SHARD_REPORTS`.
  After the constant becomes 8, regenerating from 7-leg runs needs `--legs 7`, and D3 and task 3.1 pass it.
- **D4 scripts**: `/home/matt/Development/helio/.concertino/runs/HEL-1789/evidence/measurement/` contains every file
  named. The hard-coded 7s sit at `measure.mjs:11` (`legs.length === 7`), `:27`, and `lib.mjs:55`, as cited.
  `counting()` (`lib.mjs:54-57`) checks only the report count and unexpected/flaky, exactly as D4 says it must be
  extended. The `measure.mjs:10` job regex `^e2e \(\d\)$` matches `e2e (8)` and excludes `e2e-prod-build`.
- **D3 runs, live (gh API, read-only)**:
  - 44854332613 is push/main at 3fa325155 and still `in_progress`. The design says to wait for it.
  - 44845120888 is `completed success`, attempt 1.
- **HEL-1649 merged during planning.** It is 13180246a, PR #1203, and its main run 44855074949 is queued. It adds two
  e2e specs (`state-surface-contrast-guard-narrow-1100-768.spec.ts`, `-narrow-390.spec.ts`) and touches no leg-count
  site, CI file or script. D3 already covers this: merge main, regenerate from a counting main run that contains the new
  specs, and if none exists, name them as defaulted in measurement.md. The plan stays sound.
- **AC coverage** is unchanged from round 2 and still complete:
  - AC1 maps to tasks 2.1-2.3.
  - AC2 maps to task 5.1, D4 and the spec's "Leg-count change measured on its own runs" scenario.
  - AC3 maps to the D4 verdict rule and the "A leg slower than 20 minutes" scenario, which names the CPU model and the
    leg factor.
  - Red-first is covered by task 1.3 and C12.
  - The post-merge main SHALL is covered by D4a and task 5.2.
  - The run cap and the counting floor are covered by D4: a 6-run cap, then an escalation.
- **Placeholders or contradictions**: none found. Proposal, design, tasks and the spec delta agree on 8 legs,
  `timeout-minutes` 25, `ubuntu-24.04`, and the 12-job total.

### Verdict: CONFIRM

### Non-blocking notes

- HEL-1649 is now on main, so the D3 conditional applies. Task 3.1's verify names only the hel1735 and hel1791 rows. The
  executor should also check rows for the two `state-surface-contrast-guard-narrow-*` specs, or name them as defaulted
  under D3's existing rule. They are unweighted: if they are heavy, the 8-leg plan is less balanced than its on-paper
  loads.
- The D3 list predates 44855074949, the first main run that contains HEL-1649. If it counts, it becomes the newest of
  the 5 runs. Record which 5 runs were used in the TSV header, as task 3.1 already requires.
- The HEL-1789 `counting()` requires `flaky === 0` per report. A C11-rerun after-run that "counts on its clean attempt"
  must be measured from that attempt's artifacts alone, which D4 already says.
