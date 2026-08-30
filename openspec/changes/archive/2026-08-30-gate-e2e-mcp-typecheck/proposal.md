## Why

`e2e/` Playwright specs and `helio-mcp` (including its `src/` server code and its
`scripts/` verification harnesses) are the TypeScript surfaces in the repo checked
by nothing in the enforced gate set (HEL-683 closed this gap for `frontend/` but
scoped itself there deliberately). Without a gate, a type error in any of these
lands silently — a real risk right before HEL-907 rewrites `helio-mcp` against the
new Outputs model and needs a working type-check as its safety net.

## What Changes

- Add `e2e/tsconfig.json` (its own project, not the broken root config) covering
  the 9 tracked `*.spec.ts` files plus `playwright.config.ts` and `support/`.
- Fix whatever real type errors that config surfaces in `e2e/`.
- Broaden `helio-mcp`'s typecheck to also cover `helio-mcp/scripts/*.ts`
  (currently outside its `src/`-only `include`), via a dedicated typecheck-only
  tsconfig that leaves the build config untouched.
- Wire `helio-mcp`'s (now-broadened) `typecheck` script into the pre-commit hook
  chain (matching how the frontend gate runs) and/or CI.
- Add an `e2e:typecheck` script (or equivalent) and wire it the same way.
- Prove both new gates fail on a deliberate type error, then pass again
  (red-before-green), per the ticket's acceptance criteria.

## Capabilities

### New Capabilities

(none — this is tooling/CI-gate wiring, not a product-facing capability)

### Modified Capabilities

(none — no spec-level behavior changes; see `skip_specs: true` in `.openspec.yaml`)

## Non-goals

- Repairing the root `tsconfig.json` (needs per-area project references; its own
  change per the ticket's explicit non-goal).
- Rewriting `helio-mcp` or `e2e/` specs for the Outputs remodel (HEL-907/P1.6/P1.7).
- Suppressing pre-existing type errors with `any`/`@ts-ignore` to force green —
  any errors outside clear wiring/config scope get fixed for real or spun off.

## Impact

- `e2e/tsconfig.json` (new), possibly minor `e2e/**/*.ts` fixes.
- `.husky/pre-commit` (or CI workflow) — new typecheck steps for `helio-mcp` and `e2e/`.
- `helio-mcp/package.json` untouched (script already exists) unless a new
  composite script is added for convenience.
