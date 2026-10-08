## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 002249226fadcbbe8d33eb0f00000c89de80cf73 (change dir untracked). Cold review; prior reports not relied on.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/eslint-ignore-coverage-dir/HEL-1375`.
- **AC1 (glob + comment):** `eslint.config.cjs` line 36 is exactly `      ".concertino/**",` (grep -c of the anchored line = 1), line 37 `    ],`. I applied the 7 lines from tasks.md 2.2 by `sed .../r` into an untracked temp copy (`zz-skeptic.eslint.config.cjs`, deleted afterwards; tracked files untouched). `diff` showed a pure 7-line insertion after line 36. Longest line is 80 chars. The comment style matches the existing `.claude/worktrees` / `.concertino` comments.
- **Every factual claim in the 2.2 comment checked against live files:**
  - `coverage/lcov-report/block-navigation.js` line 1 is `/* eslint-disable */`.
  - ESLint reports it as `Unused eslint-disable directive`.
  - The root suite writes `coverage/` and the frontend suite writes `frontend/coverage/` (neither jest config sets `coverageDirectory`; I observed both directories being created).
  - `.gitignore:23` has `coverage/`.
  - The flat config has no gitignore import. The existing comment already makes the same claim, and the red result proves it.
- **AC2 red/green, reproduced:**
  - 1.2: `Test Suites: 1 passed`, `Tests: 2 passed`, block-navigation.js created.
  - 1.3: `npm run lint` printed `.../HEL-1375/coverage/lcov-report/block-navigation.js 1:1 warning Unused eslint-disable directive`, `✖ 1 problem (0 errors, 1 warning)`, `exit=1`. This matches the expectation verbatim.
  - 1.5: `Tests: 5 passed`.
  - 1.6: the same single warning on `frontend/coverage/lcov-report/block-navigation.js`, `exit=1`.
  - Green, simulated: with `frontend/coverage/` present, `eslint . --max-warnings=0 -c <temp config with the exact insertion>` → exit 0. Also `--ignore-pattern '**/coverage/**'` → exit 0.
- **AC3:** the 5.3 `find` prints only `./eslint.config.cjs`. `frontend/package.json` lint is `eslint src --max-warnings=0`. `helio-mcp/package.json` has no lint script. "No separate config to fix" holds.
- **Other expectations:**
  - 5.1 `format:check` → exit 0, even with `frontend/coverage/` present.
  - 5.2 prints `0`, grep exit 1, as stated.
  - 2.3: the change dir is untracked (`?? openspec/changes/eslint-ignore-coverage-dir/`), so ticked tasks.md boxes do not appear in `git diff --stat`. The stat will be eslint.config.cjs only, as claimed.
  - `openspec/` is in `.prettierignore` and ESLint ignores, so the executor's markdown edits cannot trip the format or lint gates.
  - `check-openspec-hygiene.mjs` only flags `files-modified.md` in ARCHIVED changes and only flags 100%-complete overdue changes, so committing an active, incomplete change dir is fine.
  - `persist-evidence.sh` exists.
- **Executability:**
  - The 0.1 preamble is self-contained per call.
  - 1.5's `cd "$W/frontend" &&` works after the preamble.
  - Step order keeps `frontend/coverage/` alive from 1.6 through 3.1, then deletes it by exact path before 3.3.
- **Cleanup:** I removed my `coverage/` and `frontend/coverage/` by exact path. Final `git status --short` shows only the untracked change dir.

### Verdict: CONFIRM

### Non-blocking notes

- The section numbering skips 4 (1, 2, 3, 5, 6). This is cosmetic.
- 6.1–6.3 stay unticked by design, so tasks.md never reaches 100%. The orchestrator must tick them, or account for that, at archive time.
- The 6.2 hook runs the full `npm test` (root plus frontend jest at default workers). It could approach the 600000 ms Bash cap. The task already says to report rather than bypass.
