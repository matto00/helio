## Why

An undefined CSS custom property fails OPEN: `var(--does-not-exist)` falls back silently, so the
element renders wrong rather than erroring. No gate in this repo can see it — not ESLint, not `tsc`,
not Prettier, not any unit test. HEL-451 shipped `var(--weight-normal)` against a `--weight-regular`
definition and rendered inputs at computed weight 600 instead of 400, through a fully green suite.
Three more defects of the same class exist on `main` today. This is the cheapest guard available for
the failure class HEL-346 exists to eliminate.

## What Changes

- A new `check:tokens` script resolves every `var(--*)` reference under `frontend/src/**/*.css`
  against the tokens actually defined in the repo's declared token sources, and fails with
  file:line for each unresolved reference.
- **CSS comments are stripped before extraction**, preserving newlines so reported line numbers stay
  correct. Without this the guard is red on `main` from its first run against a correctly-defined
  token (`--app-top-chrome-`, wrapped across a comment's line break) — and a guard that cries wolf on
  day one is one somebody disables.
- A documented allowlist for the five tokens injected at runtime, each entry **naming the file that
  sets it**. A sighting is not a justification.
- A companion `check:tokens:selftest` that plants a bogus reference, runs the guard, and asserts it
  exits non-zero — following the repo's existing `:selftest` convention so the guard's failability
  is proven on **every** commit and CI run, not once by hand at review time.
- Both wired into `.husky/pre-commit` and CI beside the existing `check:*` scripts.
- The three known defects fixed: `--radius-sm` ×2 and `--text-small` in `PipelineDetailPage.css`,
  `--space-sm` in `AddSourceModal.css`.

## Capabilities

### New Capabilities

- `design-token-resolution-guard`: every `var(--*)` reference in the frontend stylesheet set must
  resolve to a defined token — the resolution rule, comment handling, the runtime-injection
  allowlist and its evidence requirement, and the guard's own demonstrated failability.

## Impact

- New check script beside the existing `scripts/` checks, plus its selftest.
- `package.json` — `check:tokens`, `check:tokens:selftest`.
- `.husky/pre-commit` and `.github/workflows/ci.yml` — one line each. **This touches the commit-gate
  chain**, so the gate-chain implications checklist applies.
- `features/pipelines/ui/PipelineDetailPage.css`, `features/sources/ui/AddSourceModal.css` — three
  token references corrected.
- No runtime/product code changes. No behaviour change to the app itself.

## Non-goals

- HEL-830's 119 off-scale spacing literals, HEL-680, HEL-732 — this is a guard, not a cleanup.
- Renaming, consolidating or adding tokens beyond correcting the three defects.
- Resolving `var()` in `.ts`/`.tsx` template literals or inline styles; the allowlist covers the
  runtime-injection direction instead.
- Replacing HEL-441's motion guard, which checks a different property (durations, not resolution).
