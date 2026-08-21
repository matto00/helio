## Why

No whole-program type check is enforced anywhere in this repo: `npm run build` is `vite build`, which transpiles
without type-checking, and neither `.husky/pre-commit` nor the CI frontend job runs `tsc`. (`ts-jest` incidentally
checks modules reachable from a test — exactly why the historical errors escaped: nothing imported them.) Measured:
`12fae281`'s source, against today's `node_modules`, yields 60 `tsc` error lines; by `d7815d15` they were gone,
fixed incidentally by an unrelated commit. Nothing observed the debt arriving or leaving.

## What Changes

- Add `"typecheck": "tsc --noEmit"` to `frontend/package.json`, matching the existing `helio-mcp` script name, plus
  a root passthrough so the gate is invoked the way `lint` is.
- Wire `typecheck` into both gate sets — `.husky/pre-commit` (enforcing, though bypassable with `-n`) and the CI
  frontend job (advisory: helio has no branch protection). Measured cost ~5s.
- Correct `frontend/tsconfig.json`'s `include`: it lists `tests`, which does not exist, while `vite.config.ts` and
  `pwa-assets.config.ts` are checked by nothing. Proven live — a type error in `vite.config.ts` is invisible today.
- Update every live **hand-maintained** enumeration of the gate set — CONTRIBUTING.md, both CLAUDE.md sites,
  README.md, and the `.cursor` delivery skill. (The `concertino sync`-rendered agent definitions also enumerate it
  and will still understate it — deferred by D6, disclosed, not silently skipped.)
- Prove it red-before-green: observe the script and hook legs fail on a deliberate type error, then go green; assert
  the CI leg mechanically and confirm from the run log that it executed.

## Capabilities

### New Capabilities

- `frontend-type-check-gate`: the `typecheck` script, the surface it covers, its pre-commit/CI wiring, documentation
  parity, and the requirement that it demonstrably fails.

### Modified Capabilities

None. No product behavior or API contract changes.

## Impact

- `frontend/package.json`, `package.json`, `frontend/tsconfig.json`, `.husky/pre-commit`, `.github/workflows/ci.yml`,
  `CONTRIBUTING.md`, `README.md`, `CLAUDE.md`, `.cursor/skills/linear-ticket-delivery/SKILL.md`.
- No runtime, API, or schema change. No new dependency: `typescript@^5.9.3` is already a devDependency in both
  manifests.

## Non-goals

- Fixing type errors in `frontend/src`: none remain. AC 1 is already satisfied by prior work; this makes that state
  enforced rather than accidental.
- `e2e/` or `helio-mcp/` coverage, and repairing the root `tsconfig.json` (218 error lines under `commonjs`/`node`).
- Adding a `typecheck` entry to `concertino.config.json` (needs a disallowed `concertino sync`) and applying the
  capability delta to `openspec/specs/` (HEL-775 owns that tree). Both deferred with follow-ups.
- Enabling branch protection, a repo-admin action outside a code change.
