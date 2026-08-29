# HEL-863: Close MCP surface gaps: pipeline schedule read/write and dashboard rename

## Description

From the Sleeper field report (`/home/matt/Development/fantasy/docs/helio-issues.md`, issues #8 and #9). Filed as one ticket because they are the same shape of defect with the same fix location: **capabilities the backend already has that the MCP surface never exposed.** Neither needs any backend work.

This is leaf 7 of epic HEL-857 and the epic's last structural blocker. Once it lands, the epic's exit criterion becomes reachable: rebuilding the four Sleeper dashboards end to end from the live API with no CSV detour and a daily refresh schedule. HEL-862 made URL-backed CSV refresh work; this leaf is what lets an agent CONFIGURE and READ BACK that schedule at all. The real deliverable is "an agent can set a daily schedule and verify it", not a tool count.

### Gap 1 — no scheduling surface at all

`create_pipeline` has no schedule field, and `update_pipeline` is rename-only. There is no way for an agent to configure or even *read* a refresh schedule. An agent asked for "dashboards that update daily" therefore cannot deliver that, cannot verify it, and — worst — cannot tell the user it failed to.

Already in the backend: `PipelineScheduleRoutes` serves `GET/PUT/DELETE /api/pipelines/:id/schedule` (`PUT` upserts), shipped under HEL-415. It is purely absent from `helio-mcp/src/tools/`.

### Gap 2 — no dashboard rename

There is `create_dashboard`, `delete_dashboard`, `replace_dashboard_contents` and `update_dashboard_layout`, but nothing to rename. A typo in `dashboardName` at `apply_proposal` time can only be fixed by delete + recreate, which changes the dashboard id and breaks any saved link.

Already in the backend: `UpdateDashboardRequest` carries `name: Option[String]` (`DashboardProtocol.scala:43`), served by the existing `PATCH /api/dashboards/:id`.

### Gap 3 — the `&amp;` question

The field report hit an `&` in a dashboard name arriving HTML-escaped as `&amp;`. Determine empirically whether that is an MCP-layer encoding bug rather than only a rename-ergonomics problem. If it reproduces, fix it here; if it is deeper, file a spinoff (routed through the orchestrator — the executor has no Linear tools) rather than expanding scope.

## Acceptance Criteria

- [ ] An agent can set, read back, and delete a pipeline's schedule entirely through the MCP surface.
- [ ] A schedule set via MCP is visible in the UI, and one set in the UI is readable via MCP (no divergent second source of truth).
- [ ] An agent can rename a dashboard, and its id and any share links survive the rename.
- [ ] A dashboard name containing `&` round-trips through the agent path without acquiring HTML entities — or, if the cause proves deeper, a spinoff is filed and linked.
- [ ] No backend route changes were required; if any turn out to be, that is called out explicitly in the PR rather than absorbed silently.

## Verified Ground Truth (premise validation, 2026-08-28, against origin/main c0821ef9)

- `PutPipelineScheduleRequest(kind: String, expression: String, enabled: Option[Boolean], timezone: String)` — `timezone` is REQUIRED, not optional. `enabled` absent normalises to `true` server-side.
- Validation in `PipelineScheduleService`: `kind` via `ScheduleKind.fromString`; cron = 5 space-separated fields (minute hour day-of-month month day-of-week) with per-field bounds and `*`/`n`/`lo-hi`/`base/step` token forms; interval = `^(\d+)(s|m|h|d)$` with n > 0; `timezone` must be a valid IANA zone id (`ZoneId.of`).
- `PipelineScheduleResponse` has 10 fields: `id, pipelineId, kind, expression, enabled, timezone, nextRunAt, lastRunAt, createdAt, updatedAt` (`nextRunAt`/`lastRunAt` optional).
- `PUT` upsert resets `nextRunAt` when kind/expression/timezone change; preserves it when only `enabled` changes.
- Every schedule method ACL-gates via `pipelineRepo.findByIdOwned` first, returning `NotFound("Pipeline not found")`.
- There is zero HTML-entity encoding anywhere in the helio-mcp / frontend / backend agent write path.

## Standing Requirements (binding — these have found a real defect in all seven prior runs of this epic)

1. **Verify by measurement, not attestation.** Recapture red-on-revert evidence whenever tests change after it was taken; do NOT recapture when only names or comments changed. Prefer behavioural mutation over compile-error revert — a revert can prove only that tests reference the new API.
2. **Audit prose against code, including your own.** Reading a signature is not reading a call path.
3. **A weak assertion is the same as no test.** Assert content, not presence. A test's NAME is a claim.
4. **User-facing wording is behaviour.** An MCP tool description is the agent-facing contract — if it misstates what the tool accepts or returns, that is a defect, not a doc nit.
5. **Derive sets by enumeration.** Distrust ticket counts and line numbers, including those above.

## Verification Environment (two gate corruptions found this epic, both from worktree setup)

- Root jest finds ZERO tests inside a worktree: `jest.config.cjs`'s `testPathIgnorePatterns` `"/.claude/worktrees/"` is unanchored and matches every test's absolute path from inside a worktree, so `npx jest` there exits successfully having run nothing. Filed as HEL-880; do NOT fix it here, and do NOT rely on that gate. The mitigation is an override of the ROOT jest config's ignore list — helio-mcp has no jest config of its own. See tasks.md 1.2 for the exact measured command.
- A dependency-less worktree makes `tsc --noEmit` emit spurious implicit-any noise. In HEL-862 that noise MASKED five real TS2532 regressions which shipped through a whole cycle undetected. Install `helio-mcp/node_modules` before trusting any typecheck, and confirm it exists before reporting an exit code.

## Release Process

- Repo renumbered 1.x to 0.x. `release/v0.7`, current tag `v0.7.5`, `package.json` 0.7.x.
- BASE DRIFT: rebase onto `origin/main` before squashing and verify `git diff origin/main..HEAD -- package.json` is empty. Live hazard on two consecutive tickets.
- `main` is protected with a required `ci-complete` check, no bypass actors.
- Deploys trigger on pushing a `v*` TAG. Create, move or delete NO tags. Do not cut a release.
