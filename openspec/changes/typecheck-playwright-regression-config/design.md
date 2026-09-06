# Design — type-check `playwright.regression.config.ts`

## Context

See `proposal.md` — Why, and `ticket.md` for the refuted original premise and its measurements. Ground truth at
branch point (`010f67f0`), verified directly:

- `e2e/tsconfig.json` include is `["**/*.ts", "../playwright.config.ts"]`. The `**/*.ts` glob is relative to
  `e2e/`, so it covers only `e2e/**`; the sibling entry is what pulls in a root-level file.
- `playwright.regression.config.ts` appears in no tsconfig anywhere in the repo.
- `check:e2e-types` (`tsc --noEmit -p e2e/tsconfig.json`) runs at `.husky/pre-commit` line 7 and currently exits 0.
- Measured: `playwright.regression.config.ts` compiles clean standalone under the e2e compiler options, so this is
  expected to land green without touching the file itself.

## Goals / Non-Goals

**Goals:**

- Bring `playwright.regression.config.ts` under a gate that actually runs, by the smallest honest change.
- Prove the coverage change with a before/after `--showConfig` diff, not merely a green run — a green run is what
  `check:e2e-types` already produced while the file was uncovered.

**Non-Goals:**

- See `proposal.md` — Non-goals. In particular: no root `tsconfig.json` change and no new guard.

## Decisions

**D1 — Add the file to `e2e/tsconfig.json`'s `include` rather than creating a new project for it.** The repo has
already made this exact call once, for `playwright.config.ts`: a root-level Playwright config is checked by the
e2e project via a `../` include entry. Following the established local pattern keeps one config for the Playwright
surface instead of introducing a second, and makes the two sibling files symmetric — which is precisely what their
current asymmetry made easy to overlook.

*Alternative considered — a dedicated root-level project, or reviving root `tsconfig.json` for this.* Rejected: it
would add a gate invocation and a config to maintain for one file, and reintroduce the root-`tsc` surface this
ticket just established is better left uninvoked.

**D2 — Evidence is a `--showConfig` diff, before and after.** The acceptance question is "is this file in the
project's resolved input set?", and `--showConfig` answers exactly that from TypeScript's own resolver rather than
from a re-implementation of its glob semantics. A passing `check:e2e-types` is necessary but not sufficient: it
passed yesterday too, with the file uncovered. This is the same distinction that sank the original ticket — a
green result that was never measuring the thing it was cited for.

**D3 — Do not modify `playwright.regression.config.ts` unless the new coverage reports real type errors.** It is
measured clean; if that changes, fix the errors in the file, and never by narrowing the include.

## Risks / Trade-offs

- **[Newly-covered file fails to compile, blocking every commit via `check:e2e-types`.]** → Measured clean before
  wiring (D3). If real errors surface, they are genuine defects in a file nothing was checking, and get fixed.
- **[`e2e/tsconfig.json` collides with a concurrent run.]** → HEL-996 is scoped to `.github/workflows/ci.yml` and
  HEL-974 to backend/RLS; neither touches this file. Flag if that turns out otherwise.
- **[The `../` include entry is easy to overlook again for a future third Playwright config.]** → Accepted. The
  symmetry restored here makes the pattern visible, which is strictly better than today's single-sibling asymmetry.
  A guard for it would be disproportionate to a one-line config surface.

## Planner Notes

- Self-approved: `skip_specs: true` — build tooling, no behaviour change. Inventing a requirement to satisfy
  validation would be wrong.
- Self-approved: no new pre-commit gate. This change rides an existing one.
- No Gate-Chain Implications Checklist is required: this change adds no script to the commit-gate chain and does
  not touch `.husky/**`. It only widens the input set of a gate that already exists.
