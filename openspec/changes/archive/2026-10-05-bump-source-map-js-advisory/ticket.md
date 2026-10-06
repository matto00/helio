# HEL-1319: Fix GHSA-68fv-2mgg-jv7q + GHSA-jqcg-44mw-7w3h: bump source-map-js (frontend) and proxy-addr (helio-mcp) — CI security job red

## Description

The CI `security` job now fails on **GHSA-68fv-2mgg-jv7q**, a high-severity advisory: source-map-js allows an event-loop denial of service through indexed source-map section offsets. Every PR's `ci-complete` will be red until this is fixed, and so will the next main run, which blocks every lane's merge. It was first seen on PR matto00/helio#774, run 37396677223 attempt 2. Main's earlier security runs passed.

`frontend/package-lock.json` pins `source-map-js` at **1.2.1**. The first patched version is **1.2.2**. No other lockfile contains it; verify this.

## Acceptance Criteria

- `source-map-js` resolves to ≥ 1.2.2 everywhere in `frontend/package-lock.json`. Prefer bumping the parent dependency, or a targeted `npm update source-map-js`. Use an `overrides` entry only if the parent can't move, and justify it.
- No unrelated dependency churn. List every lockfile package whose version changed.
- The `security` job's audit step is green on the PR: show it red on main-equivalent and green on the branch.
- Frontend build, lint, typecheck, Jest, and the e2e job pass.
- Check that the CI security gate would have caught a regression. That is already shown by it going red.

## Scope Addition (owner, 2026-10-06, fold-in)

- Also bump `proxy-addr` 2.0.7 → ≥ 2.0.8 in `helio-mcp/package-lock.json` (critical **GHSA-jqcg-44mw-7w3h**, IP spoofing via IPv4-mapped IPv6 trust subnet; arrives via `express@5.2.1` `^2.0.7`, so no override should be needed).
- Update the stale "0 advisories" comments in `frontend/.audit-ci.jsonc` and `helio-mcp/.audit-ci.jsonc` to describe the actual state. Do NOT change any audit thresholds or allowlists.
- Acceptance also requires: the helio-mcp audit step is green, shown red then green; the frontend audit step shown red then green.
- List every changed package in BOTH lockfiles.
- Out of scope: the 20 moderate frontend advisories (filed separately as HEL-1320).
- Do not touch `.github/workflows/ci.yml`, `playwright.config.ts`, or any source file (parallel lanes HEL-1287/1288/1275).
