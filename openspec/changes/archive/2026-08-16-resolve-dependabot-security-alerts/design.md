# Design: resolve-dependabot-security-alerts

## Context

35 open Dependabot alerts span three npm lockfiles. Ground truth pulled from
`gh api repos/matto00/helio/dependabot/alerts?state=open` on 2026-08-16 (alert numbers cited below are the
authoritative per-alert ids used for post-fix verification):

| Manifest | Package | Alerts | Required version | Currently declared/locked source |
| --- | --- | --- | --- | --- |
| frontend | axios | 10 (#56-66) | >= 1.18.0 | direct dep `^1.15.0` |
| frontend | react-router | 5 (#72-75, #92) | >= 7.18.2 | via direct dep `react-router-dom ^7.16.0` |
| frontend | postcss | 2 (#76, #102) | >= 8.5.23 | transitive (vite toolchain) |
| frontend | fast-uri | 2 (#69, #91) | >= 3.1.5 | transitive (ajv chain) |
| frontend | brace-expansion | 2 (#70, #71) | >= 1.1.16 (1.x) / >= 2.1.2 (2.x) | transitive (minimatch chain) |
| frontend | js-yaml | 1 (#98) | >= 3.15.1 (3.x) | transitive |
| frontend | sharp | 1 (#67) | >= 0.35.0 | transitive (@vite-pwa/assets-generator) |
| helio-mcp | hono | 4 (#86, #93-95) | >= 4.12.34 | transitive |
| helio-mcp | ip-address | 3 (#84, #85, #89) | >= 10.3.1 | transitive |
| helio-mcp | fast-uri | 2 (#68, #90) | >= 3.1.5 | transitive |
| helio-mcp | @hono/node-server | 1 (#103) | >= 1.19.15 | transitive |
| root | js-yaml | 2 (#97, #99) | >= 3.15.1 (3.x) / >= 4.3.1 (4.x) | transitive |

Dependabot PR #258 (open) bumps frontend axios 1.16.0 → 1.18.0 — exactly the first-patched version for all 10 axios
GHSAs, so it is sufficient for axios but addresses only 10 of 35 alerts. This change supersedes it.

## Goals / Non-Goals

**Goals:**

- Every package above at or beyond its first-patched version in the corresponding lockfile.
- All existing gates green: root/frontend `npm test`, frontend lint + build, helio-mcp `npm run build` +
  `npm run typecheck` (helio-mcp has no `npm test` script — see Planner Notes), `sbt test` (AC lists it even
  though the backend is untouched — cheap insurance against toolchain surprises).
- Live exercise of axios request paths and react-router navigation in the running app.
- PR #258 closed as superseded at delivery.

**Non-Goals:**

- No major-version bumps (none are required — verified against the alerts API, not assumed).
- No `npm audit fix --force`, no blanket `npm update`: only the flagged packages move, keeping the diff reviewable.
- No backend/Flyway changes; no new alerts beyond the 35 scoped.

## Decisions

1. **Direct deps get range bumps in `frontend/package.json`**: `axios` → `^1.18.0` (or the latest 1.x if newer),
   `react-router-dom` → `^7.18.2`. Rationale: both fixes are within the current major; declaring the floor in
   package.json (not just the lockfile) prevents a future fresh install from resurrecting the vulnerable range.
2. **Transitive deps: targeted lockfile refresh first, `overrides` only as fallback.** For each transitive package,
   run `npm update <pkg>` (or `npm audit fix` scoped to it) in the owning workspace; this works whenever the parent's
   semver range already admits the patched version (expected for postcss/fast-uri/brace-expansion/js-yaml/sharp/hono/
   ip-address/@hono/node-server — all patch/minor fixes). Only if a parent pins below the patched version, add a
   scoped `overrides` entry in that workspace's package.json with a comment-adjacent note in the PR body naming the
   pinning parent. Rationale: overrides are sticky footguns (they silently pin forever); prefer resolution the
   dependency tree can express naturally. Alternative rejected: `npm audit fix --force` (can jump majors
   uncontrolled).
3. **Per-alert verification, not aggregate `npm audit` exit codes.** After bumping, verify each row of the table
   above directly against the lockfile (`npm ls <pkg>` / lockfile grep) showing every installed instance of the
   package is at/beyond the required version — this is the deterministic local proxy for "the alert will close".
   `npm audit` output is corroborating evidence only (its DB mirrors GitHub advisories with lag). The definitive
   post-merge check (`gh api .../dependabot/alerts?state=open` count drop) happens at delivery/close, per the AC.
4. **Runtime spot-checks via the worktree dev servers** (`scripts/concertino/start-servers.sh`, ports from
   workflow-state): log in (matt@helio.dev), load the dashboard list (axios GET), create/rename or duplicate a
   dashboard (axios POST/PATCH), navigate between dashboards and settings routes (react-router `<Link>`/
   `useNavigate`), confirm no console errors and correct network responses. Rationale: axios interceptors and
   router behavior are exactly where in-major behavioral drift shows up.
5. **PR #258 handling**: leave it open during this run; at delivery, note in our PR body that it supersedes #258;
   after the human merges our PR, close #258 with a comment linking this change. Rationale: closing before our
   merge would leave a window with neither fix; #258 alone is insufficient (10/35). Operationalized as tasks
   7.1/7.3 (orchestrator-owned) so it cannot be silently skipped.
6. **Post-merge alert verification is a tracked task with a concrete carrier, not prose intent**: task 7.2
   (orchestrator-owned) re-runs `gh api "repos/matto00/helio/dependabot/alerts?state=open"` after the human merge
   and requires all 35 scoped alert numbers (#56-#103 table above) gone before the ticket closes; any survivor is
   surfaced, not assumed away. Because `AGENT_MERGE: false` for this run (a human confirms the merge) and the
   orchestrator's generic Phase 3/4 procedures never consult tasks.md, the enforcement carriers are the delivery
   artifacts themselves: the **PR body** (written at Phase 3) and the **Linear closing comment** (Phase 4) each
   restate tasks 7.1-7.3 verbatim as post-merge TODOs, so the checklist travels with the PR and the ticket rather
   than relying on any agent recalling this document unprompted. Tasks 7.1-7.3 remain unchecked through
   Evaluation and the final skeptic gate by design (see the reviewer note atop tasks.md section 7).

## Risks / Trade-offs

- [axios minor-version behavioral drift (1.15 → 1.18)] → runtime spot-check of real request paths incl. an
  error-path (401/interceptor) case; frontend service layer is centralized under `frontend/src/services/`, one place
  to watch.
- [react-router-dom 7.16 → 7.18 drift] → exercise navigation, direct-URL load, and back/forward in the live app.
- [Transitive bump breaks build toolchain (postcss/vite, sharp/asset-generator)] → `npm run build` in frontend is a
  required gate, catches this immediately.
- [npm advisory DB lag makes `npm audit` disagree with GitHub alerts] → per-alert lockfile version verification is
  the local gate (Decision 3), not audit exit codes.
- [Parallel run HEL-412 shares dev-server infra] → this worktree uses its own ports (6120/9027) from
  setup-worktree.sh; no shared state beyond that.

## Migration Plan

Not applicable — no data or deploy migration. Rollback = revert the single squashed commit.

## Open Questions

None — all version targets are pinned by the alerts API data above.

## Planner Notes

- Self-approved: treating `sbt test` as in-scope gate despite no backend changes (AC explicitly lists it).
- Self-approved (skeptic design round 1, item 1): the AC's "`npm test` … `helio-mcp/`" is unsatisfiable as
  written — `helio-mcp/package.json` has no `test` script (verified: `npm error Missing script: "test"`). Its
  equivalent verification gates, `npm run build` + `npm run typecheck`, stand in as the AC's intent (task 5.2).
  Adding a `test` script to helio-mcp would be scope creep on a dependency-bump ticket.
- Self-approved: bumping direct-dep ranges in `frontend/package.json` rather than lockfile-only pins (prevents
  regression on fresh install; still within-major, so not a breaking-change escalation).
- No ESCALATION raised: no new external dependency, no architectural change, no breaking API change, scope matches
  the ticket exactly.
