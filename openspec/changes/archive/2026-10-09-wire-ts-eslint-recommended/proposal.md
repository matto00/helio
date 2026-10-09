## Why

`eslint.config.cjs` spreads `...tseslint.configs.recommended.rules`, but in typescript-eslint 8.x `configs.recommended` is an array of flat-config objects, so the spread is `undefined` and zero `@typescript-eslint/*` rules are active. The repo's "zero-warnings" lint policy has never checked unused vars/imports, explicit `any`, `ban-ts-comment`, etc. in any TS file (frontend/, helio-mcp/, e2e/). Measured on fd99c3dd: wiring the set correctly surfaces 105 errors in 67 files (no-unused-vars 70, no-require-imports 25, no-explicit-any 10). Owner ruling (escalation answered 2026-10-09, channel chat): **fix-all-now-with-conventions**.

## What Changes

- Wire `tseslint.configs.recommended` correctly into the flat config, every entry scoped to `**/*.{ts,tsx}`, placed before the existing TS block so its explicit overrides keep winning.
- Configure `@typescript-eslint/no-unused-vars` with `argsIgnorePattern`/`varsIgnorePattern`/`caughtErrorsIgnorePattern: "^_"` and `ignoreRestSiblings: true` (the codebase's existing `_`-prefix intent convention).
- Turn `@typescript-eslint/no-require-imports` off ONLY for jest test/setup files (`**/*.test.{ts,tsx}`, `frontend/src/test/**`) where `require()` inside `jest.mock` factories is idiomatic; production TS stays covered.
- Fix every remaining violation: delete the ~48 genuine dead imports/vars (keeping any side-effect import as a bare `import "x"`), replace all 10 explicit `any` with real types (type-only, no runtime change).
- Add a guard (`check:eslint-ts-rules` + `:selftest`, wired into `.husky/pre-commit` and CI) that fails if the computed config for a TS file has no active `@typescript-eslint` recommended rules, and whose selftest proves it red against the old broken spread.

## Capabilities

### New Capabilities
- `eslint-typescript-rules-guard`: lint of TypeScript files enforces the typescript-eslint recommended rule set, and a guard fails if that set is ever silently disabled.

### Modified Capabilities

## Impact

- `eslint.config.cjs`, new `scripts/check-eslint-ts-rules.mjs` + selftest, `package.json` scripts, `.husky/pre-commit`, `.github/workflows/ci.yml`.
- ~67 TS files across frontend/src, e2e/, helio-mcp/src (dead-import deletion, `any` → real types).
- **Other open branches** touching frontend/, e2e/ or helio-mcp/ TS files (notably HEL-1430) will hit new lint errors after this merges and must reconcile.
