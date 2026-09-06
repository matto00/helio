## Why

The `check:no-credential-leak` gate's self-test now runs in CI (HEL-846), but its euid-0 branch still exits 0 with
`OK WITH SKIPS` — silently dropping the permission-denial cases that prove the unreadable-file paths are guarded.
That branch passed CI only because `ubuntu-latest` happens to run non-root: dodged by luck, not decided, and
nothing fails if a runner image changes. Separately, `check:openspec:selftest` is still pre-commit-only, so the
openspec hygiene guard's own proof never runs on anything reaching `main`. Both are the same shape the gate exists
to close — a green report over something that was never checked.

## What Changes

- A root-detected skip in `check-no-credential-in-agent-surface.selftest.mjs` becomes a **hard failure** (non-zero
  exit) when running in continuous integration, instead of `OK WITH SKIPS` at exit 0. Outside CI it remains a
  visible, non-fatal skip, so a developer legitimately running as root is warned rather than blocked.
- The new hard-failure branch is itself proven failable, not merely asserted — consistent with this gate's
  established mutation bar.
- `openspec` is installed in the CI `frontend` job at the version derived from `check-openspec-version.mjs`'s
  `EXPECTED` constant, and both `npm run check:openspec` (the gate) and `npm run check:openspec:selftest` are
  wired into `.github/workflows/ci.yml`. Neither could run in CI before: the CLI was absent from the runner.
- The self-test survey is recorded: `check:dependabot:selftest` and both `check:node-root-encoding` self-tests were
  already CI-wired; `check:openspec:selftest` was the remaining gap and is closed here.
- The enforcement is proven end-to-end by pushing a mutation and confirming the **CI** job goes red, then
  reverting it — local pre-commit going red does not satisfy this.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-surface-credential-gate`: the "gate is enforced where it cannot be skipped" requirement gains a
  euid-0 clause — a skipped permission case SHALL fail the CI run rather than report success.
- `openspec-spec-hygiene`: the hygiene guard AND its self-test SHALL both run as merge-blocking CI steps, not
  pre-commit only, with the `openspec` CLI installed on the runner at a single-sourced version.

## Impact

- `scripts/check-no-credential-in-agent-surface.selftest.mjs` — the terminal reporting branch.
- `.github/workflows/ci.yml` — an `openspec` install step plus two added `- run:` steps, with explanatory comments.
- `scripts/check-openspec-version.mjs` — a flag to print `EXPECTED`, so CI single-sources the version.
- No backend, frontend, database or deployment surface. No `package.json` or `tsconfig.json` change (both npm
  scripts already exist), avoiding collision with concurrent HEL-997.

## Non-goals

- Re-doing AC1: `check:no-credential-leak` and its self-test are already CI-wired by HEL-846 (`627fc281`).
- Changing what the credential gate scans, or any of its detection rules.
- Moving any check into or out of `.husky/pre-commit`; the hook chain is left exactly as-is.
- Making CI run as an explicitly non-root user, or pinning the runner image — the hard-failure policy makes that
  unnecessary and is robust to a runner image change rather than dependent on one.
- Converting `openspec` into a real local `devDependency` and rewiring Concertino's `core/` invocations to a local
  binary. That is the deeper fix `check-openspec-version.mjs` alludes to; a global install in CI is the bounded
  step that unblocks this ticket without pre-empting it.
