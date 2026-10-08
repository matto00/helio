# HEL-1411: URGENT: main + all PRs red on `security` — handlebars GHSA-xw65/p8wg/8r5x + braces GHSA-vfj7 on a new path (via jest)

## Description

Main CI `security` job is red since 2dd4ed623 (2026-10-08 ~20:16Z; it passed on matto00/helio#861's PR run at 20:05Z on the same base, so the advisories were published in between). Every open PR fails the same way (#860 HEL-1299, #862 HEL-1156).

Failing steps: `npx audit-ci` at the repo root AND in helio-mcp. Advisories:

* handlebars: GHSA-xw65-4hp5-5hc7, GHSA-p8wg-vrv2-v86f, GHSA-8r5x-fm3f-whwj
* braces: GHSA-vfj7-8cjw-p6xm. It's already allowlisted at the root by HEL-1246 as `GHSA-vfj7-8cjw-p6xm|*micromatch>braces*`, so this is a new path, or helio-mcp (whose allowlist is empty). Both reportedly come in via jest (dev-only). Verify the exact dependency paths with `npm ls` / `npm audit --json` in each tree.

**Owner ruling (Matt, 2026-10-08, via AskUserQuestion): urgent lane, fix-first.** Bump or override to patched versions where they exist (precedents HEL-1319, HEL-1346, HEL-1364 overrides). For any advisory with NO patched version, do not add an allowlist entry yourself. Escalate to the owner with the exact path-scoped, dated entry (HEL-1246 pattern: `"<GHSA>|<path-scope>*"` plus ticket, reason, dependency path and review-by date) for approval.

## Acceptance criteria

* `security` green on main.
* Lockfile deltas listed exactly per tree (root, frontend, helio-mcp). Overrides follow the existing pattern; no unrelated upgrades.
* The full test suites still pass (jest is the carrier).

## Premise validation (orchestrator, Setup — see .concertino/runs/HEL-1411/evidence/premise-validation.md)

* Actual failing CI steps (main run 37838151040): `Frontend audit (root)` and `Frontend audit (frontend/)`. `helio-mcp audit (helio-mcp/)` PASSED; helio-mcp's tree has no handlebars or braces.
* Both failing steps report ONLY the three handlebars GHSAs. handlebars 4.7.9 via `ts-jest` in root (ts-jest@29.4.6, declares `handlebars ^4.7.8`) and frontend (ts-jest@29.4.9, `^4.7.9`). Patched 4.7.10 exists and is in range.
* braces GHSA-vfj7: the only root path is jest>@jest/core>micromatch@4.0.8>braces@3.0.3 — the existing HEL-1246 allowlisted path; CI does not report it. No patched braces exists (3.0.3 is latest). Nothing to change; no allowlist escalation required.
