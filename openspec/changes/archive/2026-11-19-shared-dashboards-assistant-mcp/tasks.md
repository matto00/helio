## Standing Constraints

- [C0] Execution order overrides list order: every test in group 4 is written and run red (transcript in
  `.concertino/scratch/HEL-1785/`) before the backend or helio-mcp task it covers. Driver constraints C1-C18 in ticket.md bind.

### Backend

## 1. Backend: grant-aware dashboard reads

- [x] 1.1 Repository single read: owned or named-grant dashboard by id with role, in `withUserContext` (D1)
- [x] 1.2 `DashboardService.findAllVisible` and `findVisibleWithRole`; update `findById`'s doc comment (D1)
- [x] 1.3 `WorkspaceContextService.assemble` uses `findAllVisible`; `WorkspaceContextDashboard.accessRole` (D1, D2)
- [x] 1.4 `WorkspaceSearchService.find` and `getResource(Dashboard)` grant-aware; role in description/detail (D1, D2)
- [x] 1.5 `schemas/workspace/workspace-context.schema.json` `DashboardEntry.accessRole` (D2)
- [x] 1.6 Named view-only / owner-only-delete messages at every enumerated viewer/owner refusal site (D3)
- [x] 1.7 `AssistantSystemPrompt` role rule (D3)

### helio-mcp

## 2. helio-mcp: shared dashboards with role

- [x] 2.1 `listDashboards` sends `include=shared`; tool description; `types.ts` comment (D4)
- [x] 2.2 `getDashboard` viewer branch via `/api/dashboards/:id/panels`, mapped to the existing panel shape (D4)
- [x] 2.3 `context.ts` grant-aware dashboards with `accessRole` (D4)

## 3. Proof

- [x] 3.1 NOBYPASSRLS (`helio_app_test`) spec for D5 items 1-5, labelled transcript saved and persisted (D5)
- [x] 3.1a D5 item 6: Output routes A (incl. `/distinct-values`) + insight B as viewer/editor/owner on the app pool; reduction cited
- [x] 3.2 C15 grep of e2e/, helio-mcp/src, frontend/src, backend tests for changed messages/fields; report hits

### Tests

## 4. Tests (written first, red recorded)

- [x] 4.1 Workspace context/search specs: viewer, editor, owner, stranger, public-only, self-grant, counts (D6)
- [x] 4.2 `GET /api/workspace/context` route + schema seam for a viewer grantee (D2)
- [x] 4.3 `AssistantToolExecutorSpec` patch-set refusal/acceptance cases, fake transport only (D3, C16)
- [x] 4.4 Patch-set preview/apply and REST 403 message specs (D3)
- [x] 4.5 helio-mcp tests: list query, viewer `get_dashboard` + seam, context role, write-tool refusal (D4)
- [x] 4.6 Mutations m1-m10 each red (m9: `/insight` recorded green, by design) at its own assertion; transcripts saved (D6)
- [x] 4.7 Full gates: `sbt testFull` (-J-Xmx3g, nice), frontend jest (3 workers), helio-mcp tests, lint, typecheck
