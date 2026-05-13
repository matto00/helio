# Evaluation Report — Cycle 1

## Overall verdict: PASS (with minor non-blocking recommendations)

The split is real, mechanical, and behavior-preserving. All gates pass. The new `package.scala` shim is load-bearing (it backs explicit `import com.helio.api.{Type}` named imports in 9 files plus 9 wildcard-import call sites) so it can stay, though five of its 80 aliases are dead and could be trimmed. No correctness blockers.

Verification confidence: 5 / 5.

---

## Per-section findings

### 1. OpenSpec artifacts — PASS
Read in full. Contract is "structural-only, byte-identical wire shape, ≤ 80 LOC aggregator, ≤ 250 LOC per per-domain file, schema-drift checker updated, two route files migrated to ID-segment matchers."

### 2. tasks.md honesty — PASS
Spot-checked 5+ items against diff:
- 2.1 ResourceProtocol (28 lines, owns the listed three types ✓)
- 3.1 Aggregator 34 lines ✓
- 3.3 zero `implicit val ... = ...` in JsonProtocols.scala (grep finds only a doc-comment occurrence) ✓
- 4.1/4.3 `path(Segment)` → `path(*IdSegment)` rewrites verified in both files; no `path(Segment)` remains in DashboardRoutes/PanelRoutes ✓
- 6.1 AggregatorRegressionSpec exists and round-trips all 10 listed types ✓
- 7.6 PanelProtocol = 211 lines (max) ✓

One overcount in claim: executor said "13 PanelId(panelId) wraps removed"; actual deletion count is **17** (and 10 `DashboardId(dashboardId)` removed vs. claimed 13). The direction is right, the arithmetic is loose — no functional consequence.

### 3. Per-domain split real and minimal — PASS

All four inter-trait dependencies are declared *and* necessary:
- `PanelProtocol extends ResourceProtocol` — `PanelResponse` embeds `ResourceMetaResponse`.
- `DashboardProtocol extends PanelProtocol` — `DuplicateDashboardResponse` and snapshot types use panel types.
- `PipelineProtocol extends DataTypeProtocol` — `PipelineAnalyzeResponse` carries `SchemaFieldResponse`.
- `DataSourceProtocol extends DataTypeProtocol` — `CreateSourceResponse` carries a `DataTypeResponse`. Confirmed via doc-comment at line 130 of `DataSourceProtocol.scala` and the case-class field list at line 55.

No duplicated case classes across protocol files (verified by sorted dedup + manual count). All 94 implicit Format declarations from the original land in exactly one protocol file each (sum: 14+18+18+8+18+3+12+3 = 94). All 79 case classes from the original are present and identical modulo `spray.json.JsObject` → `JsObject` (covered by `import spray.json._`) and `com.helio.domain.User` → `User` (covered by `import com.helio.domain._`).

### 4. package.scala scrutiny — PASS with recommendation

**Is it load-bearing?** Yes — partially. Survey:

- 9 files do `import com.helio.api._` (every route file, including DashboardRoutes, PanelRoutes, AuthRoutes, etc.). Those rely on package-object members for unqualified type references in handler bodies (`DashboardResponse(...)`, `ErrorResponse(...)`, etc.).
- 9 more files do *explicit named* imports such as `import com.helio.api.{DashboardLayoutPayload, DashboardSnapshotPanelEntry, ...}` (PipelineRoutes, PipelineRunRoutes, PipelineStepRoutes, PanelRepository, DashboardRepository, plus 4 test specs). These directly require the alias to exist.

The design said "Survey first; … if no transitive imports exist, skip the re-export." Transitive imports DO exist, so the shim is justified. Without it, those 9 named-import sites would all need to be rewritten to `com.helio.api.protocols.{...}` — which is exactly the CS2 cleanup, intentionally out of scope here.

**Is it over-built?** Five aliases have zero hits outside the protocols package and the shim itself:
- `UserPreferencePayload`
- `DataFieldResponse`
- `ComputedFieldResponse`
- `CreateDataSourceRequest`
- `RestApiAuthPayload`

These are nonessential. They can be removed without breaking compilation today. Non-blocker — recommend trimming when CS2 cleans up the named-import sites entirely.

### 5. Wire-shape verification — PASS

`AggregatorRegressionSpec.scala` round-trips the 10 listed top-level types (DashboardResponse, PanelResponse, DataSourceResponse, DataTypeResponse, PipelineSummaryResponse, RunResultResponse, RunStatusResponse, AuthResponse, PermissionResponse, DashboardSnapshotPayload) and asserts equality. Coverage is real, not superficial.

The four custom (non-`jsonFormatN`) formatters were diffed character-by-character against the original 832-line `JsonProtocols.scala`:
- **`UpdatePanelRequest`** (PanelProtocol.scala:138-187) — write/read logic is byte-identical for `Option[Option[_]]` semantics on `typeId` and `fieldMapping`.
- **`RunStatusResponse`** (PipelineProtocol.scala:119-140) — conditional emission of `rows`/`error`/`rowCount` matches original exactly.
- **`PanelQuery`** (PanelProtocol.scala:194-210) — write/read identical, including `JsNull` handling for `sort`/`limit`.
- **`GoogleProfile`** (AuthProtocol.scala:44-54) — read-only formatter identical.

All 94 `implicit val …Format` declarations match the original on (name, type signature, RHS prefix `jsonFormatN`). The companion-object `fromDomain` bodies are identical modulo FQN-to-bare-name normalization (one diff: `com.helio.domain.User` → `User` in `UserResponse.fromDomain`).

### 6. ID-wrapper boundary changes — PASS

DashboardRoutes.scala: 4 `path(Segment)` → `path(DashboardIdSegment)` rewrites (at lines 74, 97, 112, 181). No `path(Segment)` remains. 10 `DashboardId(dashboardId)` wraps removed from handler bodies — every call site that previously wrapped now passes the already-typed `DashboardId` to `dashboardRepo.{findById, duplicate, exportSnapshot, updateName, delete}`. No string-conversion (`.value`) was silently dropped: all surviving `.value` calls are on `panel.dashboardId.value` etc. (string-keyed ACL paths), which is intentional and pre-existing.

PanelRoutes.scala: 3 `path(Segment)` → `path(PanelIdSegment)` rewrites (lines 122, 291, 304). 17 `PanelId(panelId)` wraps removed. All repo signatures (`panelRepo.{findById, delete, updateTitle, updateAppearance, updateType, updateContent, updateTypeBinding, updateImage, updateDividerFields, duplicate}`) accept `PanelId` directly — the wraps were redundant.

Inventory of `path(Segment)` remaining in OTHER routes (CS2 work, per task 4.4):
- `PermissionRoutes.scala:66`
- `DataTypeRoutes.scala:38, 55, 74`
- `DataSourceRoutes.scala:174, 248, 321`
- `PipelineRoutes.scala:94, 157`
- `SourceRoutes.scala:265, 359`

(Inventory exists in code; no separate handoff doc was authored. Acceptable.)

### 7. Schema-drift checker update — PASS

`scripts/check-schema-drift.mjs`:
- Globs `protocols/*.scala` AND keeps the aggregator (lines 44-49). ✓
- Duplicate-class-name guard logic at lines 56-60 is sound: maintains `classOrigin` map, calls `process.exit(1)` with both file paths on collision. I did NOT test by introducing a duplicate (would dirty the worktree), but the logic is straightforward and review-clean.
- `npm run check:schemas` actually runs across all 10 protocol files (`schemas in sync with JsonProtocols (6 checked across 10 protocol files)`).

### 8. Repository / directive coupling — PASS (unchanged, as expected)

`DataTypeRepository`, `PanelRepository`, `DashboardRepository`, `AclDirective`, `AuthDirectives` still `extends JsonProtocols`. Confirmed via grep. CS2 will untangle this. The aggregator's mixin completeness is what keeps them compiling — verified by the green test suite.

### 9. Gate output (last 5 lines each)

**sbt test:**
```
[info] Run completed in 25 seconds, 980 milliseconds.
[info] Total number of tests run: 506
[info] Suites: completed 27, aborted 0
[info] Tests: succeeded 506, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

**npm run check:schemas:**
```
> helio@1.0.0 check:schemas
> node scripts/check-schema-drift.mjs

schemas in sync with JsonProtocols (6 checked across 10 protocol files)
```

**npm run check:openspec:**
```
> helio@1.0.0 check:openspec
> node scripts/check-openspec-hygiene.mjs

openspec/ is clean
```

**npm run lint:**
```
> helio@1.0.0 lint
> eslint . --max-warnings=0
```
(zero output = zero warnings = pass)

**npm run format:check:**
```
> prettier . --check

Checking formatting...
All matched files use Prettier code style!
```

**npm test (frontend Jest):**
```
Test Suites: 58 passed, 58 total
Tests:       664 passed, 664 total
Snapshots:   0 total
Time:        6.135 s
Ran all test suites.
```

### 10. File-size budget — PASS
```
   34 JsonProtocols.scala         (≤ 80 ✓)
  182 package.scala               (unbudgeted shim; flagged separately)
   58 AuthProtocol.scala
  185 DashboardProtocol.scala
  166 DataSourceProtocol.scala
   77 DataTypeProtocol.scala
   21 IdParsing.scala
  211 PanelProtocol.scala         (max; ≤ 250 ✓)
   26 PermissionProtocol.scala
  143 PipelineProtocol.scala
   28 ResourceProtocol.scala
```

### 11. Diff hygiene — PASS

I extracted case-class signatures and implicit-val signatures from the pre-split aggregator and from the union of new protocol files, normalized whitespace, and diffed. Result:
- 79 case classes in original = 79 case classes in split, identical except for two FQN→bare-name normalizations (`spray.json.JsObject` → `JsObject`, `com.helio.domain.User` → `User`) covered by the respective imports.
- 94 implicit val Formats in original = 94 implicit val Formats in split; (name, target type, RHS prefix) identical across the board.
- 17 companion objects in original; same 17 in split (plus the new `IdParsing` object). Only body-difference is the `User` FQN→bare rename in `UserResponse.fromDomain`.
- No `jsonFormatN` arity mismatch.
- No moved-and-renamed identifier.

This is the cleanest possible mechanical move.

---

## Blockers
None.

## Recommendations (non-blocking)

1. **Trim 5 dead aliases from `backend/src/main/scala/com/helio/api/package.scala`.** The aliases for `UserPreferencePayload`, `DataFieldResponse`, `ComputedFieldResponse`, `CreateDataSourceRequest`, `RestApiAuthPayload` have zero usages outside the protocols package itself. Safe to delete now. (Or, better: defer to CS2 when the named-import sites get rewritten to `com.helio.api.protocols.{...}` and the entire `package.scala` shim can be deleted in one shot.)

2. **CS2 inventory documented inline.** The 11 remaining `path(Segment)` sites for IDs across PermissionRoutes / DataTypeRoutes / DataSourceRoutes / PipelineRoutes / SourceRoutes are listed in this report (Section 6). Consider pasting that list into the CS2 ticket description before opening CS2.

3. **Optional: tighten the regex in `parseCaseClasses` (line 22 of `check-schema-drift.mjs`).** The current `[^)]*` body matcher fails on nested parentheses in a field type signature; no current case class has that, but if one is added later (e.g. `Either[Foo, Bar](...)`) the duplicate guard might silently miss it. Low priority.

4. **Optional: extract `package.scala` aliases by domain.** All 80 aliases live in one file. If CS2 doesn't delete the shim entirely, consider splitting it into `package.scala` (one section per domain trait) to mirror the protocol file layout. Cosmetic.

---

## Verdict

**PASS.** Ship CS1 as-is. The refactor is mechanically clean, behavior-preserving, and the only over-build is the 5 dead aliases in `package.scala`, which are immaterial and naturally swept up in CS2.
