# HEL-1785: Include shared dashboards in the assistant, workspace search and helio-mcp, read-only

## Description

origin_kind: followup
origin_ticket: HEL-1773

**Owner ruling (2026-11-19):** the in-app assistant, workspace search and helio-mcp (including the hosted connector)
include dashboards shared with the user, with the user's role, read-only where the role is viewer.

HEL-1773 added shared dashboards to the web app's lists through the opt-in `GET /api/dashboards?include=shared`.
Everything else still sees owned dashboards only.

## Acceptance criteria

- `WorkspaceSearchService` and `WorkspaceContextService` (the assistant's context) include shared dashboards and their role.
- The assistant never proposes edits to a dashboard the user can only view, and never proposes owner-only actions to an editor.
- helio-mcp list and read tools include shared dashboards with the role; write tools on a viewer's dashboard fail cleanly
  with the server's refusal.
- Shared dashboards expose only what the grant allows: no payload rows and no `/api/outputs/*` data for a dashboard-only grant.
- RLS checked as `helio_app`.
- Tests that fail first.
- The hosted connector reaches prod only via `deploy-mcp.sh` (owner step); say so in the PR.

## Driver constraints (restated for every role)

- C1: NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to
  compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); the only exception is
  scripts/concertino/.concertino.env which scripts may read but never print. Do not copy .env files around.
- C2: quoted heredocs only (<<'EOF'), even when the body looks harmless.
- C3: no pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh; delete test residue
  with buildUserDeleteSql by exact id; plain emails.
- C4: jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- C5: Bash timeout 600000; `sbt testFull`, never bare `sbt test`.
- C6: budget exhausted means escalate (one extra round only for a narrow, named defect).
- C7: the auditor merges only with `gh pr merge --squash --match-head-commit <sha>`, never `--auto`.
- C8: no prod, no release, no concertino sync, no MCP deploy or helio-mcp session-dist rebuild.
- C9: no claude.ai session link in PR bodies or commits.
- C10: cleanup from the main checkout, then confirm local and remote branches are gone.
- C11: known flakes hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, hel1665-home-phone-stability:437,
  hel1573-motion-grid-chart:104, candidate hel1656-pull-to-refresh:340. An unlisted CI failure unrelated to the diff gets
  ONE literal `gh run rerun --job <id>`, named in the PR; a second parks. A merge-from-main push is not a rerun. e2e
  wall-clock cancellations with 0 failures count as unlisted failures. CI has 7 e2e legs.
- C12: red first, with mutations; run full spec/test files. Write tests before code in every stage; record the red runs.
- C13: scratch in `.concertino/scratch/HEL-1785/`.
- C14: lane-private DB (`createdb helio_hel1785`); DATABASE_URL set for start-servers.sh AND Playwright
  (e2e/support/db.cjs silently falls back to the dev DB without it); start-servers.sh also needs DB_USER when
  DATABASE_URL has no credentials. Drop it at Delivery.
- C15: gates grep `e2e/` and helio-mcp tests for every identifier/selector/message the change alters.
- C16: NO live model call. Every backend this lane starts is started with `ANTHROPIC_API_KEY` exported empty.
  Assistant behaviour is tested against the fake transport.
- C17: stay out of files the in-flight sibling HEL-1780 owns (PublicDashboardRoutes and the per-panel route resolvers,
  frontend dashboard role reads). Calling those routes is fine; editing them is not without saying so.
- C18: no migration expected; if one is needed it is V146 and the driver is told.
- Driver statements are claims to verify, not facts.
