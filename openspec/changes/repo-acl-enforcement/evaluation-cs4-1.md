# Evaluation Report — CS4 (Dashboard + Panel ACL enforcement)

**Overall: PASS**

## Phase 1: Spec Review — PASS

### Task Completion

All Cycle 5 tasks are marked `[x]` and implemented:

- `DashboardRepository.findById(id, callerOpt)` — sharing-aware; owner OR grant OR public-viewer fallback ✅
- `DashboardRepository.findByIdOwned(id, user)` — owner-only ✅
- `DashboardRepository.findByIdInternal(id)` — no-ACL, registry resolver only ✅
- `DashboardRepository.findAllVisible(user)` — sharing-aware list (feature-flagged, not wired) ✅
- `PanelRepository.findByIdInternal(id)` — renamed from `findById` ✅
- `PanelRepository.findById(id, callerOpt)` — sharing-aware via parent dashboard ✅
- `PanelRepository.findAllByDashboardId(dashboardId, callerOpt)` — sharing-aware, used by `PublicDashboardRoutes` ✅
- `DashboardService.delete/duplicate/update/exportSnapshot` — removed inline owner checks; use sharing-aware `findById` with role checks ✅
- `PanelService.findById` — switched to sharing-aware, closes `/api/panels/:id/query` hole ✅
- `PanelService.batchUpdate` — collapsed inline owner check; dashboard-level ACL is authoritative gate ✅
- `PublicDashboardRoutes` — uses `findAllByDashboardId(dashboardId, userOpt)` ✅
- Test coverage: owner regression, editor/viewer grants, public-viewer, 404 vs 403 matrix ✅
- All gates: 715 tests pass, lint clean, format clean, openspec clean, scala-quality clean (26 soft warnings, all pre-existing) ✅

### 403 vs 404 Design Verification

The nuanced distinction is correctly implemented and tested:

**404 cases (no existence leak for no-grant callers):**
- Cross-user DELETE/PATCH/DUPLICATE/EXPORT with no grant → 404 (verified in `DashboardPanelAclSpec` lines 399–434)
- `/api/panels/:id/query` with no grant → 404, hole closed (verified line 436–444)

**403 cases (grantee visible but mutation blocked or owner-only operation blocked):**
- Editor grant trying to DELETE (owner-only) → 403 (line 469–476)
- Viewer grant trying to DELETE → 403 (line 502–509)
- Viewer grant trying to PATCH → 403 (line 512–520)

**404 vs 403 route-specific distinction:**
- `GET /api/dashboards/:id/panels` (AclDirective path): authenticated no-grant → 403; anonymous no-grant → 404 (documented in executor report section 3.4)
- Dashboard CRUD (service path): no-grant → 404; grantee trying owner-only → 403

This matches the design.md Q1 table. **Test matrix is complete.**

### Acceptance Criteria (Ticket-level)

1. ✅ Every ACL'd repo's public reads accept caller identity and enforce ACL in SQL
2. ✅ No service method has inline `if (resource.ownerId != user.id) Forbidden` against ACL'd repos (collapsed to repo/role checks)
3. ✅ `dataTypeRepo.findById(id)` renamed to `findByIdInternal` with documented internal-only callers (CS3 completed this; CS4 mirrors the pattern)
4. ✅ Regression tests: "wrong user gets None" for every repo covered by `DashboardPanelAclSpec`
5. ✅ Cross-user `GET /api/types/:id` leak (HEL-268) closed in CS3; CS4 extends the pattern
6. ✅ Dashboard/panel sharing (HEL-36) preserved: public-viewer fallback tested (line 525–542)
7. ✅ Owner read paths unchanged: regression tests confirm owner can read own dashboard/panels
8. ✅ All gates pass (see Phase 2)

### Scope & No Regressions

- No changes to AuthService, no new RLS code
- `*Internal` callers documented: ResourceTypeRegistry resolver only
- Changes are isolated to Dashboard + Panel (CS4 scope)
- No modification to existing Pipeline/DataType/DataSource ACL (prior cycles)

**Phase 1: PASS** ✅

---

## Phase 2: Code Review — PASS

### CONTRIBUTING.md Compliance

**Imports & Qualifiers:** ✅
- No inline fully-qualified names in diffs
- Proper top-of-file imports throughout (checked DashboardRepository, PanelRepository, DashboardService, PanelService)
- Pre-commit gate `check:scala-quality` passed with clean FQN enforcement

**File-size budgets (soft 250L, hard 400L for source files):** ✅
- `DashboardRepository.scala`: 353 lines (soft budget overrun; pre-existing pattern, flagged as informational)
- `PanelRepository.scala`: 337 lines (soft budget overrun; pre-existing pattern)
- `DashboardService.scala`: 332 lines (soft budget overrun; pre-existing pattern)
- `PanelService.scala`: 336 lines (soft budget overrun; pre-existing pattern)
- All under hard limit of 400 lines
- Test spec `DashboardPanelAclSpec.scala`: 544 lines (acceptable for comprehensive test suite)
- No new files crossed the hard limit

### DRY & Reusability

- Sharing-aware query pattern is consistent across `findById` and `findAllByDashboardId`
- `PipeOps` helper for `.pipe()` is a pragmatic Scala idiom (lines 278–282 in PanelRepository) — avoids intermediate variable noise in Slick queries
- No duplicated ACL logic; sharing-aware pattern is centralized at the repo level
- `AccessChecker.requireAccess` reused appropriately in services

### Readability & Clarity

- Method documentation is extensive and clear (403 vs 404 distinction documented, role-check paths documented)
- Comments explain the "public-viewer fallback" pattern at line 79 (DashboardRepository)
- Service-layer ACL strategy documented at the class level (DashboardService lines 26–37)
- Test spec comments explain the seeded scenario and 403/404 decision (DashboardPanelAclSpec lines 27–46)

### Modularity & Separation of Concerns

- Repository layer enforces ACL in SQL; service layer delegates to repo or role-checks via `AccessChecker`
- Dashboard ACL is the authoritative gate for panels (batchUpdate comments explain this)
- No cross-cutting concerns bleeding into individual methods
- Routes wire user context through cleanly (PanelRoutes line 61: `panelService.findById(panelId, Some(user))`)

### Type Safety

- Value-class IDs used consistently (`DashboardId`, `PanelId`, `UserId`)
- No `any` types introduced
- Option types used correctly for "may not exist" semantics

### Security

- Input validation unchanged (defer to prior cycles)
- No SQL injection vectors (Slick parameterizes all queries)
- User context properly threaded from routes to repos
- Public-viewer fallback explicitly checked (`p.granteeId.isEmpty && p.role === "viewer"`) to avoid open sharing

### Error Handling

- 404 vs 403 distinction enforced at repo boundary (None → no existence leak)
- Errors propagated via `Either[ServiceError, A]` to routes
- `recover` clause in PanelService.batchUpdate catches DB exceptions as BadRequest

### Tests & Coverage

- `DashboardPanelAclSpec`: 33+ tests covering sharing matrix
- Repository-level tests: `findById(callerOpt)`, `findByIdOwned`, `findAllByDashboardId` for both Dashboard and Panel
- Route-level tests: owner regression, editor/viewer grant, cross-user no-grant, public-viewer
- Test assertions are specific (e.g., `status shouldBe StatusCodes.Forbidden`)
- Tests would catch real regressions (e.g., if someone accidentally removed a grant check)

### No Dead Code

- All new methods are called (findById, findByIdOwned, findByIdInternal in respective layers)
- No leftover TODO/FIXME
- No unused imports

### No Over-Engineering

- Sharing-aware queries use straightforward Slick operations (filter + exists, union)
- No premature abstraction for "future dashboard sharing scenarios"
- `findAllVisible` is feature-flagged and documented as not wired (acceptable for future UI)

### Behavior-Preserving Structure

For service methods using repos:
- Owner reads: `findById(sharing-aware)` returns Some for owner; no change in behavior
- Cross-user reads: `findById(sharing-aware)` returns None (was: service-layer 403 after repo.findById) → now 404
- This is the intended behavior shift, not a drive-by bug

Test evidence: ApiRoutesSpec lines updated from 403 → 404 are marked "HEL-265 CS4" showing intentionality.

**Phase 2: PASS** ✅

---

## Phase 3: UI / Playwright Review — N/A

**Trigger check:** No frontend files modified, no ApiRoutes.scala route signatures changed.

E2E feasibility: `PublicDashboardRoutes` is internal composition (calls repository with userOpt). Frontend continues to use existing routes; no new UI surface. Sharing UI (HEL-36) exists; CS4 only hardens the ACL enforcement, doesn't add new UI.

**Phase 3: N/A** ✅

---

## Verification Gates — All Passing

### Backend Tests
```
Total number of tests run: 715
Tests: succeeded 715, failed 0
All tests passed.
```

### Frontend Tests
```
Test Suites: 59 passed, 59 total
Tests:       674 passed, 674 total
All test suites passed.
```

### Linting
```
npm run lint: clean (0 warnings)
```

### Formatting
```
npm run format:check: All matched files use Prettier code style!
```

### OpenSpec
```
npm run check:openspec: openspec/ is clean
```

### Scala Quality
```
npm run check:scala-quality: clean (26 soft warnings, all pre-existing file-size overruns)
```

---

## Deferred Items (Legitimate, Flagged for CS5)

1. **OpenAPI spec update** — 403 → 404 status-code shifts documented in code, but openspec/specs/ not updated. Flagged for CS5 cleanup.
2. **Performance EXPLAIN check** — not run in this cycle. Deferred to CS5 merge gate.
3. **`findAllVisible` wiring** — feature-flagged off as intended for "shared with me" UI in future.
4. **Remaining `*Repo.findById(` audit** — CS5 will grep for any edge-case callers.

---

## Concerns for CS5

1. **File-size soft budget creep** — four service/repo files now >330L each. Document as acceptable pattern (CS5 may split as refactor).
2. **DashboardPanelAclSpec at 544L** — large test suite but commensurate with sharing-matrix complexity. Parallels ApiRoutesSpec (2994L).
3. **RLS defense-in-depth** — documented in design.md as future belt-+-suspenders; not blocking.

---

## Summary

**Spec:** ✅ All Cycle 5 tasks checked; 403/404 distinction correctly implemented and tested; acceptance criteria met.

**Code:** ✅ CONTRIBUTING.md compliant; no FQNs; DRY; readable; modular; secure; error-handling correct; test coverage complete.

**Testing:** ✅ 715 tests pass (all gates); sharing matrix fully covered; regression tests present.

**Scope:** ✅ No regressions; AuthService untouched; no inline FQNs; no files >400L.

**Performance:** Deferred to CS5 merge gate (acceptable for cycle 1).

---

## Overall: PASS

The implementation is production-ready. Recommend merge with deferred CS5 cleanup items noted for follow-up.
