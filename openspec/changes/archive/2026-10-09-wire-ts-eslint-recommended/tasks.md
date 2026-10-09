## Standing Constraints

- [C1] Every dead-import/var removal must be a true no-op: if an import has a side effect (CSS, polyfill, module registration), keep it as a bare side-effect import and list it in files-modified.md and the PR body.
- [C2] Every `any` replacement is type-only (no runtime change); `npm run typecheck`, `check:e2e-types`, `check:helio-mcp-types` and full jest (root + frontend) must be green.
- [C3] `@typescript-eslint/no-require-imports` is off ONLY for jest test/setup files; production TS keeps it.
- [C4] Zero errors and zero warnings from `npm run lint` at the end; no new `eslint-disable` comment unless individually justified in files-modified.md.
- [C5] Config change and all fixes land together (pre-commit lint gate); never `--no-verify`/`HUSKY=0`.

## 1. Red first

- [x] 1.1 On the unmodified branch, record `npx eslint --print-config frontend/src/main.tsx` showing 0 `@typescript-eslint/*` rules, and a stdin probe (unused import + unused var + explicit `any`) as `frontend/src/__probe__.ts` exiting 0. Save transcript as evidence.

## 2. Config wiring

- [x] 2.1 Replace the broken spread with the scoped recommended entries (design D1).
- [x] 2.2 Add no-unused-vars options (D2) and the test-file no-require-imports override (D3).
- [x] 2.3 Re-run the probe: now errors for no-unused-vars and no-explicit-any. Record `npx eslint . -f json` per-rule counts and confirm only no-unused-vars (~48) and no-explicit-any (10) remain.

## 3. Fix violations

- [x] 3.1 Remove dead imports/vars in frontend/src (audit each for side effects per C1/D4).
- [x] 3.2 Remove dead imports/vars in e2e/ and helio-mcp/src.
- [x] 3.3 Replace the 10 `any`s with real types (D5).
- [x] 3.4 `npm run lint` exits 0 with zero warnings; `npm --prefix frontend run lint` too.

## 4. Guard

- [x] 4.1 Write `scripts/check-eslint-ts-rules.mjs` (D6).
- [x] 4.2 Write `scripts/check-eslint-ts-rules.selftest.mjs` proving red against the old spread shape and green on the real config.
- [x] 4.3 Wire `check:eslint-ts-rules` and `:selftest` into package.json, `.husky/pre-commit`, and a ci-complete-gated job in `.github/workflows/ci.yml`; `node scripts/check-precommit-ci-parity.mjs` passes.
- [x] 4.4 Mutation proof: temporarily restore the broken spread in `eslint.config.cjs`, confirm `check:eslint-ts-rules` fails, restore.

## 5. Verify

- [x] 5.1 `npm run typecheck`, `npm run check:e2e-types`, `npm run check:helio-mcp-types`, `npm run format:check`.
- [x] 5.2 Full jest (root + frontend) green, under `nice -n 19`.
- [x] 5.3 Commit (single commit, hooks run).
