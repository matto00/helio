## Context

- Root `eslint.config.cjs` is the only ESLint config in the repo (`find . -name 'eslint.config.*' -o -name
  '.eslintrc*'`, excluding `node_modules`/`.claude`, returns only `./eslint.config.cjs`).
- ESLint is v9.39.3 (cwd-based config lookup). `frontend`'s `lint` script is `eslint src --max-warnings=0`; run from
  `frontend/`, `eslint --debug` shows it resolves the root `eslint.config.cjs`. It lints only `src`, so it never
  reaches `frontend/coverage/`. `helio-mcp` has no `lint` script; its files are linted only by root `eslint .`.
- `helio-mcp` tests run under the ROOT `jest.config.cjs`, so root `jest --coverage` writes root `coverage/`. The
  frontend suite (`frontend/jest.config.cjs`) with `--coverage` writes `frontend/coverage/`.

### Orchestrator's pre-plan probe (worktree, main @ 002249226, before any edit)

- `npx jest --coverage --maxWorkers=2 helio-mcp/src/tools/read.buildListConnectorsResult.test.ts` → 1 suite /
  2 tests pass; creates `coverage/lcov-report/{block-navigation.js,prettify.js,sorter.js,...}`.
- Then `npm run lint` → exit 1, exactly one finding:
  `coverage/lcov-report/block-navigation.js  1:1  warning  Unused eslint-disable directive (no problems were
  reported)`, `✖ 1 problem (0 errors, 1 warning)`, `ESLint found too many warnings (maximum: 0).`
- `npx eslint . --max-warnings=0 --ignore-pattern '**/coverage/**'` → exit 0 (equivalent of the fix).
- Same red reproduces with ONLY `frontend/coverage/` present (created by `npx jest --config jest.config.cjs
  --coverage --maxWorkers=2 src/features/pipelines/utils/triggerSourceLabel.test.ts` in `frontend/`), on
  `frontend/coverage/lcov-report/block-navigation.js`. `frontend`'s own `npm run lint` exits 0 in that state.
- `npm run format:check` exits 0 with a coverage dir present; `git status --short` stays empty (gitignored).

## Goals / Non-Goals

**Goals:** root `npm run lint` (and the pre-commit hook's lint step) is unaffected by any `coverage/` directory at
any depth.

**Non-Goals:** per-package ESLint configs; jest/prettier/gitignore changes.

## Decisions

1. **Glob `**/coverage/**`, not `coverage/**`.** The ticket names `**/coverage/**`, and the probe shows the nested
   `frontend/coverage/` case fails root lint identically. Alternative `coverage/**` would leave that open.
2. **Placement:** last entry of the top-level `ignores` array, after `".concertino/**",`, with a comment in the same
   `//` style explaining why (generated report, unused-directive warning, `--max-warnings=0`, not consulted
   `.gitignore`). Exact wording is fixed in tasks.md so the executor writes no unverified claims.
3. **No change to `frontend/` / `helio-mcp/`**: there is no config there to change; the root glob covers both.

## Risks / Trade-offs

- A hand-written source directory named `coverage/` would also be ignored. None exists in the tree today
  (`git ls-files | grep -c '/coverage/\|^coverage/'` is the check — must print 0).

## Planner Notes

- Self-approved: `skip_specs: true` (tooling only, no behavior spec changes), per openspec's own instruction.
- Self-approved: treat the frontend/helio-mcp AC as answered-by-investigation, not a scope change.
