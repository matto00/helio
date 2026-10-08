## 0. Conventions (read once)

- [x] 0.1 Shell variables do NOT persist between Bash calls. Begin EVERY Bash call with this exact preamble (one line), then your command: `W=/home/matt/Development/helio/.claude/worktrees/task/eslint-ignore-coverage-dir/HEL-1375; S=/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1375-exec; mkdir -p "$S"; export npm_config_cache="$S/npm-cache" npm_config_logs_dir="$S/npm-logs"; cd "$W" || exit 1;`
- [x] 0.2 Never run anything in `/home/matt/Development/helio` (the main checkout). Prefix test/lint runs with `nice -n 19`; always pass `--maxWorkers=2` to jest.
- [x] 0.3 Save every transcript below with `> <file> 2>&1; echo "exit=$?" >> <file>` into `$W/.concertino/evidence/` (gitignored; create it first with `mkdir -p "$W/.concertino/evidence"`), then `scripts/concertino/persist-evidence.sh HEL-1375 <file>` for each.
- [x] 0.4 Edit only `eslint.config.cjs`, `openspec/changes/eslint-ignore-coverage-dir/files-modified.md` (your handoff; list `eslint.config.cjs`), and the checkboxes in this tasks.md. Write no prose claims anywhere not dictated below.
- [x] 0.5 Tick each box in sections 0–5 (`- [ ]` → `- [x]`) only after its step ran and matched its expectation; do it before section 6. NEVER tick the section-6 boxes (6.1–6.3 stay `- [ ]`, so the commit leaves no modified file). Change no other text in this file. Do not use `git stash`.

## 1. Red proofs (BEFORE editing)

- [x] 1.1 `ls -d coverage frontend/coverage` → both "No such file or directory". If either exists, stop and report.
- [x] 1.2 `nice -n 19 npx jest --coverage --maxWorkers=2 helio-mcp/src/tools/read.buildListConnectorsResult.test.ts` → expect `Test Suites: 1 passed` and `Tests: 2 passed`; `coverage/lcov-report/block-navigation.js` now exists.
- [x] 1.3 `nice -n 19 npm run lint` → save as `red-root.txt`. Expect `exit=1`, the path `.../coverage/lcov-report/block-navigation.js`, `Unused eslint-disable directive`, and `✖ 1 problem (0 errors, 1 warning)`. If the output differs, stop and report it verbatim.
- [x] 1.4 Delete by exact path: `rm -rf "$W/coverage"`; `ls -d "$W/coverage"` → "No such file or directory".
- [x] 1.5 `cd "$W/frontend" && nice -n 19 npx jest --config jest.config.cjs --coverage --maxWorkers=2 src/features/pipelines/utils/triggerSourceLabel.test.ts` → expect `Tests: 5 passed`. (Next call starts again with the 0.1 preamble, which returns to `$W`.)
- [x] 1.6 `nice -n 19 npm run lint` (from `$W`) → save as `red-frontend-coverage.txt`. Expect `exit=1` on `.../frontend/coverage/lcov-report/block-navigation.js`, `✖ 1 problem (0 errors, 1 warning)`. Keep `frontend/coverage/` for 3.1.

## 2. Edit eslint.config.cjs

- [x] 2.1 In `eslint.config.cjs`, insert the 7 lines in 2.2 immediately after the line `      ".concertino/**",` and before the line `    ],` (6-space indent, exactly as shown). Change nothing else.
- [x] 2.2 Lines to insert (verbatim):

```js
      // `jest --coverage` writes a generated istanbul HTML report into
      // `coverage/` (root suite) or `frontend/coverage/` (frontend suite). Its
      // `lcov-report/block-navigation.js` carries an eslint-disable directive
      // ESLint reports as unused, so `--max-warnings=0` failed lint and the
      // pre-commit hook on a file outside the committer's diff. Gitignored, but
      // ESLint's flat config does not consult .gitignore.
      "**/coverage/**",
```

- [x] 2.3 `git diff --stat` → expect exactly `eslint.config.cjs | 7 +++++++` (1 file changed, 7 insertions).

## 3. Green proofs (AFTER editing)

- [x] 3.1 `ls -d frontend/coverage/lcov-report` must exist (from 1.5). `nice -n 19 npm run lint` → save as `green-frontend-coverage.txt`. Expect `exit=0` and no `✖` line.
- [x] 3.2 Delete by exact path: `rm -rf "$W/frontend/coverage"`; `ls -d "$W/frontend/coverage"` → "No such file or directory".
- [x] 3.3 Re-run the 1.2 jest command exactly (expect `Tests: 2 passed`, `coverage/lcov-report/block-navigation.js` exists). `nice -n 19 npm run lint` → save as `green-root.txt`. Expect `exit=0` and no `✖` line.
- [x] 3.4 Delete by exact path: `rm -rf "$W/coverage"`; `ls -d "$W/coverage"` → "No such file or directory".

## 5. Other checks

- [x] 5.1 `nice -n 19 npm run format:check` → `exit=0`.
- [x] 5.2 `git ls-files | grep -c '/coverage/\|^coverage/'` → prints `0` and `exit=1` (grep -c exits 1 on zero matches; that is the expected result, not a failure).
- [x] 5.3 `find . -path ./node_modules -prune -o -path ./.claude -prune -o -path '*/node_modules' -prune -o \( -name 'eslint.config.*' -o -name '.eslintrc*' \) -print` → only `./eslint.config.cjs` (confirms no frontend/helio-mcp config to fix).
- [x] 5.4 `git status --short` before commit → only ` M eslint.config.cjs` plus files under `openspec/changes/eslint-ignore-coverage-dir/`.

## 6. Commit

- [x] 6.1 Stage exactly: `git add eslint.config.cjs openspec/changes/eslint-ignore-coverage-dir`.
- [x] 6.2 `git commit -m "HEL-1375 Ignore **/coverage/** in root ESLint config"` with the full Husky hook (no `-n`, no `HUSKY=0`), Bash timeout 600000 ms. If the hook fails or times out, report the failing step verbatim — never bypass or retry with `-n`.
- [x] 6.3 `git status --short` → empty output; `git log --oneline -1` shows the 6.2 message.
