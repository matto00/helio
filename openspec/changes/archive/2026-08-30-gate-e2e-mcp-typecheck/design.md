## Context

See proposal.md - Why. Ground truth checked directly in this worktree:

- Root `tsconfig.json` has no `include`, uses `commonjs`/`node` resolution — confirmed
  unusable as a gate (per ticket, ~218 error lines, mostly resolution artifacts).
- `e2e/` has 9 `*.spec.ts` files + `support/touchTargetProbe.ts`; the Playwright config
  lives at repo root (`playwright.config.ts`, `testDir: "./e2e"`), not inside `e2e/`.
- `helio-mcp/package.json` already declares `"typecheck": "tsc --noEmit"` and a
  well-formed `tsconfig.json` (`NodeNext`, `strict`, `noUncheckedIndexedAccess`,
  `include: ["src/**/*.ts"]`). It is explicitly "standalone — not part of the root
  npm workspace" (its own `package.json` description) — its own `node_modules` must
  be installed separately (`npm --prefix helio-mcp ci`), mirroring how `frontend/`
  is already installed as its own workspace member in both `.husky/pre-commit`'s
  implicit assumption and `.github/workflows/ci.yml`'s explicit `npm --prefix frontend ci`.
- `.husky/pre-commit` already runs `npm run typecheck` (delegates to
  `frontend`'s `tsc --noEmit`) plus a flat list of other `check:*` scripts.
- `.github/workflows/ci.yml`'s `frontend` job runs `npm run typecheck` (frontend
  only); its separate `e2e` job runs ONE spec file
  (`e2e/hel813-mobile-touch-target-floor.spec.ts`) against live backend+frontend dev
  servers — it does not type-check anything, and has no Java/DB dependency needed
  for a type-check (a pure `tsc` pass needs no running servers).

## Goals / Non-Goals

**Goals:**
- A dedicated `e2e/tsconfig.json` that type-checks `e2e/**/*.ts` plus
  `playwright.config.ts`, is red on a real type error, and green otherwise.
- `helio-mcp`'s existing `typecheck` script running in an enforced gate
  (pre-commit and/or CI), with its own dependency install path wired wherever
  it runs.
- Both gates proven red-before-green per the ticket's acceptance criteria.

**Non-Goals:**
- Repairing the root `tsconfig.json` (explicit ticket non-goal; needs project
  references, its own change).
- Broadening the existing `e2e` CI job's Playwright *test execution* scope
  (still explicitly single-spec per its own comment) — this change adds
  *type-checking*, not new test execution.
- Any change to `helio-mcp`'s or `e2e/`'s runtime behavior.

## Decisions

**D1 — `e2e/tsconfig.json` location and shape.** Create `e2e/tsconfig.json` as its
own project (not extending the root config, which is unusable per Context) with
`include: ["**/*.ts", "../playwright.config.ts"]` relative to `e2e/`, target
ES2022/NodeNext-compatible settings matching `frontend/tsconfig.json`'s strictness
posture where reasonable (`strict: true`), and `noEmit: true`. Alternative
considered: repo-root project references splitting `tsconfig.json` into
`tsconfig.e2e.json` — rejected as out of scope (ticket explicitly defers root
config work) and because `e2e/tsconfig.json` mirrors `helio-mcp`'s existing
self-contained-tsconfig-per-area pattern already proven in this repo.

**D1b — `helio-mcp/scripts/*.ts` are also ungated and must be covered.**
`helio-mcp/tsconfig.json`'s `include: ["src/**/*.ts"]` with `rootDir: "src"`
leaves three tracked, non-trivial files — `helio-mcp/scripts/verify.ts`,
`helio-mcp/scripts/compose.ts`, `helio-mcp/scripts/verify-bound-panel.ts` —
checked by nothing, which falsifies this ticket's own "last two ungated
TypeScript surfaces" framing if left as-is (skeptic design-gate round 1,
CR1). Decision: **cover them**, via a typecheck-only sibling config,
`helio-mcp/tsconfig.typecheck.json`, that `extends: "./tsconfig.json"` and
overrides `rootDir: "."` (removing the `src`-only constraint) and
`include: ["src/**/*.ts", "scripts/**/*.ts"]`, with `noEmit: true` set
explicitly (inherited from the base config, restated for clarity). The
existing build-facing `tsconfig.json` (`rootDir: "src"`, `outDir: "dist"`,
`bin: dist/index.js`) is left completely untouched — `npm run build`'s
output layout does not change. `helio-mcp/package.json`'s `typecheck`
script is updated to `tsc --noEmit -p tsconfig.typecheck.json` so the one
enforced gate covers both `src/` and `scripts/`. Alternative considered:
widen `tsconfig.json` itself (`rootDir: "."`) — rejected because that also
changes `tsc`'s (non-`--noEmit`) build behavior, moving `dist/index.js` to
`dist/src/index.js` and breaking the `bin` entry — out of scope for a
type-check-only change.

**D2 — gate placement: pre-commit AND CI, matching each area's existing pattern.**
`helio-mcp`'s typecheck is wired into `.husky/pre-commit` (same tier as the
existing `npm run typecheck` frontend line) and into a new CI step. `e2e`'s
typecheck is wired the same way. Rationale: HEL-683's own frontend fix runs in
both places; matching that gives the same fast local feedback loop plus CI
enforcement, not one without the other. Alternative considered: CI-only (skip
pre-commit) — rejected because the ticket's origin note explicitly wants parity
with "where the frontend gate now runs," which is pre-commit-first.

**D3 — CI step placement.** Add both new typecheck steps to the existing
`frontend` CI job (after its current `npm run typecheck` line), not the `e2e`
job — a `tsc --noEmit` pass needs no running dev servers, no Postgres, no JVM,
so tacking it onto the already-Java/DB-provisioned `e2e` job would be pure
waste. `helio-mcp`'s own `npm --prefix helio-mcp ci` step is added right before
its typecheck step, mirroring the job's existing `npm --prefix frontend ci`.
The `frontend` job's `actions/setup-node` `cache-dependency-path` list (currently
`package-lock.json` / `frontend/package-lock.json`) must also gain
`helio-mcp/package-lock.json` (tracked — confirmed via `git ls-files`) — otherwise
the new `npm --prefix helio-mcp ci` runs against a cache key that never changes
when that lockfile does (skeptic design-gate round 1, CR2).

**D4 — new root-level npm scripts.** Add `check:e2e-types` (`tsc --noEmit -p
e2e/tsconfig.json`) and `check:helio-mcp-types` (`npm --prefix helio-mcp run
typecheck`) to the root `package.json`, following the existing `check:*` naming
convention used by every other pre-commit-gated script in that file, rather than
inlining raw `tsc`/`npm --prefix` calls directly into `.husky/pre-commit` or
`ci.yml` (consistent with how every other hygiene check is already wrapped).

**D5 — real errors found by the new config get fixed in-scope; anything larger
gets flagged, not suppressed.** Per the ticket's explicit acceptance criterion,
no `any`/`@ts-ignore` blanket fixes. If the first clean `e2e/tsconfig.json` run
surfaces something beyond a trivial type annotation fix, escalate/spin off
per the ticket's own instruction rather than silently widening scope.

## Risks / Trade-offs

- [Risk] A stricter `e2e/tsconfig.json` (e.g. `strict: true`) surfaces real
  latent type errors across 9 spec files → Mitigation: fix genuinely
  in-scope issues; anything requiring architectural change gets a spinoff
  ticket per D5, not a suppression.
- [Risk] `helio-mcp` typecheck in CI needs its own `npm ci` step, adding
  runtime to the `frontend` job → Mitigation: `helio-mcp`'s dependency tree
  is small (MCP SDK + zod + dev tooling); negligible compared to the job's
  existing Playwright browser install in the `e2e` job (not touched here).
- [Risk] Pre-commit hook grows slower with two more `tsc` invocations →
  Mitigation: both are fast, focused `--noEmit` passes over small file sets;
  consistent with the existing hook's already-substantial check list.

## Gate-Chain Implications Checklist

`.husky/pre-commit` is touched by this change (D2/D4 add two new `check:*` lines).

- **What does it execute?** Two additional `npm run` invocations: `check:e2e-types`
  (`tsc --noEmit -p e2e/tsconfig.json`) and `check:helio-mcp-types` (`npm --prefix
  helio-mcp run typecheck`, itself `tsc --noEmit` inside `helio-mcp/`). Both are
  pure, read-only TypeScript compiler passes — no code generation, no network I/O.
- **What environment does it inherit, and from where?** The same shell environment
  every other pre-commit line already inherits — the committer's local shell via
  Husky's hook invocation. No new env vars are introduced; `tsc --noEmit` needs
  none. `check:helio-mcp-types` additionally requires `helio-mcp/node_modules` to
  already be installed locally (`npm --prefix helio-mcp install`) — exactly the
  same precondition `frontend/node_modules` already has for the existing
  `npm run typecheck` line; this is a new *local setup* requirement, not a new
  environment-inheritance risk.
- **Does it write anything outside its own sandbox?** No. `tsc --noEmit` writes
  nothing to disk; it only prints diagnostics and sets an exit code.
- **Does it behave differently from a linked worktree than from a main checkout?** No — both new checks resolve relative to the repo they run in
  (`e2e/tsconfig.json` and `helio-mcp/tsconfig.json` are committed, relative
  paths only), identically whether that repo root is a worktree or a primary
  checkout. Neither depends on `.git` internals the way `scripts/concertino/`'s
  git-child-env selftest does.
- **What happens on its first run?** If `helio-mcp/node_modules` is missing
  (never installed on this machine before), `npm --prefix helio-mcp run
  typecheck` fails with a normal "tsc: command not found" / module-resolution
  error, not a silent no-op or a false pass — this is the same fail-loud
  behavior the existing frontend typecheck line already has when
  `frontend/node_modules` is missing. No auto-install is added to the hook
  itself (consistent with the hook's existing behavior for every other check).

## Planner Notes

- Chose CI placement in the `frontend` job (D3) rather than the `e2e` job on the
  reasoning that a pure type-check has no runtime dependency on the servers that
  job stands up — self-approved as an implementation-scope call, not a product
  decision.
- `skip_specs: true` set in `.openspec.yaml` — this change has zero spec-level
  behavior changes (pure CI/tooling wiring).
