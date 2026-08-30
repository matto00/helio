## 1. Tooling — e2e/tsconfig.json

- [x] 1.1 Add `e2e/tsconfig.json` per design.md D1 (own project, `strict: true`, `noEmit: true`, `include: ["**/*.ts", "../playwright.config.ts"]`).
- [x] 1.2 Run `tsc --noEmit -p e2e/tsconfig.json` and fix whatever real type errors surface (no `any`/`@ts-ignore` suppressions — escalate/spinoff anything beyond trivial fixes per design.md D5).

## 2. Tooling — helio-mcp wiring

- [x] 2.1 Add `helio-mcp/tsconfig.typecheck.json` per design.md D1b (`extends: "./tsconfig.json"`, `rootDir: "."`, `include: ["src/**/*.ts", "scripts/**/*.ts"]`, `noEmit: true`); update `helio-mcp/package.json`'s `typecheck` script to `tsc --noEmit -p tsconfig.typecheck.json`. Leave `tsconfig.json`/`npm run build` untouched.
- [x] 2.2 Run `npm --prefix helio-mcp ci && npm --prefix helio-mcp run typecheck`; fix any real errors it surfaces across both `src/` and `scripts/` (same no-suppression rule).

## 3. Gate wiring

- [x] 3.1 Add `check:e2e-types` and `check:helio-mcp-types` scripts to root `package.json` (design.md D4).
- [x] 3.2 Add both new `check:*` lines to `.husky/pre-commit`, alongside the existing `npm run typecheck` line (design.md D2).
- [x] 3.3 Add `npm --prefix helio-mcp ci` + `npm run check:helio-mcp-types` and `npm run check:e2e-types` steps to the `frontend` job in `.github/workflows/ci.yml`, after its existing `npm run typecheck` step; add `helio-mcp/package-lock.json` to that job's `setup-node` `cache-dependency-path` list (design.md D2/D3).

## 4. Tests

- [x] 4.1 Prove `check:e2e-types` red-before-green: introduce a deliberate type error in an `e2e/*.spec.ts` file, run the check, observe failure, revert, observe pass.
- [x] 4.2 Prove `check:helio-mcp-types` red-before-green: introduce a deliberate type error in `helio-mcp/src/`, run the check, observe failure, revert, observe pass; repeat once in `helio-mcp/scripts/` to confirm the broadened `include` (design.md D1b) actually gates that directory.
- [x] 4.3 Run the full `.husky/pre-commit` chain locally (or the equivalent scripts) to confirm no regression in existing checks.
