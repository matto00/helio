# HEL-707: Bump root-lockfile brace-expansion for GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895

## Description

Spun off from HEL-688 (35-alert Dependabot sweep, PR matto00/helio#370). During
that sweep, `npm audit` at the repo root surfaced a **newer** `brace-expansion`
advisory pair — GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895 — that was **not**
among the 35 scoped alerts (Dependabot had not yet raised alerts for it at
scoping time). HEL-688's ticket explicitly declared post-scoping findings a
separate follow-up, and triage (2026-08-16) confirmed: **standalone**, not
fold-in.

Both HEL-688's evaluator and final-gate skeptic independently confirmed the
finding is pre-existing, genuinely outside the 35 scoped alerts, and visible
via `npm audit` at the root today.

## Scope

- Bump the affected `brace-expansion` instance(s) in the root
  `package-lock.json` to the patched versions for GHSA-mh99-v99m-4gvg /
  GHSA-rgw5-rvv9-x895 (targeted `npm update` / scoped override per the pattern
  established in HEL-688's design — no `npm audit fix --force`, no blanket
  updates).
- Check whether Dependabot has since raised alerts for this pair in any of the
  three lockfiles (`frontend/`, `helio-mcp/`, root) and cover every flagged
  manifest if so.
- Root `npm audit` reports zero findings for this advisory pair afterward;
  root `npm test` and lint stay green.

## Acceptance Criteria

- [ ] Every installed `brace-expansion` instance in the root lockfile is
      at/beyond the first-patched version for both GHSAs.
- [ ] Root `npm audit` no longer reports GHSA-mh99-v99m-4gvg /
      GHSA-rgw5-rvv9-x895.
- [ ] If Dependabot alerts exist for this pair by then, they are verified
      closed post-merge via the alerts API.
- [ ] Root `npm test` and lint pass.
