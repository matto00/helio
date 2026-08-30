# HEL-797: Type-check the remaining ungated TypeScript: e2e/ specs and helio-mcp

## Description

Row 0e of the Pipelines & Outputs remodel (HEL-903) — parallel with 0a–P1.3, must land before P1.4 (HEL-907), which rewrites helio-mcp and needs the typecheck gate to catch its own mistakes. Also gates the `e2e/` specs that P1.6/P1.7 rewrite.

HEL-683 closed the type-check gap for `frontend/`, but deliberately scoped itself there. Two TypeScript surfaces are still checked by nothing in the enforced gate set:

1. **`e2e/` Playwright specs** — currently 9 tracked `*.spec.ts` files (grew from 7 since ticket filing) plus `playwright.config.ts`. Nothing type-checks them. The obvious move — gate on the repo-root `tsconfig.json` — does NOT work: that config has no `include`, uses `commonjs`/`node` module resolution, and emits ~218 error lines, overwhelmingly resolution artifacts (`TS1343 import.meta`, `TS2307 react-grid-layout/core`, `TS2307 vite`) rather than real defects. Needs a dedicated `e2e/tsconfig.json` (or project references), not a root-config gate.

2. **`helio-mcp`** — already has `"typecheck": "tsc --noEmit"` in its `package.json`, and its own well-formed `tsconfig.json` (`NodeNext`, `strict`, `noUncheckedIndexedAccess`). Nothing ever runs it. `helio-mcp` is absent from CI entirely. Cheapest fix: the script exists, it just needs wiring.

## Scope

- Wire the existing `helio-mcp` `typecheck` script into CI (and/or pre-commit), matching where the frontend gate now runs.
- Give `e2e/` a working tsconfig and gate it. Expect to fix whatever the first clean run surfaces.
- Do NOT attempt to repair the root `tsconfig.json` as part of this — that is its own change (needs per-area project references).

## Acceptance Criteria

- [ ] `helio-mcp`'s `typecheck` runs in an enforced gate and passes.
- [ ] `e2e/` TypeScript is type-checked by an enforced gate and passes.
- [ ] Each new gate is proven red-before-green: introduce a deliberate type error, observe the gate fail, revert, observe green.

## Origin

Declared non-goal of HEL-683 (PR #414); raised again in its final-gate review.

## Notes for the executor

- The design spec at `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` (on `main`) wins wherever it disagrees with this ticket, but this ticket is purely about type-checking infrastructure (CI/pre-commit wiring + tsconfig), not product surface — no Data Types/Metrics concepts are touched here, so no conflict is expected. Read it anyway if any ambiguity arises about what "in scope" tooling looks like post-remodel.
- Prove failability by mutation for BOTH new gates before claiming success — this is an explicit acceptance criterion, not optional diligence.
- If fixing pre-existing type errors in e2e/ or helio-mcp balloons beyond wiring/config scope, do NOT suppress with `any`/`@ts-ignore`. Fix what's clearly in scope; escalate or flag remainder for a spinoff with suppressions explicitly inventoried.
