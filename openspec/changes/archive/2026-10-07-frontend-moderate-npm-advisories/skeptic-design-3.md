## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 5f3990f8ee873b3124e936875bbfb1cef2335d25. The change dir is untracked. I reviewed ticket.md, proposal.md,
design.md, tasks.md and specs/frontend-dependency-audit/spec.md. Prior rounds: skeptic-design-1.md and
skeptic-design-2.md, both REFUTE.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/frontend-moderate-npm-advisories/hel-1320`.
- **Round-2 CR1 (four fixAvailable rows): FIXED, and the instability disclosure is true.** I copied the worktree's
  `frontend/package.json` and `package-lock.json` into a scratch dir and ran `npm audit --json` 6 times with npm 10.9.8,
  under `nice -n 19`. Every run reported `moderate: 20, high: 0`.
  - **Run 1:** `true` for `@jest/expect`, `@jest/globals`, `jest-runner` and `jest-runtime`.
  - **Runs 2-6:** `{name: jest, version: 25.0.0, isSemVerMajor: true}` for those same four.
  - **All 6 runs:** the other rows did not vary, e.g. `@jest/reporters=true`,
    `sprintf-js=ts-jest@29.1.2 (major)` and `jest-snapshot=jest@25.0.0 (major)`.

  So the planner's report of one `true` run in six was not an excuse; I reproduced it independently. It also
  explains why rounds 1 and 2 disagreed. I compared all 20 table rows against a majority run (r3) and every
  fixAvailable value matches. The note under the table (majority value, the run-count disagreement, and the
  regenerated table replacing design.md's) is honest. It is also sufficient. The "real fix?" column does not depend
  on the flapping value: either way, every one of those rows "clears via D1". Task 3.4 now replaces design.md's table
  as well as feeding the PR body, which was the second half of CR1.
- **Round-2 CR2 (helio-mcp/.audit-ci.jsonc): FIXED.** It is now in proposal.md "What Changes" and Impact, D5 (lines 2-5), and
  task 2.4, which is a comment-only reword plus a grep. On disk, `helio-mcp/.audit-ci.jsonc:3` reads "Deliberately stricter than the root and
  frontend/ configs (`"high": true`)", which matches what the plan targets.
- **Parent column (C1):** I re-derived it from the lockfile `packages[*].dependencies`, plus the root for direct deps.
  All 20 rows match. My probe also included `peerDependencies`, and only then does ts-jest appear as an extra dependent
  of `@jest/transform`, `babel-jest` and `jest`. That is a peer relation; see the non-blocking notes.
- **Runtime vs dev:** `npm ls --omit=dev sprintf-js js-yaml` prints `(empty)`, so every row is dev/build-only, as
  claimed.
- **D1 re-probed:** In a scratch copy I changed the override to `^4.1.1` and ran
  `npm install --package-lock-only --ignore-scripts` (rc=0). The lockfile delta is exactly js-yaml 3.15.2 -> 4.3.2,
  argparse 1.0.10 -> 2.0.1, esprima removed and sprintf-js removed. After that, `npm audit` reports
  `{moderate: 0, high: 0, total: 0}`. This matches design.md D1 and proposal Impact ("4 entries").
- **D4 premise:** In `@istanbuljs/load-nyc-config/index.js`, the only js-yaml use is line 80,
  `require('js-yaml').load(...)` in the `.yaml` branch. No `.nycrc*` file exists in the repo, so task 3.3's temporary
  file is the right way to exercise that branch.
- **Stale-threshold sites:** I grepped `*.md`, `*.yml` and `*.jsonc` for frontend + high claims. The hits are
  `MISTAKES.md:230`, `helio-mcp/.audit-ci.jsonc:3`, `frontend/.audit-ci.jsonc:2,5` and `.github/workflows/ci.yml:262`.
  Each one maps to a task: 2.3, 2.4, 1.3 and 2.1 respectively. `docs/dependency-management.md` is covered by 2.2, as
  round 2 found.
- **AC coverage:**
  - **AC1 (triage list):** design.md table plus task 3.4.
  - **AC2 (bump and list changed entries):** D1 plus tasks 1.1, 1.2 and 3.4.
  - **AC3 (allowlist for unfixables):** none are left unfixable after D1, so the allowlist stays empty. The spec
    requirement keeps the convention for future entries.
  - **AC4 (owner ruling):** Q2 is recorded and D2 carries it out.

  No scope drift: jest and ts-jest are untouched, and the root threshold is unchanged.
- **Red-first proof:** D3 and task 3.1 test the base lockfile under both the new and old configs, and the new
  lockfile under the new config. That is a real red/green check, and the gate can fail.
- **Placeholders, contradictions:** none found. Proposal, design, tasks and spec agree.

### Verdict: CONFIRM

### Non-blocking notes

- **The disagreeing run was the first one.** In my 6-run sample, run 1 was the one that returned `true`, which hints at
  a cold-versus-warm cache effect. I have not proven that. For task 3.4, the executor should run base `npm audit --json`
  at least twice, and record the disagreement next to the table if the runs differ, rather than trusting a single run.
- **ts-jest peer edges.** ts-jest lists `@jest/transform`, `babel-jest` and `jest` as peerDependencies. The table's
  parent rule uses `dependencies` only, which is acceptable under C1. The regenerated table should state that rule in
  one line so a reader does not count the peer edges as missing.
- **Expected `npm ls` output.** After task 1.1, `npm ls js-yaml` will print `overridden` and may print `invalid` for
  js-yaml 4 under load-nyc-config's `^3.13.1` range. That is expected under ruling Q1, not a failure.
- **Process note.** A first probe of mine mistakenly ran `npm audit` from the worktree root because of a scratch-path
  collision. It wrote r1-r5.json files there, and I deleted them straight away. `git status` afterwards showed only the
  untracked change dir. Those readings were discarded and are not used above.
