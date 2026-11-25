- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicRouteOwnerIdLeakApiSpec.scala` — new sibling spec (design D1 allowed): drives every unauthenticated route through the REAL `ApiRoutes` tree (CSRF + rate limit wrapping as in production; limit raised to 100000 and 429 asserted absent) with one distinctive owner id, every body AND header value checked by OwnerIdGuard; fixtures with ownership positive controls; Chosen over extending PublicRouteOwnerIdLeakSpec because that fixture builds PublicDashboardRoutes directly with no auth/upload/connector/health wiring.
- `openspec/changes/extend-owner-id-guard-public-routes/mutation-<route>.txt` — one per newly covered route, each stating its mutation kind. (The source-scan structural check, its red output and structural mutations were removed; HEL-1881.)
- `openspec/changes/extend-owner-id-guard-public-routes/tasks.md` — tasks ticked.

Main code diff: empty. No owner-id leak found.
