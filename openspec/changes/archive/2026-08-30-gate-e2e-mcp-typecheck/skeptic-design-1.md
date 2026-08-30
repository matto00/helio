## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Root `tsconfig.json` unusable as a gate — CONFIRMED.** `cat tsconfig.json`: no
  `include`, `"module": "commonjs"`, `"moduleResolution": "node"`, `jsx: react-jsx`,
  only an `exclude`. The plan's rejection of it is well grounded.
- **`e2e/` inventory — CONFIRMED.** `git ls-files e2e/` → 9 `*.spec.ts` +
  `e2e/support/touchTargetProbe.ts` + `README.md`. `playwright.config.ts` is at the
  repo ROOT with `testDir: "./e2e"` — design.md Context states this correctly, and
  D1's `include: ["**/*.ts", "../playwright.config.ts"]` is the right consequence.
- **`e2e/` imports — CHECKED.** Only `@playwright/test`, `node:fs/promises`,
  `node:path`, and a relative `./support/touchTargetProbe`. No imports into
  `frontend/src`, so no cross-project reference is needed. `@types/node@25.3.2` is
  present in the root lockfile (dev), so `node:` builtins will resolve — the plan's
  omission of an `@types/node` step is not a defect.
- **`helio-mcp` — PARTIALLY CONFIRMED.** `helio-mcp/package.json` does declare
  `"typecheck": "tsc --noEmit"`; `helio-mcp/tsconfig.json` is `NodeNext`/`strict`/
  `noUncheckedIndexedAccess` as claimed; `helio-mcp/package-lock.json` IS tracked, so
  `npm --prefix helio-mcp ci` is viable. **But** `include` is `["src/**/*.ts"]` with
  `rootDir: "src"` — see CR1.
- **`.husky/pre-commit` — CONFIRMED.** Flat list including `npm run typecheck`
  (→ `npm --prefix frontend run typecheck`); adding two `check:*` lines (D2/D4) fits
  the existing convention exactly, and the `check:` vs non-`check:` naming
  distinction the hook comment relies on is respected.
- **`.github/workflows/ci.yml` — CONFIRMED with one gap.** `frontend` job runs
  `npm ci`, `npm --prefix frontend ci`, lint/typecheck/format/dependabot/test — no
  Java, no DB, so D3's placement there is correct and cheaper than the `e2e` job
  (which does stand up Postgres + sbt + Vite + Playwright browsers just to run one
  spec). Gap: see CR2. `ci-complete` aggregates `[frontend, backend, security, e2e]`,
  so a new step in `frontend` is genuinely enforced by the `main` ruleset.
- **Red-before-green AC** is carried into tasks 4.1/4.2 with a concrete mutation
  procedure for each gate — adequate.
- **Scope discipline** holds: root-tsconfig repair is a stated non-goal in both
  proposal and design, matching the ticket; no product surface is touched.

### Verdict: REFUTE

Two concrete, small revisions. The plan's architecture (dedicated `e2e/tsconfig.json`,
`check:*` scripts, pre-commit + `frontend`-job CI placement) is sound and I would
otherwise pass it — both items below are gaps in coverage/wiring, not redesigns.

### Change Requests

1. **`helio-mcp/scripts/*.ts` are left ungated, and no decision records why.**
   `git ls-files helio-mcp` shows three tracked, non-trivial TypeScript files —
   `helio-mcp/scripts/verify.ts`, `helio-mcp/scripts/compose.ts`,
   `helio-mcp/scripts/verify-bound-panel.ts` — that are outside
   `helio-mcp/tsconfig.json`'s `include: ["src/**/*.ts"]` and are therefore still
   type-checked by **nothing** after this change ships. The ticket is titled
   "Type-check the remaining ungated TypeScript" and proposal.md asserts `e2e/` and
   `helio-mcp` are "the last two TypeScript surfaces … checked by nothing"; with
   `scripts/` excluded that claim is false as written. This is not a wiring detail:
   `rootDir: "src"` means `scripts/` cannot simply be added to the existing
   `include` without either dropping/raising `rootDir` (which would move `dist/`
   output and break `bin: dist/index.js`) or adding a separate typecheck-only
   config (e.g. `helio-mcp/tsconfig.typecheck.json` with `noEmit`, no `rootDir`,
   `include: ["src/**/*.ts", "scripts/**/*.ts"]`) that the `typecheck` script
   points at. Add an explicit decision to design.md — either cover `scripts/` (with
   the `rootDir`/`outDir` consequence spelled out and a task) or defer it to a named
   spinoff — and correct proposal.md's "last two surfaces" claim accordingly.
   Do not leave this implicit for the executor to discover mid-run.

2. **Task 3.3 adds `npm --prefix helio-mcp ci` to the `frontend` job but nothing
   updates that job's npm cache key.** `.github/workflows/ci.yml` `frontend` job's
   `actions/setup-node` sets `cache-dependency-path: | package-lock.json /
   frontend/package-lock.json`. `helio-mcp/package-lock.json` must be added to that
   list, or the new install runs against a cache key that never changes when
   `helio-mcp`'s lockfile does. Add it explicitly to task 3.3 (and mention it in
   D3), so it is not left to chance.

### Non-blocking notes

- D1 says the `e2e/tsconfig.json` should use "target ES2022/NodeNext-compatible
  settings … where reasonable" — `module`/`moduleResolution` are not pinned. Given
  the root `package.json` is `"type": "commonjs"` while `playwright.config.ts` and
  the specs use ESM syntax, the executor should expect to settle on explicit values
  (e.g. `module`/`moduleResolution: "bundler"` or `NodeNext`) rather than defaults.
  Low risk — it iterates to green — but worth pinning in the config with a comment.
- D2's "pre-commit AND CI" doubles two `tsc` passes onto an already long hook.
  Acceptable, but if hook latency becomes a complaint, `check:e2e-types` is the
  cheaper one to drop to CI-only.
- Task 4.3's "run the full pre-commit chain locally" will be the first thing to
  surface a missing `helio-mcp/node_modules` (absent in this worktree right now) —
  design.md's Gate-Chain Implications checklist already predicts this fail-loud
  behavior correctly, and no auto-install in the hook is the right call.
