# Evaluation Report — Cycle 3 (PR/CS3)

**Overall: PASS**

---

## Phase 1: Spec Review

**Status: PASS**

### Specification Compliance Checklist

- [x] All Cycle 4 (PR/CS3) task checkboxes marked `[x]` — verified at `tasks.md:81-116`
- [x] `DataTypeRepository.findByIdOwned(id, user)` — collapses the 2-arg overload; defined at line 71 with owner-scoped SQL predicate
- [x] `DataTypeRepository.findByIdInternal(id)` — unscoped read, keeps existing behavior; defined at line 63 with documented privileged callers (ResourceTypeRegistry resolver, PipelineRunService.upsertFieldsFromRows)
- [x] `DataTypeRepository.existsBoundToAnyOwnedPanel(typeId, user)` — owner-scoped COUNT; defined at line 117, replaces the old `isBoundToAnyPanel`
- [x] `DataSourceRepository.findByIdInternal(id)` — existing unscoped `findById` renamed (line 80); documented privileged callers include ResourceTypeRegistry resolver, PipelineRunService source lookup, JoinStep, SparkJobSubmitter
- [x] `DataSourceRepository.findByIdOwned(id, user)` — new method at line 92; used throughout DataSourceService and SourceService
- [x] `DataTypeService.findById` / `listRows` / `validateExpression` — all take `user` and call `findByIdOwned` (lines 25–50)
- [x] `DataTypeService.update` / `delete` — `findByIdOwned` at line 59 and 112; redundant `requireOwnerOnly` removed (was delegated to repo)
- [x] `DataTypeService.checkSourceLink` — uses `findByIdInternal` with explicit documentation: "error-message rendering only — the source name is shown to the user who already owns the DataType that links to it. No data is returned about the source's content." (lines 132–134)
- [x] `DataSourceService` all public methods (`update`, `delete`, `refresh`, `preview`) — collapse `requireOwnerOnly` + `findById` to single `findByIdOwned` call (verified in diff; e.g., `update` line 137, `delete` line 160, `refresh` line 186, `preview` line 266)
- [x] `SourceService.refresh` / `preview` — collapse manual `source.ownerId != user.id` guard + `findById` to `findByIdOwned` (diff confirms both methods updated)
- [x] `PanelService.resolveSingleBinding` — switches from the 2-arg `findById(typeId, user.id)` overload to `findByIdOwned(typeId, user)` (line 73)
- [x] `PipelineRunService` source lookups — switch to `findByIdInternal` (privileged: pipeline ACL is the gate); documented at lines 60–65, 99–100, 325–326 with clear comments
- [x] `JoinStep` / `SparkJobSubmitter` — use `findByIdInternal` with documentation: "Privileged: the pipeline ACL is the gate; JoinStep resolves the right-side source (which may belong to a different user per design.md Q1 spinoff)" (JoinStep.scala:52–54; SparkJobSubmitter.scala:202–204)
- [x] `ApiRoutes` registry resolvers — switched to `*Internal` variants with comment block: "Privileged callsite: resolvers here resolve ownership FOR the ACL check — they must use *Internal variants (no user context at registry resolution time)" (lines 51–52)
- [x] 4 existing `ApiRoutesSpec` tests updated from 403→404 assertion (DELETE /data-sources/:id, GET /data-sources/:id/preview, PATCH /api/types/:id, DELETE /api/types/:id) — all with comments explaining the change: "returns 404, not 403 (existence is not leaked)" or similar. This is **intentional** per design.md: repo-level owner scoping returns NotFound to avoid existence leaks.

### Deferred Work Noted

- Cross-user `JoinStep.rightDataSourceId` ACL — documented as spinoff in executor report and design.md Q1. Pipeline join sources may legitimately belong to different users; this is tracked separately (HEL-270 or new ticket). **Correct deferral**: the cross-user join is an intentional design choice, not a bug.

### New Test Coverage

- `DataTypeDataSourceAclSpec` — new comprehensive file (335 lines) with 24 tests covering:
  - GET /types/:id — owner 200, cross-user 404 (HEL-268 leak closed)
  - GET /types/:id/rows — owner 200, cross-user 404 (HEL-242 leak closed)
  - GET /types/:id/validate-expression — owner 200, cross-user 404
  - PATCH /types/:id — owner 200, cross-user 404
  - DELETE /types/:id — owner 204, cross-user 404 (verifies row remains after failed cross-user delete)
  - GET /data-sources (list) — owner sees own sources only, cross-user sources hidden
  - PATCH /data-sources/:id — owner 200, cross-user 404
  - DELETE /data-sources/:id — owner 204, cross-user 404 (verifies row remains)
  - POST /data-sources/:id/refresh — cross-user 404, owner proceeds to validation
  - GET /data-sources/:id/preview — cross-user 404, owner 200
  - Repository layer: `findByIdOwned` returns None for wrong owner; `existsBoundToAnyOwnedPanel` owner-scoped

All assertions are well-structured with comments explaining the HEL-265 CS3 context and the security boundary being tested.

---

## Phase 2: Code Review

**Status: PASS**

### CONTRIBUTING.md Compliance

- [x] No inline fully-qualified names found in the diff. All imports are at file top; no mid-statement `com.helio.X`, `spray.json.X`, `java.util.UUID`, `org.apache.pekko.X` found
- [x] No file-size violations:
  - `DataTypeService.scala`: 156L (under 250L soft budget)
  - `DataSourceService.scala`: 337L (pre-CS3: 354L; CS3 **reduced** by 17L due to removal of `accessChecker` parameter and redundant `requireOwnerOnly` guards)
  - `SourceService.scala`: 314L (under budget)
  - `DataTypeRepository.scala`: 158L (under budget)
  - `DataSourceRepository.scala`: 194L (under budget)
  - All critical files well under the 400L hard cutoff

### Code Quality

- [x] **DRY**: No duplication. The pattern of collapsing `requireOwnerOnly` + `findById` into a single `findByIdOwned` call is cleanly applied across DataTypeService, DataSourceService, and SourceService. The `findByIdInternal` privileged variant is reserved for the handful of callsites explicitly justified in comments.

- [x] **Readable**: Method signatures and return types are clear. The `*Owned` and `*Internal` naming convention (following the pipeline CS2 pattern) is immediately searchable and self-documenting. Comments at every privileged `*Internal` callsite explain why the ACL is bypassed.

- [x] **Modular**: The pattern respects separation of concerns:
  - Repository layer enforces ACL via SQL predicates (owner_id JOIN)
  - Service layer calls the appropriate repo variant
  - Routes thread the authenticated user to services
  - Tests verify ownership at both the repo and route layers

- [x] **Type safety**: No `any` types introduced. All user IDs and resource IDs use proper value-class types (UserId, DataTypeId, DataSourceId). The `AuthenticatedUser` case class is threaded consistently.

- [x] **Security**: 
  - Boundary checks: owner-scoped repo reads enforce ACL at the database level (SQL WHERE predicate)
  - Cross-user requests return NotFound (existence not leaked) per design.md convention
  - Privileged paths (`*Internal`) are documented at every callsite with explicit justification
  - No unscoped public reads remain on DataType or DataSource after CS3

- [x] **Error handling**: All `findByIdOwned` calls map `None → ServiceError.NotFound`, which routes to 404 (verified in ServiceResponse.scala). The wire shape is preservation-critical and is maintained.

- [x] **Tests meaningful**: 
  - The new `DataTypeDataSourceAclSpec` exercises the cross-user matrix across all affected endpoints (6 DataType endpoints × 2 user scenarios, 6 DataSource endpoints × 2 user scenarios, plus 2 repo-level assertions = 16 test "should" blocks with 24 tests)
  - Existing test suite extended with cross-user assertions in repository specs
  - All 676 tests pass; no regressions

- [x] **No dead code**: 
  - `accessChecker` dependency cleanly removed from `DataTypeService` and `DataSourceService` constructors
  - All references to the old `findById(id)` overloads (unscoped) updated to `*Internal` or `*Owned`
  - No TODO/FIXME comments left behind

- [x] **No over-engineering**: The solution is exactly the spec: owner-scoped reads via SQL predicates, privileged reads via `*Internal`, documented callsites. No hypothetical abstractions or future-proofing beyond what's in scope.

- [x] **Behavior-preserving for owners**: Every owner-read path that worked before CS3 still works. The 403→404 transition is **intentional** — the repo now returns None for cross-user reads (which becomes NotFound at the route level) instead of relying on service-layer `requireOwnerOnly` to return Forbidden. This is the design change and is correctly documented.

### Specific Code Snippets Verified

**DataTypeRepository.findByIdOwned** (lines 67–75):
```scala
def findByIdOwned(id: DataTypeId, user: AuthenticatedUser): Future[Option[DataType]] = {
  val ownerUuid = UUID.fromString(user.id.value)
  db.run(table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption)
    .map(_.map(rowToDomain))
}
```
✓ Correct: owner-scoped filter on `r.ownerId === ownerUuid`, returns None for non-match.

**DataTypeService.delete** (lines 111–125):
```scala
def delete(id: DataTypeId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
  dataTypeRepo.findByIdOwned(id, user).flatMap {
    case None     => Future.successful(Left(ServiceError.NotFound("DataType not found")))
    case Some(dt) =>
      checkSourceLink(dt).flatMap { ... }
  }
```
✓ Correct: `findByIdOwned` returns None for non-owner; no redundant `requireOwnerOnly` call.

**DataSourceService.refresh** (lines 186–202):
```scala
def refresh(..., user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
  dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
    case None => Future.successful(Left(ServiceError.NotFound("Data source not found")))
    case Some(s: StaticSource) => staticPayload match { ... }
    case Some(c: CsvSource) => refreshCsv(c, user)
    ...
  }
```
✓ Correct: inline `if (source.ownerId != user.id)` guard collapsed into single `findByIdOwned` call; old guard removed.

**PipelineRunService.submit comment** (lines 60–65):
```scala
// Privileged: pipeline ACL (above) is the authoritative gate; source is
// part of the pipeline definition. findByIdInternal is correct here.
dataSourceRepo.findByIdInternal(pipeline.sourceDataSourceId).flatMap { ... }
```
✓ Correct: explains why the unscoped read is safe.

---

## Phase 3: UI Review

**Status: N/A**

No frontend files were modified in CS3. The diff touches only:
- Backend repositories, services, and routes
- Backend tests
- OpenSpec bookkeeping

The UI wiring to these endpoints was already in place from prior cycles. Phase 3 is not triggered.

---

## Verification Gates

**All gates GREEN:**

| Gate                        | Result  | Evidence |
|-----------------------------|---------|----------|
| `sbt test`                  | ✓ PASS  | 676/676 tests passed (reproduced: May 17, 4:31 PM and 4:32 PM) |
| `npm run lint`              | ✓ PASS  | Zero warnings |
| `npm run format:check`      | ✓ PASS  | All files Prettier-formatted |
| `npm run check:openspec`    | ✓ PASS  | `openspec/ is clean` |
| Inline FQN check            | ✓ PASS  | No inline fully-qualified names in the diff |
| File size budget            | ✓ PASS  | All source files ≤ 337L (under 400L hard limit) |
| AuthService isolation       | ✓ PASS  | No changes to `AuthService.scala` |

---

## Security Boundary Checks

- [x] **Privileged callsite documentation**:
  - `ResourceTypeRegistry` resolvers (ApiRoutes.scala:51–52): documented as "Privileged callsite" in comment block
  - `PipelineRunService.submit` (PipelineRunService.scala:60–65): "Privileged: pipeline ACL (above) is the authoritative gate"
  - `PipelineRunService.previewStep` (PipelineRunService.scala:99–100): "Privileged: pipeline ACL is the authoritative gate"
  - `PipelineRunService.upsertFieldsFromRows` (PipelineRunService.scala:325–326): "Privileged: this is a background post-run schema sync"
  - `JoinStep.evaluate` (JoinStep.scala:52–54): "Privileged: the pipeline ACL is the gate"
  - `SparkJobSubmitter` (SparkJobSubmitter.scala:202–204): "Privileged: Spark batch driver runs outside request context"
  - `DataTypeService.checkSourceLink` (DataTypeService.scala:132–134): "error-message rendering only"

- [x] **No ACL-bypass without justification**: Every `*Internal` callsite has an inline comment explaining why the user context is unavailable or why the parent resource's ACL is the authoritative gate.

- [x] **404 vs 403 convention consistently applied**: Repository predicates return None for non-owners (via SQL), which converts to NotFound (404) at the route layer. This prevents existence leaks and is uniform across all endpoints.

---

## Overall Assessment

CS3 fully implements DataType + DataSource ACL enforcement per the design specification. The execution is clean:

1. **Specification adherence**: All 16 task items in Cycle 4 (PR/CS3) are checked and completed. The HEL-268, HEL-242, and HEL-256 leaks are closed by moving owner-scoping from the service layer to the repository layer (SQL predicates).

2. **Test coverage**: The new `DataTypeDataSourceAclSpec` (335 lines, 24 tests) comprehensively covers the cross-user matrix for all affected endpoints. The 4 test assertions that changed from 403→404 are intentional per the design and are well-commented.

3. **Code quality**: The codebase is clean. No inline FQNs, no file-size violations, no dead code, no over-engineering. The `accessChecker` dependency is cleanly removed from services where the repo enforcement now covers the ACL.

4. **Security**: Privileged reads (`*Internal` variants) are reserved for the documented callsites where either user context is unavailable (background Spark driver, registry resolvers) or the parent resource's ACL is the authoritative gate (pipeline execution). Every privileged callsite is justified in code comments.

5. **Verification gates**: All gates pass (sbt test: 676/676, npm lint, format, openspec). No regressions.

---

## Non-Blocking Observations

- The executor noted that `GET /api/data-sources/:id` (single-source GET) does not exist as a route, only PATCH and DELETE. This is correct — the route surface only has list + those mutations. CS5 cleanup should audit whether a single-source GET endpoint is needed (out of scope for CS3).

- The cross-user JoinStep source reference is correctly flagged as a spinoff (HEL-270 or new ticket). The design rationale is sound: join targets may legitimately belong to different users today, and restricting them to co-owners/shared sources is a future design choice, not a bug in CS3.

---

## Critical Path (for reference)

No critical issues. All phases clear. Ready for merge.
