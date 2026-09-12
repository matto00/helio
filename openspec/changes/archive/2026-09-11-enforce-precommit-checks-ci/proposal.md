## Why

Four checks (`check:repo-integrity`, `check:scala-quality`, `check:schemas`, `check:spec-structure`) run only in
`.husky/pre-commit`. No CI workflow runs them by npm-script name or underlying script path. A commit made with
`--no-verify`/`HUSKY=0`, or from a worktree where hooks don't fire, ships these unenforced while `ci-complete`
still goes green — there is no backstop, unlike the disclosed-`git commit -n` assumption `CLAUDE.md` states
elsewhere. Found investigating a HEL-1080 "[CI Bypass]" flag.

## What Changes

- Add the four checks to `.github/workflows/ci.yml`, wired into a job `ci-complete`'s `needs:` list depends on,
  following the existing HEL-913/846/1037/996 precedent (CI runs the check independently of the hook, for the
  same "hook is bypassable, CI is not" reason).
- Add a drift guard (`scripts/check-precommit-ci-parity.mjs` + `npm run check:precommit-ci-parity`) that parses
  `.husky/pre-commit`'s step list — both `npm run <script>` lines and bare npm-alias lines like `npm test` —
  resolves each script generically via `package.json`'s own `scripts` entries (so an indirect CI invocation by
  underlying script path, not just npm-script name, still counts as covered), and compares that against only the
  jobs `.github/workflows/ci.yml`'s `ci-complete` job actually depends on (its `needs:` array) — not every
  workflow file, since a check living solely in a tag-triggered workflow blocks nothing on a PR. Wire this guard
  into CI itself (not the hook) so it cannot itself be bypassed by `-n`.
- No spec-level (API/schema) behavior changes — this is CI/tooling wiring only.

## Capabilities

### New Capabilities
(none — `skip_specs: true`, no behavior-contract change)

### Modified Capabilities
(none)

## Impact

- `.github/workflows/ci.yml` — new/extended job(s).
- New `scripts/check-precommit-ci-parity.mjs` + npm script + (likely) a self-test script, following the
  `check:X` / `check:X:selftest` convention already used repo-wide.
- No migrations, no schema changes, no frontend/backend runtime code changes expected.

## Non-goals

- No guard for the reverse direction (a CI check absent from the hook) — not a bypass hole, out of scope.
- No change to what the hook itself runs, beyond what's needed to keep the parity guard honest.
