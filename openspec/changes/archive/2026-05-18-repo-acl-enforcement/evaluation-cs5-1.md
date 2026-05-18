# Evaluation Report — Cycle CS5 (Cleanup + Spec Sync)

## Phase 1: Spec Review — PASS

### Tasks.md verification
All Cycle 6 items marked [x]:
- Audit pass for unscoped `findById(` callers: verified independently (see §Audit below)
- Audit pass for `AccessChecker.requireOwnerOnly` redundant callers: verified (3 callers all legitimate in PermissionService)
- Inline `if (X.ownerId != user.id)` guards: executor found 2 in DashboardService (documented role-differentiation, not redundant)
- OpenAPI spec updates: 3 files touched (acl-enforcement, data-source-acl, data-type-acl) with 403→404 splits captured correctly
- Performance smoke: EXPLAIN ANALYZE run on 5 hot paths, all index scans, sub-millisecond
- Spinoff tickets: drafted (4 spinoffs: JoinStep cross-user source, pipeline sharing, file-size budget, panel query optimization)
- CONTRIBUTING.md + design.md updated with new ACL triad and HEL-272 reference
- `openspec archive repo-acl-enforcement` completed successfully

### Acceptance criteria coverage
1. [x] Every ACL'd repo's public reads accept caller identity and enforce ACL in SQL
2. [x] No service method has inline `if (resource.ownerId != user.id) Forbidden` redundant checks
3. [x] `dataTypeRepo.findById(id)` unscoped renamed to `findByIdInternal` with documented callers
4. [x] Per-repo regression tests: "wrong user gets None/404"
5. [x] Cross-user `GET /api/types/:id` closes (HEL-268)
6. [x] Dashboard/panel sharing preserved (HEL-36 semantics)
7. [x] Owner reads unchanged (no regression)
8. [x] All gates pass (715/715 tests, lint, format, openspec clean)
9. [x] Performance confirmed: index scans, O(log n), no seq scans
10. [x] Pipelines gain `owner_id` (V32) and ownership enforcement

**Verdict: PASS** — all acceptance criteria explicitly addressed. No silent reinterpretations.

---

## Phase 2: Code Review — PASS

### CONTRIBUTING.md review
- **ACL triad section added** (lines 50–63): documents three repository flavors (`findById(id, callerOpt)`, `findByIdOwned(id, user)`, `findByIdInternal(id)`) with table of when to use each.
- **Existence-not-leaked semantics documented**: "None → 404 Not Found, never 403; 403 reserved for visible but unauthorized (e.g., viewer-grant attempting mutation)."
- Matches design.md Q1 terminology and implementation exactly.

### Audit: Unscoped `*Repo.findById(` callers

Grep of `backend/src/main/scala/com/helio/{services,api}`:
```
DashboardService.scala:68,88,113,178    → findById(dashboardId, Some(user))  ✓ Sharing-aware
PanelService.scala:56                   → findById(panelId, callerOpt)       ✓ Sharing-aware
PipelineService.scala:107               → findById(pipelineId, user)         ✓ Owned-only
PipelineRunService.scala:63,97,161      → findById(pipelineId, user)         ✓ Owned-only
PipelineRunService.scala:186            → findById(pipelineId, user)         ✓ Owned-only
PipelineStepRepository.scala:...        → findById(stepId, user)             ✓ Owned-only (via JOIN)
DataTypeRoutes.scala:52                 → dataTypeService.findById(id, user) ✓ Owned-only
ApiRoutes.scala:102                     → userRepo.findById(...)             ✓ Not ACL'd (session lookup)
```

**Finding: zero unscoped `findById(id)` calls remain.** All callsites use the appropriate triad flavor.

### Audit: `AccessChecker.requireOwnerOnly` callers

```
AccessCheckerImpl.scala:23               → Definition
AccessChecker.scala:28                  → Interface definition
PermissionService.scala:25,31,53        → 3 calls (addGrant, removeGrant, listGrants)
```

**Finding: all 3 callers legitimate.** PermissionService guards permission management on dashboards (`POST/DELETE/GET /api/dashboards/:id/permissions`), which the repo enforcement does not cover. These are the authoritative gates and are not redundant with the repo ACL.

### Audit: Inline `if (ownerId != user.id)` guards

Found in DashboardService.scala:
```scala
case Some(d) if d.ownerId != user.id =>
  Future.successful(Left(ServiceError.Forbidden()))
```

**Lines 71–72 (delete)** and **lines 91–92 (duplicate)**: both operate on a value returned by `findById(sharing-aware)`. When `findById` returns `Some`, the caller is either the owner or has a sharing grant (viewer/editor). The `ownerId != user.id` check then enforces the role gate: "owner can delete/duplicate, but grantees cannot" (they get 403). This is documented role-differentiation, not redundant ACL.

**Finding: no redundant checks.** All inline guards serve the intended two-step pattern (repo returns `Some` for grantees, service then role-gates).

### Code quality
- **DRY**: No duplication introduced. Specs properly reference moved artifacts.
- **Type safety**: All calls use typed forms (no `any`).
- **No dead code**: Archive cleanup removed the old change directory; no orphaned references.
- **Behavior-preserving**: Archive is a pure file-tree move. No code changes.

**Verdict: PASS** — CONTRIBUTING.md documents the triad correctly; audit confirms the codebase already follows it uniformly.

---

## Phase 3: UI Review — N/A

No frontend files changed. No `ApiRoutes.scala` behavior changes (specs only). No new routes wired. Phase 3 not required.

---

## Archive Integrity

### Structure
Old directory `/openspec/changes/repo-acl-enforcement/` successfully moved to `/openspec/changes/archive/2026-05-18-repo-acl-enforcement/`.

### Artifacts present
- `proposal.md`, `design.md`, `tasks.md`, `ticket.md` ✓
- `executor-report-{1,2,3,cs3,cs4,cs5}.md` ✓
- `evaluation-{1,2,cs3-1,cs4-1}.md` ✓
- `workflow-state.md`, `.openspec.yaml` ✓
- All files copied intact (sizes consistent with executor report handoff)

### Spec validation
```
$ npm run check:openspec
openspec/ is clean
```

All OpenAPI specs in `openspec/specs/` pass validation after archive (no dangling references to the old change directory).

---

## Verification Gates

### Backend (sbt test)
```
Total number of tests run: 715
Suites: completed 42, aborted 0
Tests: succeeded 715, failed 0, canceled 0, ignored 0, pending 0
All tests passed.
```
✓ PASS

### Frontend (no changes, but verified lint/format)
```
$ npm run lint
(no output → zero warnings)

$ npm run format:check
All matched files use Prettier code style!
```
✓ PASS (no frontend files modified)

### OpenSpec validation
```
$ npm run check:openspec
openspec/ is clean
```
✓ PASS

### No inline FQNs
Grep of diff for `com.helio.*` patterns — none found. ✓

---

## Spec Updates Review

### acl-enforcement/spec.md
**Changes**: dashboard/panel PATCH/DELETE/export/duplicate scenarios split into no-grant (404) and grantee (403) branches; panels list kept as-is (403 via directive); DataSource/DataType resolver language updated from `findById` to `findByIdInternal`.

**Verification**: Difference captured accurately reflects CS4 implementation:
- Dashboard/panel mutations: `findByIdOwned` (no grant → None → 404), then owner-check (grantee → 403)
- Export/duplicate: `findById(sharing-aware)` → owner-only check (grantee visible → 403)
- Panel list: `AclDirective.authorizeResourceWithSharing` confirms resource exists → 403 for no-grant (not 404)

**Finding**: Spec split is correct and complete. ✓

### data-source-acl/spec.md
**Changes**: DELETE/preview/refresh cross-user scenarios updated from 403 to 404 (existence-not-leaked). Scenario text changed from "Non-owner cannot X" to "Non-owner receives 404 for another user's source".

**Verification**: Matches CS3 implementation (`findByIdOwned` returns None → NotFound). ✓

### data-type-acl/spec.md
**Changes**: PATCH/DELETE cross-user scenarios updated from 403 to 404 (existence-not-leaked). Scenario text updated.

**Verification**: Matches CS3 implementation (`findByIdOwned` returns None → NotFound). ✓

---

## Performance Smoke Review

**Query plan excerpts from executor report:**

| Path | Plan | Execution | Status |
|------|------|-----------|--------|
| Dashboard list (owner-scoped) | Bitmap Heap Scan + Bitmap Index Scan on `idx_dashboards_owner_id` | 0.074 ms | ✓ Index scan |
| Dashboard + grant (EXISTS join) | Nested Loop Semi Join with Index Scan on both legs | 0.054 ms | ✓ O(log n) |
| Pipeline list | Index Scan on `idx_pipelines_owner_id` | 0.065 ms | ✓ Index scan |
| DataType list | Index Scan on `idx_data_types_owner_id` | 0.066 ms | ✓ Index scan |
| DataSource list | Index Scan on `idx_data_sources_owner_id` | 0.041 ms | ✓ Index scan |

**Note**: Dashboard query uses Bitmap Scan at 100 rows/user (planner prefers sequential heap access over random I/O for large result sets). This is expected and will switch to Index Scan at lower row counts — no spinoff needed.

**Finding**: All hot paths hit their indexes. No sequential scans. Sub-millisecond latency confirmed. ✓

---

## Docs Review

### CONTRIBUTING.md
New ACL triad section (lines 50–63) clearly documents:
- Three flavors and when to use each
- Existence-not-leaked semantics (None → 404, never 403 for non-visible)
- 403 reserved for visible-but-unauthorized (role gates)

✓ Clear and actionable.

### design.md
Updated Q2 section (lines 165–169) references HEL-272 (PostgreSQL RLS epic) with sub-tickets HEL-273–277 for:
- HikariCP session-var infrastructure
- RLS policies for dashboards, panels, pipelines, data-types/sources

✓ Anchors RLS as tracked follow-up work (belt + suspenders).

---

## Spinoff Tickets (Executor's findings)

Executor could not file these via Linear MCP but drafted documentation for manual filing:

1. **Cross-user JoinStep right-source** (P2/High): Pipeline owner can join against any data source in system; should restrict to owner-owned or shared sources. Blocked by pipeline sharing.
2. **Pipeline sharing** (P3/Medium): Every pipeline read is owner-only; no sharing grants. Template: dashboard sharing (HEL-36).
3. **File-size soft-budget overruns** (P3/Medium): DashboardService, PanelService, DashboardRepository, PanelRepository all above 250L budget (max 300L for services). Behavior-preserving refactor candidate.
4. **PanelRepository.findAllByDashboardId multi-round-trip optimization** (P3/Medium): Sharing-aware panel list uses 2–3 `db.run` calls (fetch dashboard → check grant → fetch panels). Single Slick JOIN could reduce to one round-trip.

All spinoffs are ancillary to CS5 and correctly identified. Filing is proceeding in parallel (orchestrator handling).

---

## Overall: PASS

### Summary
- **Spec**: All Cycle 6 tasks completed; no partial reinterpretations
- **Code**: Audit confirmed zero unscoped `findById(` callers remain; all three `requireOwnerOnly` callers legitimate; all inline role guards documented and necessary
- **Docs**: CONTRIBUTING.md triad section clear; design.md HEL-272 reference anchors RLS as tracked follow-up
- **Archive**: Clean move from active to archive directory; openspec validation passes; all artifacts present
- **Gates**: All test suites pass (715/715 backend, lint/format/openspec clean); no frontend changes
- **Performance**: All hot paths index scans, sub-millisecond, no sequential scans

### Chain-level summary (HEL-265 closeout)

This final cycle marks completion of the five-PR HEL-265 repo-layer ACL enforcement epic:

**P0 closures:**
- HEL-271: Pipeline ACL enforcement (CS2) — pipelines now owner-only with per-user isolation
- HEL-268: DataType cross-user leak (CS3) — `GET /api/types/:id` now 404 for non-owners
- HEL-242: DataType rows leak (CS3) — `GET /api/types/:id/rows` now 404 for non-owners

**Security improvements:**
- Cross-user GET reads uniformly return 404 (existence-not-leaked) instead of leaking data
- Dashboard/panel sharing semantics preserved: grantees (viewer/editor) visible, with role-based mutation gates (403 for read-only)
- `/api/panels/:id/query` hole closed (CS4) — now honors dashboard sharing instead of wide-open
- All ACL'd repos enforce identity check in SQL layer (not just service layer)

**Pattern establishment:**
- `findByIdOwned(id, user)` — mutation/refresh/delete paths (404 for non-owner)
- `findById(id, callerOpt)` — sharing-aware reads (dashboard/panel only)
- `findByIdInternal(id)` — privileged paths with documented callers
- Documented in CONTRIBUTING.md as the ACL triad; enforced by design.md Q1 callsite map

**Defense-in-depth queued:**
- HEL-272 RLS epic filed with sub-tickets (HEL-273–277) for PostgreSQL row-level security as belt+suspenders layer

All gates green. Archive clean. Ready to merge.

### Non-blocking suggestions
None. Cleanup cycle is complete and correct.

---

Overall evaluation: **PASS**

No changes requested.
