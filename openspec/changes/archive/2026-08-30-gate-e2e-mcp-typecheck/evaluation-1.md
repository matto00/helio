# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `bd61df098e3ab56e40d25118c836d5564d2b9e86` (`task/gate-e2e-and-mcp-typecheck/HEL-797`)

## Phase 1: Spec Review — PASS

Issues: none.

- AC1 (`helio-mcp` typecheck in an enforced gate, passing): met. `check:helio-mcp-types` →
  `npm --prefix helio-mcp run typecheck` → `tsc --noEmit -p tsconfig.typecheck.json`; wired into
  both `.husky/pre-commit` and the CI `frontend` job. Verified passing by my own run.
- AC2 (`e2e/` type-checked by an enforced gate, passing): met. `e2e/tsconfig.json` +
  `check:e2e-types`, wired into both enforcement points. Verified passing.
- AC3 (red-before-green for each gate): independently re-verified by me (not taken on trust) —
  see Phase 2 evidence. Proven for all four covered surfaces.
- Non-goal respected: root `tsconfig.json` is not in `git diff main...HEAD` at all.
- No scope creep: the 20 changed files are exactly the two tsconfigs, the three gate-wiring files,
  the six real type fixes, and the change-dir artifacts. No product code touched.
- Tasks 1.1–4.3 all match what was actually implemented (I read each diff rather than the checkmarks).
- No spec deltas needed (`skip_specs: true`, tooling-only change). Planning artifacts and
  `files-modified.md` accurately describe the final implementation.

## Phase 2: Code Review — PASS

### Gates re-run independently (fresh, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set)

Root `node_modules` was absent, so I ran `npm ci` at root first, then:

| Gate | Result |
| --- | --- |
| `npm run check:e2e-types` | PASS |
| `npm run check:helio-mcp-types` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm test` | PASS |
| `npm --prefix helio-mcp run build` | PASS |

Backend gate (`sbt test`) not run: no `backend/**` file is in the diff.

### Red-before-green re-verification (my own mutations, each reverted and re-run green)

Injected `const __evalProbe: number = "not a number";` into each surface:

| Surface | Gate | Red | Reverted green |
| --- | --- | --- | --- |
| `e2e/hel813-mobile-touch-target-floor.spec.ts` | `check:e2e-types` | TS2322 at :313 | yes |
| `playwright.config.ts` (via the `../playwright.config.ts` include) | `check:e2e-types` | TS2322 at :36 | yes |
| `helio-mcp/src/index.ts` | `check:helio-mcp-types` | TS2322 at :93 | yes |
| `helio-mcp/scripts/verify.ts` | `check:helio-mcp-types` | TS2322 at :352 | yes |

The `scripts/**` probe specifically confirms design.md D1b's broadened `include` actually gates that
directory — the whole reason `tsconfig.typecheck.json` exists. Working tree left clean
(`git status --porcelain` empty after all probes).

### D1b — build output layout untouched

`helio-mcp/tsconfig.json` is not in the diff. After `rm -rf helio-mcp/dist && npm --prefix helio-mcp run build`:
`dist/index.js` exists, which is exactly what `package.json`'s `"bin": { "helio-mcp": "dist/index.js" }`
expects; `dist/` is flat (`config.js`, `context.js`, `helioApi.js`, …) with **no** `dist/scripts/` and
no `dist/src/` re-rooting. The `rootDir: "."` widening is confined to the typecheck-only config.

### Suppression audit

No `any`, `@ts-ignore`, or `@ts-expect-error` introduced anywhere in the diff (the only `any` hits in
`e2e/` are the English word inside two test-description strings). Every green came from a real fix:
- The three e2e specs replace a brittle `Parameters<Parameters<typeof test>[1]>[0]["request"]`
  derivation (which resolves to the wrong `test` overload) with a direct `APIRequestContext` import —
  strictly better typing, identical runtime behavior.
- The three `helio-mcp/scripts/*.ts` files replace a hand-written, structurally-incompatible result
  type with `Awaited<ReturnType<Client["callTool"]>>` plus a `hasContent` type guard. The guard's one
  internal cast is to `{ content?: unknown }` — the standard type-predicate idiom, not an escape hatch.
- `isErrorOf(r)` returns `false` for the legacy `toolResult` shape, which is behavior-preserving:
  the old code read `r.isError` on that shape and got `undefined` (falsy) too.
- `verify.ts`'s `readResource` fix narrows the `text` | `blob` content union with `"text" in …`
  rather than asserting.

### Wiring diffs (read, not inferred from checkmarks)

- `.husky/pre-commit`: both `check:*` lines added immediately after `npm run typecheck`, inside the
  existing `set -e` chain, so a failure aborts the commit.
- `.github/workflows/ci.yml` (`frontend` job): `npm --prefix helio-mcp ci` added alongside the other
  installs *before* the checks; both `check:*` steps added after `npm run typecheck`; each is its own
  `run` step so a non-zero exit fails the job. `helio-mcp/package-lock.json` added to
  `cache-dependency-path` and confirmed tracked (`git ls-files`), so `npm ci` there will not fail.
- Root `package.json`: `typescript` and `@playwright/test` are already root devDependencies, so both
  new scripts resolve their compiler and types from the root install CI already performs.

### Checklist

DRY: see the non-blocking note below — otherwise clean. Readable, modular, type-safe, no dead code,
no over-engineering, no drive-by behavior changes. No security/error-handling surface in this change.
Tests: this ticket's "tests" are the gates themselves, and their failability is proven by mutation
above (per `red-vs-guard`, that is the right evidence here).

## Phase 3: UI Review — N/A

No trigger path changed: the diff touches no `frontend/**`, no
`backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**`, and no `openspec/specs/**`
(only `openspec/changes/**`, which is not a trigger). Dev servers not started.

## Overall: PASS

## Change Requests

None.

## Non-blocking Suggestions

- `hasContent` / `textOf` / `isErrorOf` are now identical in all three of
  `helio-mcp/scripts/compose.ts`, `verify-bound-panel.ts`, and `verify.ts`. `textOf` was already
  duplicated before this change, so this is not a regression introduced here, but the triplet is now
  ~14 lines × 3. A `helio-mcp/scripts/support/toolResult.ts` shared module would be a clean small
  follow-up — deliberately out of scope for a gate-wiring ticket.
- `verify.ts` declares `isErrorOf` *after* its first use in `parse` (line ~292 vs ~296). Legal via
  hoisting and the compiler is happy; moving it above `parse` would read better.
