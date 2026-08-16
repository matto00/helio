# Tasks: resolve-dependabot-security-alerts

## 1. Frontend dependency bumps (frontend/)

- [x] 1.1 Bump `axios` range in `frontend/package.json` to `^1.18.0` (or latest 1.x) and install
- [x] 1.2 Bump `react-router-dom` range in `frontend/package.json` to `^7.18.2` (or latest 7.x) and install
- [x] 1.3 Refresh transitive deps in `frontend/package-lock.json`: `postcss >= 8.5.23`, `fast-uri >= 3.1.5`, `brace-expansion >= 1.1.16/2.1.2`, `js-yaml >= 3.15.1`, `sharp >= 0.35.0` (targeted `npm update <pkg>`; `overrides` only if a parent pins below the patched version — document which parent)

## 2. helio-mcp dependency bumps (helio-mcp/)

- [x] 2.1 Refresh transitive deps in `helio-mcp/package-lock.json`: `hono >= 4.12.34`, `ip-address >= 10.3.1`, `fast-uri >= 3.1.5`, `@hono/node-server >= 1.19.15` (same targeted strategy as 1.3)

## 3. Root dependency bumps (repo root)

- [x] 3.1 Refresh transitive `js-yaml` in root `package-lock.json`: every 3.x instance `>= 3.15.1`, every 4.x instance `>= 4.3.1`

## 4. Per-alert version verification (design.md Decision 3)

- [x] 4.1 For every row of the design.md table, verify via `npm ls <pkg>` / lockfile inspection that **every** installed instance in the owning workspace is at/beyond the required version; record the evidence in `files-modified.md`
- [x] 4.2 Run `npm audit` in all three workspaces as corroboration; explain any residual advisory that is NOT one of the 35 scoped alerts (out of scope) — none of the 35 may remain

## 5. Gates

- [x] 5.1 `npm test` green in root and `frontend/`
- [x] 5.2 `helio-mcp/` gates green: `npm run build` and `npm run typecheck` (`helio-mcp` has **no** `npm test` script — these are its equivalent verification gates; see design.md Planner Notes)
- [x] 5.3 `npm run lint` green (zero warnings) and `npm run build` green in `frontend/`
- [x] 5.4 `sbt test` green in `backend/` (AC-listed insurance; no backend code changes expected)

## 6. Runtime spot-checks (design.md Decision 4)

- [x] 6.1 Start worktree dev servers (`scripts/concertino/start-servers.sh`, ports 6120/9027); log in as matt@helio.dev
- [x] 6.2 Exercise axios paths live: dashboard list load (GET), create or duplicate a dashboard (POST), rename/appearance change (PATCH); confirm responses + no console errors
- [x] 6.3 Exercise an axios error path (e.g. request against a bogus id → 4xx handled, interceptor behavior unchanged)
- [x] 6.4 Exercise react-router live: navigate between dashboards via `<Link>`, direct-URL load of a dashboard route, browser back/forward; confirm no console errors
- [x] 6.5 Clean up any spot-check artifacts (test dashboards created during 6.2)

## 7. Delivery follow-through (orchestrator-owned — Phase 3/4, not executor scope)

> **Reviewer note (evaluator + skeptic):** tasks 7.1-7.3 are *expected to remain unchecked* through Execution,
> Evaluation, and the final skeptic gate — they structurally cannot complete until Delivery (7.1) or after the
> human merges the PR (7.2/7.3). Unchecked boxes in this section are NOT an incomplete-task defect. Enforcement
> lives in the delivery artifacts themselves: the PR body and the ticket's closing comment restate these three
> items as explicit post-merge TODOs (design.md Decision 6).

- [ ] 7.1 PR body explicitly states it supersedes Dependabot PR #258 (10/35 alerts, axios-only)
- [ ] 7.2 After the human merges this PR: re-run `gh api "repos/matto00/helio/dependabot/alerts?state=open"` and confirm all 35 scoped alerts (#56-#103 per design.md table) are no longer open; surface any survivor before closing the ticket
- [ ] 7.3 After the merge confirmation: close PR #258 as superseded with a comment linking the merged PR
