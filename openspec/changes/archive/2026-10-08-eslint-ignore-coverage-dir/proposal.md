## Why

`jest --coverage` writes an istanbul HTML report into `coverage/`. Its generated
`coverage/lcov-report/block-navigation.js` carries an `eslint-disable` directive that ESLint reports as unused, so
root `npm run lint` (`eslint . --max-warnings=0`) — and therefore the Husky pre-commit hook — fails on a generated
file outside the committer's diff. That invites a `git commit -n` bypass (HEL-1375, found by HEL-1364).

## What Changes

- Add `"**/coverage/**"` to the top-level `ignores` array of the root `eslint.config.cjs`, with a short reason
  comment in the style of the existing `.claude/worktrees/**` / `.concertino/**` comments.
- No other file changes. `frontend/` and `helio-mcp/` have no lint config of their own (verified: no
  `eslint.config.*` / `.eslintrc*` outside the repo root), so the "same gap in frontend/helio-mcp configs" AC
  resolves to "no separate configs exist"; the `**` glob also covers a nested `frontend/coverage/`, which root
  `npm run lint` otherwise trips on in exactly the same way.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — lint tooling only; `.openspec.yaml` sets `skip_specs: true`)

## Impact

- `eslint.config.cjs` only. No runtime, API, schema, or dependency change.
- `.gitignore` already ignores `coverage/` (unanchored, any depth); Prettier 3 reads `.gitignore`, and
  `npm run format:check` was verified to pass with a coverage dir present — neither needs a change.

## Non-goals

- Changing jest coverage settings, `.gitignore`, `.prettierignore`, or adding per-package ESLint configs.
