## Evaluation Report — Cycle 1

## Overall verdict

**CHANGES_REQUESTED** — small, mechanical. Behavior is preserved (511 backend + 664 frontend tests green, all 5 hand smoke flows pass, wire shapes byte-identical on the endpoints sampled). Two CONTRIBUTING.md `Imports & Qualifiers` violations in newly-written service code that the user has explicitly flagged on the prior two PRs need to be fixed before merge.

Verification confidence: **4 / 5**. The diff is well-disciplined, the surgery is clean, and the security-critical paths are byte-identical. The only deductions are (a) the small FQN slips and (b) the inability to side-by-side curl every route at scale (smoke covered the high-risk paths the orchestrator called out).

---

## Phase 1 — Spec Review — PASS

- All `tasks.md` items checked. The deltas (no `PasswordHasher` extraction, no `SessionCookie` since pre-CS2b uses bearer tokens, `OAuthRoutes` at 148 lines because protected test-override hooks must stay on the class, `DataSourceService` 331 / `SourceService` 339 over the 300-line service budget) are explicitly noted with reasonable justifications.
- `proposal.md` acceptance criteria honoured: every route file ≤ 150 except `PipelineRunRoutes` (CS2c scope as explicitly carved out); `PanelPatchService.scala` deleted; `PublicDashboardRoutes.resolvePanels` delegates to `PanelService.resolveBindingsForRead`; specs untouched (wire shape preserved).
- No scope creep — no domain-ADT or wire-shape changes (correctly deferred to CS2c).
- Section 3 fold-ins left unchecked is consistent with the design's "only if tractable" caveat; not a regression.

---

## Phase 2 — Code Review — CHANGES_REQUESTED

### 1. AuthService security audit — PASS (byte-identical)

Compared `services/AuthService.scala` against `main:backend/src/main/scala/com/helio/api/routes/AuthRoutes.scala` + `AuthSupport.scala`:

- BCrypt work factor: `bcryptBounded(BCryptWorkFactor)` with `BCryptWorkFactor = 12` — identical.
- DummyHash literal: `"$2a$12$WnXAlhcaBqZYNJqSnJmFNeY38EqpqKpUwHiMw.xsJp7yDt0hXJqP2"` — byte-identical.
- Session expiry: `30L * 24 * 60 * 60` (30 days) — identical.
- Session token: 32 random bytes hex-encoded — identical (`SecureRandom` instance, 64-char output).
- CSRF state: 16 random bytes hex, 300-second TTL, `ConcurrentHashMap` store — identical (the `generateCsrfState` / `validateCsrfState` bodies moved verbatim from `AuthSupport`).
- Dummy-hash timing equaliser on the missing-email login path is preserved.
- Logout: `findSession` → if found `deleteSession`; if absent return Unauthorized. Identical.
- OAuth state validated BEFORE code exchange — preserved in `OAuthRoutes.handleCallback` (the `if (!stateOpt.exists(...))` short-circuit happens before `completeOAuthExchange` runs the token-fetch chain).
- OAuth code → token → profile endpoints (`https://oauth2.googleapis.com/token`, `https://www.googleapis.com/oauth2/v3/userinfo`) and the form/header shapes are unchanged.
- `isUpstreamOAuthError` heuristic unchanged → 502 on Google failures.

No new authentication bypass code paths introduced.

Smoke evidence (Phase 3) confirms login + logout HTTP semantics:

- `POST /api/auth/login` with valid creds → 200 + `AuthResponse` body containing `token`, `expiresAt`, `user`.
- Bad password / unknown email → 401 `{"message":"Invalid email or password"}`.
- `POST /api/auth/logout` with no header → 401 `{"message":"Authorization header required"}`.
- `POST /api/auth/logout` with bogus token → 401 `{"message":"Invalid or expired token"}`.

### 2. `Option[Option[_]]` semantics in PanelPatchApplier — PASS

`PanelPatchApplier.applyBinding`:

```scala
val newTypeId       = spec.typeIdUpdate.fold(panel.typeId)(identity)
val newFieldMapping = spec.fieldMappingUpdate.fold(panel.fieldMapping)(identity)
```

- `None` (field absent) → outer `fold` returns `panel.typeId` (no change). ✓
- `Some(None)` (explicit null) → inner `identity(None)` returns `None` (clear). ✓
- `Some(Some(x))` → inner `identity(Some(x))` returns `Some(x)` (set). ✓

Composition order (title → appearance → type → content → binding → image → divider → `resolveTypeBinding`) and each step's "short-circuit if upstream returned None" behaviour are byte-identical to pre-CS2b `PanelPatchService.applyPanelPatch` (verified by line-level comparison).

Smoke 4 confirms tri-state at runtime:

- Original panel had `typeId="21ce4b95-…"` + `fieldMapping={series, xAxis, yAxis}`.
- `PATCH {"typeId": null}` → response `typeId: null`, `fieldMapping` preserved unchanged → `Some(None)` cleared the binding without touching `fieldMapping`. ✓
- Restore PATCH set both back correctly. ✓

### 3. Pekko HTTP leakage audit on `services/` — PASS (clean)

```
grep -rnE "import org\.apache\.pekko\.http|complete\(|StatusCodes\.|entity\(as\[" \
  backend/src/main/scala/com/helio/services/
```

returns no results.

The one nuance: `SourceConfigParsing extends JsonProtocols` and `ServiceResponse extends JsonProtocols` (the latter is in `api/routes/`, not `services/`, so it's permitted). `JsonProtocols` mixes in `SprayJsonSupport` transitively. This pulls the Pekko-HTTP marshaller implicits into `SourceConfigParsing`'s scope. However:

- No code in `services/` references those implicits.
- `SourceConfigParsing` only uses `vectorFormat`, `convertTo`, `JsValue` — pure spray-json.
- The trait reuse is the cheapest way to import every existing spray format into the service-layer.

Behaviour is unchanged. Spec compliance ("No Pekko HTTP types appear in any file under `services/`") preserved on a strict reading because the types are never referenced. Documented as such in `tasks.md` 4.8. Acceptable for CS2b; CS2c may want to factor the pure spray formats out of `JsonProtocols` into a separate `SprayFormats` trait to make the boundary crisper.

### 4. Wire-shape verification — PASS (sampled)

Smoke flows pulled live JSON from the running CS2b backend on port 8081 and compared against expected pre-CS2b shapes:

| Endpoint | Verified |
|---|---|
| `POST /api/auth/login` | `{token, expiresAt, user{id, email, displayName, createdAt}}` shape, 200 on success, 401 on bad creds, 400 on validation, body `{message}` on error |
| `GET /api/dashboards` | `{items: [...]}` envelope preserved (initial jq error was my mistake, not a wire-shape divergence) |
| `GET /api/dashboards/:id/panels` | `{items: [{id, title, type, typeId, fieldMapping, ...}]}` |
| `PATCH /api/panels/:id` (title) | full PanelResponse returned, title round-trips |
| `PATCH /api/panels/:id` (`typeId: null`) | `typeId: null`, `fieldMapping` preserved unchanged |
| `GET /api/dashboards/:id/export` | `{version, dashboard{...}, panels[...]}` matches pre-CS2b shape |
| `POST /api/dashboards/import` | 201 + `{dashboard, panels[...]}` — `DuplicateDashboardResponse` envelope unchanged |
| `POST /api/dashboards/import` w/ `version: 0` | 400 `{"message":"version must be >= 1, got 0"}` |
| `DELETE /api/dashboards/:id` | 204 |

No wire-shape regressions observed on any sampled endpoint.

### 5. File size + budget compliance — PASS (with note)

```
DashboardService.scala         281
PanelService.scala             287
PanelPatchApplier.scala        109
DataSourceService.scala        331  <- 31 over the 300 soft budget
SourceService.scala            339  <- 39 over the 300 soft budget
DataTypeService.scala          138
AuthService.scala              182
PipelineService.scala          201
PermissionService.scala         60
```

CONTRIBUTING.md sets a 250-line soft budget for source files and a 400-line "propose a split" threshold. The two over-budget services are well under 400 and the executor's "defer further split to CS2c when DataSource ADTs land" reasoning is credible — both files are SQL/REST vs CSV/Static dispatchers that will naturally become ADT-discriminated dispatch in CS2c. Accepting for this PR; flagging as a soft request for CS2c follow-up.

All route files ≤ 150 except `PipelineRunRoutes` (377, deferred to CS2c). `OAuthRoutes` at 148 because `exchangeCodeForTokenImpl` / `fetchGoogleProfileImpl` are protected hooks overridden by `GoogleOAuthRoutesSpec` — verified that splitting them out is a tractable CS2c follow-up.

### 6. ACL double-check audit — PASS

Spot-checked `PanelService.update` + `PanelService.delete` + `PanelService.duplicate`:

- Service: calls `accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), ...)`
- Route (`PanelRoutes.scala`): no `aclDirective.authorizeResource…` calls — pure HTTP shell.

Spot-checked `DataSourceService.update/delete/refresh/preview`:

- Service: calls `accessChecker.requireOwnerOnly("data-source", ...)`
- Route (`DataSourceRoutes.scala`): no ACL calls.

Spot-checked `PermissionService.list/grant/revoke`:

- Service: `accessChecker.requireOwnerOnly("dashboard", ...)`
- Route (`PermissionRoutes.scala`): no ACL calls.

Spot-checked `PublicDashboardRoutes`:

- Still uses `aclDirective.authorizeResourceWithSharing` because the route needs to handle unauthenticated viewers; the service downstream (`PanelService.resolveBindingsForRead`) only resolves bindings, doesn't re-check ACL.

No double-checking observed.

### 7. CS2a fold-in closure verification — PASS

- `private def resolvePanels` in `PublicDashboardRoutes` is gone; replaced by `panelService.resolveBindingsForRead(panels, userOpt)`.
- `DashboardRoutes` constructor takes only `(dashboardService, user)` — the `@unused panelRepo`, `dataTypeRepo` constructor params are pruned. `ApiRoutes.scala` line 143 wires only the service.

### 8. Imports & Qualifiers — **FAIL** (2 inline FQNs in new service code)

CONTRIBUTING.md explicitly requires: "Always import at the top of the file; never inline a fully-qualified name when an `import` would do." The user has called this out as a repeat-offender area on the last two PRs. Two violations in newly-written service files:

1. **`backend/src/main/scala/com/helio/services/DataTypeService.scala:30`**
   ```scala
   def listRows(id: DataTypeId): Future[Either[ServiceError, Vector[spray.json.JsObject]]] =
   ```
   `JsObject` is not imported. Add `import spray.json.JsObject` (or merge into a `spray.json._` wildcard since `DataTypeService` is in `com.helio.services` which has a number of spray-touching siblings) and use the bare name.

2. **`backend/src/main/scala/com/helio/services/SourceConfigParsing.scala:28`**
   ```scala
   implicit val fieldOverrideVectorFormat: RootJsonFormat[Vector[com.helio.api.protocols.FieldOverridePayload]] =
     vectorFormat(fieldOverridePayloadFormat)
   ```
   `FieldOverridePayload` is not in the import list at the top of the file even though `RestApiConfigPayload, SqlSourceConfigPayload` already are. Add it to the existing `import com.helio.api.protocols.{...}` line.

These are CONTRIBUTING.md violations on new code. Per the user's explicit standing concern, these need to be fixed before merge.

### Other observations (non-blocking)

- `DataTypeService.scala:138` defines `ExpressionValidationResult` **outside** both the class and the companion object (the companion body at lines 132–136 contains only a doc-comment that reads as if intended to wrap the case class). Either move the case class inside the companion or delete the empty companion comment. Cosmetic.
- `PipelineService.classifyDbError` (line 190) and `PermissionService.grant`'s `recover` (line 46) both use `org.postgresql.util.PSQLException` inline. Per CONTRIBUTING.md, inline-FQN is acceptable for a single-use type inside a function/companion when widening the top-level import would cause coupling. Both sites are pattern-match in a recover/match — defensible. Same for `java.nio.charset.CharacterCodingException` in `DataSourceCsvSupport.scala`. Not flagging.
- `AccessCheckerImpl.requireOwnerOnly` does not handle the `ownerResolver` future-failure case (pre-CS2b returned 500 with a friendly `ErrorResponse("Internal server error")`). With CS2b, a DB error inside the resolver bubbles to `ServiceResponse.run`'s `onSuccess`, which Pekko renders as a default 500 (no `ErrorResponse` body). Vanishingly unlikely path; flagging as a minor edge-case wire-shape divergence rather than a blocker.
- The `Materializer` param on `DataSourceService` is `@annotation.unused` because `FileSystem.write` is byte-array based. Plausibly fine as a forward-looking placeholder; alternatively drop and re-add in the streaming-CSV refactor. Cosmetic.
- `ApiRoutes.scala` line 14 has a wide service wildcard-ish import:
  ```scala
  import com.helio.services.{AuthService, DashboardService, DataSourceService, DataTypeService, PanelService, PermissionService, PipelineService, SourceService}
  ```
  Borderline long; a `com.helio.services._` wildcard would be cleaner. Cosmetic.

---

## Phase 3 — UI / API Smoke — PASS (all 5 steps)

Backend started on `PORT=8081` with `CORS_ALLOWED_ORIGINS=http://localhost:5174`, `/health` returned 200. Frontend dev server was not required because the orchestrator-specified flows are all API-level — they exercise exactly the service-extraction surfaces under audit. Used `curl` to drive the smoke against the live backend.

| Step | Result | Evidence |
|---|---|---|
| 1. Login (matt@helio.dev / heliodev123) | PASS | 200, `AuthResponse{token=656923f9…, expiresAt=2026-06-12T07:55:24.78Z, user{id=9532cfcf…, email=matt@helio.dev, displayName=Matt}}` |
| 2a. List dashboards | PASS | 3 dashboards returned in `{items:[…]}` envelope |
| 2b. List dashboard panels | PASS | 4 panels for the Evaluation Dashboard; expected `id, title, type, typeId, fieldMapping` keys all present |
| 3. Panel PATCH title | PASS | `title="Trend Overview (CS2b smoke)"` round-tripped; reset to original cleanly |
| 4. Panel PATCH `typeId: null` (tri-state) | PASS | `typeId` cleared to `null`, `fieldMapping` left untouched — `Some(None)` semantics confirmed at runtime |
| 5. Snapshot export → import → cleanup | PASS | Export returned `{version: 1, panelCount: 4}`; import created new dashboard `8db86f8b…`, `panelCount: 4`; delete returned 204 |

Bonus error-path checks (also PASS):

- Bad password → 401 `{"message":"Invalid email or password"}` (timing-equalising dummy-hash call still happens on missing-email path per code review).
- Unknown email → 401 `{"message":"Invalid email or password"}` (same message — user enumeration not possible).
- Snapshot import with `version: 0` → 400 `{"message":"version must be >= 1, got 0"}`.
- Logout w/o auth header → 401 `{"message":"Authorization header required"}`.
- Logout w/ bogus token → 401 `{"message":"Invalid or expired token"}`.

All response shapes match pre-CS2b expectations.

---

## Gates (last 5 lines each)

### `cd backend && sbt test`

```
[info] Run completed in 30 seconds, 59 milliseconds.
[info] Total number of tests run: 511
[info] Suites: completed 28, aborted 0
[info] Tests: succeeded 511, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

### `npm run check:schemas`

```
> helio@1.0.0 check:schemas
> node scripts/check-schema-drift.mjs

schemas in sync with JsonProtocols (6 checked across 10 protocol files)
```

### `npm run check:openspec`

```
> helio@1.0.0 check:openspec
> node scripts/check-openspec-hygiene.mjs

openspec/ is clean
```

### `npm run lint`

```
> helio@1.0.0 lint
> eslint . --max-warnings=0
```

(zero output, exit 0 → clean)

### `npm run format:check`

```
> helio@1.0.0 format:check
> prettier . --check

Checking formatting...
All matched files use Prettier code style!
```

### `npm test` (frontend Jest)

```
> helio-frontend@0.0.0 test
> jest --config jest.config.cjs --passWithNoTests

Test Suites: 58 passed, 58 total
Tests:       664 passed, 664 total
Snapshots:   0 total
Time:        6.485 s
```

All gates green.

---

## Change requests

1. **`backend/src/main/scala/com/helio/services/DataTypeService.scala:30`** — replace `Vector[spray.json.JsObject]` with `Vector[JsObject]` and add `import spray.json.JsObject` at the top of the file (or use a `spray.json._` wildcard, matching the other service files in the package). This is a CONTRIBUTING.md `Imports & Qualifiers` violation on new code and a repeat-offender area the user has explicitly flagged on the past two PRs.

2. **`backend/src/main/scala/com/helio/services/SourceConfigParsing.scala:28`** — add `FieldOverridePayload` to the existing protocol import line at the top of the file:
   ```scala
   import com.helio.api.protocols.{FieldOverridePayload, RestApiConfigPayload, SqlSourceConfigPayload}
   ```
   and change the type ascription on line 28 to `RootJsonFormat[Vector[FieldOverridePayload]]`. Same CONTRIBUTING.md rule.

That's the entire blocker list. Everything else passes.

---

## Non-blocking suggestions

- `DataTypeService.scala:132–138` — the companion object is empty save for a stray doc-comment that talks about `ExpressionValidationResult`, while the case class itself sits outside the companion at line 138. Either move the case class inside the companion or delete the empty `object DataTypeService { /* … */ }` block.
- Consider factoring the pure spray-json formats out of `JsonProtocols` into a non-`SprayJsonSupport`-extending sibling trait so service-layer files that need spray formats don't transitively inherit Pekko marshaller types in scope. CS2c-sized refactor; flag it during the ADT remodel.
- `DataSourceService` (331) + `SourceService` (339) both sit a bit over the 300-line service budget. The executor's rationale (split fractures CSV-vs-Static and SQL-vs-REST dispatch; CS2c ADT remodel will discriminate naturally) is reasonable. Track as a CS2c follow-up rather than fixing now.
- `OAuthRoutes` is at 148 lines because `exchangeCodeForTokenImpl` + `fetchGoogleProfileImpl` are protected test-override hooks. Pulling them into a small injectable `GoogleProfileFetcher` trait would let the route drop to ~80 lines and let the service own the orchestration. Tractable CS2c follow-up — not urgent.
- `AccessCheckerImpl` doesn't translate `ownerResolver` future failures into a `ServiceError.InternalError("Internal server error")` the way the pre-CS2b `AclDirective` did (it now bubbles to Pekko's default 500 with no `ErrorResponse` body). Vanishingly unlikely path but the wire-shape divergence is real. One-line fix if desired.
- `ApiRoutes.scala:14` long explicit-import list for services — consider `com.helio.services._` wildcard.

---

## Blockers

None environmental. Two code-level blockers listed under "Change requests" — both single-line edits.
