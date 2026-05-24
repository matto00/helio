## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues:
- All tasks.md checkboxes are honestly checked; spot-check against diff confirms every claim:
  - 1.1–1.5 ID-segment rollout verified across DataTypeRoutes, PermissionRoutes, DataSourceRoutes, PipelineRoutes, SourceRoutes — `grep` shows segment use at every claimed call site.
  - 1.6 PipelineRunRoutes and PipelineStepRoutes use `pathPrefix("pipelines" / PipelineIdSegment) { pipelineId => val pid: String = pipelineId.value … }` shadow — pragmatic when repos still take String.
  - 2.1 `applyDashboardUpdate` extracted in DashboardRoutes:118 — both PATCH paths shrink to 4-line wrappers (vs. the design's stated 6–8 line target). Behavior identical to pre-CS2a.
  - 2.2 `validateSnapshotPayload` rewritten as `for`-comprehension in DashboardSnapshotRoutes object — companion-level helpers per task spec.
  - 2.3 `DashboardSnapshotValidationSpec` has the four failure cases + one happy path (5 cases).
  - 2.4 `DashboardSnapshotRoutes.scala` created (109 lines) and wired in ApiRoutes:129.
  - 3.1–3.4 `ResolvedPanelPatch` preserves `Option[Option[_]]` for both `typeIdUpdate` and `fieldMappingUpdate`. PATCH body shrunk to 8 lines, validation chain ≤ 4 levels.
  - 3.5 `PanelPatchService.scala` extracted (202 lines).
  - 4.1–4.5 Repository/directive narrowing applied. `DashboardRepository extends DashboardProtocol with PanelProtocol` — `PanelProtocol` is genuinely needed for `convertTo[PanelAppearance]` at line 26. `PanelRepository extends PanelProtocol`. `DataTypeRepository extends DataTypeProtocol`. `AclDirective extends ResourceProtocol`. `AuthDirectives extends ResourceProtocol`. No `extends JsonProtocols` remains in infrastructure or in directives.
  - 5.1–5.3 Splits performed. SourceRoutes 182 lines, DataSourceRoutes 228 lines, AuthRoutes 153 lines.
  - 6.6 PipelineRunRoutes intentionally left at 376 lines (CS2b scope per proposal).
  - 6.8 No `return Left|return Right` patterns remain in `routes/`.

### Phase 2: Code Review — CHANGES_REQUESTED

**High-risk surgery verdicts**

1. **PanelRoutes PATCH semantic preservation — VERIFIED PRESERVED.**
   `ResolvedPanelPatch.typeIdUpdate: Option[Option[DataTypeId]]` and `fieldMappingUpdate: Option[Option[JsValue]]` retain the three states. In `resolvePatch`:
   - `typeIdUpdate = request.typeId.map(_.map(DataTypeId(_)))` — preserves outer `None` (absent), `Some(None)` (explicit null clearing), `Some(Some(x))` (set).
   - `fieldMappingUpdate = request.fieldMapping` — already `Option[Option[JsValue]]`, passed through unchanged.
   In `applyBinding` (PanelPatchService:82):
   - `newTypeId = spec.typeIdUpdate.fold(panel.typeId)(identity)` — preserves the old `request.typeId.fold(panel.typeId)(_.map(DataTypeId(_)))` semantics (math equivalence verified).
   - `newFieldMapping = spec.fieldMappingUpdate.fold(panel.fieldMapping)(identity)` — same shape as before.
   `applyBinding` only fires when `spec.typeIdUpdate.isDefined || spec.fieldMappingUpdate.isDefined` (line 83) — same gate as `hasBinding` in the original.
   Tests: existing PanelPatch integration tests in the 511-suite cover both null and absent cases; all pass. No new unit test for the three-state distinction was added, but the integration coverage is sufficient.

2. **AuthRoutes split — VERIFIED, with one behavioral nuance.**
   - Session token generation (32 bytes hex), session TTL (30 days), DummyHash, BCrypt cost (12), `isBcryptedBounded` ordering — all byte-identical to pre-CS2a.
   - CSRF state TTL (300s) and validation semantics — identical.
   - **Behavioral change (intentional, not a regression):** the in-memory CSRF state store was previously a per-`AuthRoutes`-instance member; it is now a global `object AuthSupport` field shared across the JVM. In production (one JVM, one OAuthRoutes instance) the effect is identical; in tests (where instances are created fresh) the OAuth state is now JVM-wide. Random hex collisions are astronomically unlikely, all 511 tests pass, so this is observationally equivalent. Worth a callout but not a blocker.
   - `OAuthRoutes` has the same upstream-error classification, same response codes (502 BadGateway on token-exchange failure, 400 on invalid state, etc.).
   - GoogleOAuthRoutesSpec updated to target `OAuthRoutes`; all 13 OAuth tests pass.

3. **DashboardRoutes.resolvePanels removal — VERIFIED.**
   `git grep "resolvePanels"` shows: only `PublicDashboardRoutes` has a live caller (its own copy at :27, called at :53); `PanelPatchService` defines one but no one calls it (see below); the `DashboardRoutes` copy was indeed dead. Removal was correct.

4. **CONTRIBUTING compliance audit — TWO BLOCKERS.**
   - `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala:181` — `partsMap: Map[String, org.apache.pekko.util.ByteString]` is an inline FQN **introduced by this PR** in the new `insertCsvSource` helper. Violates the *Imports & Qualifiers* rule. Trivial fix: add `import org.apache.pekko.util.ByteString` at the top and use `Map[String, ByteString]`.
   - Pre-existing inline FQNs carried forward unchanged (not introduced by CS2a; flag as spinoff per refactor-discipline):
     - `OAuthRoutes.scala:65` — `org.apache.pekko.http.scaladsl.model.headers.RawHeader` (moved from `AuthRoutes`)
     - `PipelineRunRoutes.scala:83` — `java.util.UUID.randomUUID().toString`
     - `PipelineStepRoutes.scala:20` — `org.postgresql.util.PSQLException`
     - `DataSourcePreviewRoutes.scala:195` — `java.nio.file.NoSuchFileException` (moved from `DataSourceRoutes`)
     - `infrastructure/DashboardRepository.scala:13` — `db: slick.jdbc.JdbcBackend.Database` (moved-with-class)

   File-size check (every file under `routes/` except the explicitly-deferred `PipelineRunRoutes.scala`):
   ```
    153 AuthRoutes.scala         53 AuthSupport.scala
    222 DashboardRoutes.scala   109 DashboardSnapshotRoutes.scala
     25 DataSourceCsvSupport.scala
    201 DataSourcePreviewRoutes.scala
    228 DataSourceRoutes.scala
    162 DataTypeRoutes.scala
     14 HealthRoutes.scala
    148 OAuthRoutes.scala
    202 PanelPatchService.scala
    214 PanelRoutes.scala
     82 PermissionRoutes.scala
    223 PipelineRoutes.scala
     90 PipelineRunRegistry.scala
    376 PipelineRunRoutes.scala   ← out-of-scope, CS2b
    114 PipelineStepRoutes.scala
     60 PublicDashboardRoutes.scala
    248 SourcePreviewRoutes.scala ← tight but in budget
    182 SourceRoutes.scala
   ```

5. **Repository/directive narrow check — VERIFIED.**
   - `DashboardRepository extends DashboardProtocol with PanelProtocol` — both are required. PanelProtocol is used by `convertTo[PanelAppearance]` (line 26) and the embedded snapshot import/export panel formatters. No over-mixing.
   - `PanelRepository extends PanelProtocol` — clean, only panel formatters used.
   - `DataTypeRepository extends DataTypeProtocol` — clean.
   - `AclDirective extends ResourceProtocol`, `AuthDirectives extends ResourceProtocol` — both only need `ErrorResponse`.
   - `sbt compile` and `sbt test` clean (511/511 pass).

**Other Phase 2 findings**

- **Dead code introduced (minor blocker):** `PanelPatchService.resolvePanels` at lines 148–151 is defined but never called. The files-modified.md claims it's "used by the GET-list handlers in `PanelRoutes` / `PublicDashboardRoutes`" — but `PanelRoutes` has no GET-list handler that calls it, and `PublicDashboardRoutes` still owns its own private copy. The executor moved a helper that was already dead in `PanelRoutes` pre-CS2a (the diff confirms it had no callers before either) into the new service and kept it dead. Either delete it, or wire `PublicDashboardRoutes` to use `PanelPatchService.resolvePanels` (the latter would be a small DRY win but expands the scope; deletion is cleaner).
- **Comment vs. parameter mismatch:** `DashboardRoutes.scala:20-21` says `panelRepo` and `dataTypeRepo` are kept "to preserve the public wiring signature even though the dead `resolvePanels` helper that depended on them has been removed." Both are now `@annotation.unused`. This is consistent with the comment but means `DashboardRoutes`' constructor accepts two dependencies it doesn't use — a small contract smell. The downstream wiring (`ApiRoutes.scala:128`) still passes them, so removing the parameters is a single-PR change. Non-blocking: documented intent matches the code.
- **`PanelRoutes.scala:18-20`:** `@annotation.unused dashboardRepo` and `@annotation.unused permissionRepo` — same pattern. Tolerable as part of the same "preserve wiring signature" discipline.
- **DRY win missed:** `DashboardRoutes.scala:91-103` (DELETE) and `:122-128` (PATCH 404/Forbidden branches) repeat the `findById → 404/Forbidden` pattern that `applyDashboardUpdate` also encodes. Not new in CS2a, but worth a spinoff for a future cleanup.
- **`SourcePreviewRoutes.scala:38`:** `if (computedFields.isEmpty) return (rows, Vector.empty)` — local `return` in a `private def`. Pre-existing (moved from old `SourceRoutes.scala:37`), so acceptable under behavior-preserving rules, but worth flagging in a spinoff alongside the other inline-FQN cleanups.
- **`DataSourceRoutes.scala:181`:** the new `insertCsvSource(name: String, bytes: Array[Byte], csvContent: String, partsMap: Map[String, org.apache.pekko.util.ByteString])` parameter list is a long positional argument list. With four positional args of similar types it would be slightly safer as a named record or to drop `csvContent` (it's just `new String(bytes, UTF_8)` — recomputable). Non-blocking; clean fix in a follow-up.

### Phase 3: UI Review — N/A
Backend-only change per orchestrator policy; no `frontend/` files modified.

### Gate Output Excerpts

```
backend $ sbt test
[info] Total number of tests run: 511
[info] Suites: completed 28, aborted 0
[info] Tests: succeeded 511, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 27 s

$ npm run check:schemas
schemas in sync with JsonProtocols (6 checked across 10 protocol files)

$ npm run check:openspec
openspec/ is clean

$ npm run lint
(no output — clean)

$ npm run format:check
All matched files use Prettier code style!

$ npm test
Test Suites: 58 passed, 58 total
Tests:       664 passed, 664 total
```

### Overall: CHANGES_REQUESTED

Two blockers — both small, mechanical, low-risk to fix. Everything else is solid: spec compliance is high, the `Option[Option[_]]` flatten is mathematically equivalent to the pre-refactor code, the auth split has no security regression, and the repository decoupling is correctly minimal.

### Change Requests

1. **`backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala`:** add `import org.apache.pekko.util.ByteString` to the top of the file and change the type at line 181 from `Map[String, org.apache.pekko.util.ByteString]` to `Map[String, ByteString]`. Rationale: `CONTRIBUTING.md` *Imports & Qualifiers* — no inline FQN where an import would do. This is the one new inline FQN this PR introduces.

2. **`backend/src/main/scala/com/helio/api/routes/PanelPatchService.scala`:** delete the unused `resolvePanels` method (lines 148–151) and its doc comment. `files-modified.md` claims it's "used by the GET-list handlers" but no such caller exists — `PublicDashboardRoutes` retains its own private copy. Either (a) delete it, or (b) refactor `PublicDashboardRoutes` to call `PanelPatchService.resolvePanels` (out-of-scope tightening). Recommended: (a).

3. **`backend/src/main/scala/com/helio/api/routes/PanelPatchService.scala`:** while editing PanelPatchService for (2), also update the doc comment at line 148–149 so it does not falsely claim usage.

### Non-blocking Suggestions

1. Update `files-modified.md` "Added" section to remove the inaccurate claim that `PanelPatchService.resolvePanels` is "used by the GET-list handlers in `PanelRoutes` / `PublicDashboardRoutes`".
2. Drop `csvContent` from `insertCsvSource(name, bytes, csvContent, partsMap)` — it's `new String(bytes, UTF_8)`, recomputable from `bytes`, reduces parameter surface from 4 to 3 (`DataSourceRoutes.scala:181`).
3. The `DashboardRoutes` constructor now accepts `panelRepo` and `dataTypeRepo` only to preserve a public signature for the dead `resolvePanels` helper that's already gone. A follow-up could drop both parameters and update `ApiRoutes.scala:128` correspondingly.
4. The CSRF in-memory store moved from per-instance to a global `object AuthSupport` field. Operationally identical, but worth a one-line comment on the original "In production, this would be a session cookie or distributed store" intent — the comment now sits next to the global state, which is fine, but the implication that the store was ever per-instance is gone.

### Spinoff candidates the executor missed

- **Inline FQN cleanup spinoff** — gather the residual inline FQNs (now visible after CS2a's narrowing) into a single sweep:
  - `OAuthRoutes.scala:65` (`RawHeader`)
  - `PipelineRunRoutes.scala:83` (`java.util.UUID.randomUUID`)
  - `PipelineStepRoutes.scala:20` (`PSQLException`)
  - `DataSourcePreviewRoutes.scala:195` (`NoSuchFileException`)
  - `infrastructure/DashboardRepository.scala:13` (`slick.jdbc.JdbcBackend.Database`) and likely the same pattern across other repos.
- **`SourcePreviewRoutes.applyComputedFields`** uses a local `return` (pre-existing, moved). Should be folded into the CS2b cleanup pass for the pipeline engine, since computed-field evaluation is logically a pipeline concern.

### Verification Confidence: 4 / 5

- Code review covered every modified and new file end-to-end, with direct line-by-line equivalence checks against `main` for the PATCH-flatten and the snapshot-validator rewrite.
- Behavioral preservation of `Option[Option[_]]` semantics is mathematically demonstrable and exercised by the existing integration tests in the 511-suite.
- One small confidence gap: I did not exercise the OAuth flow end-to-end manually (no Phase 3), so the assertion that there's no security regression rests on (a) all 13 GoogleOAuthRoutesSpec tests passing and (b) byte-level diff inspection of the moved auth code. Both are strong but not as good as a live run. Tagging at 4 rather than 5 to reflect that.
