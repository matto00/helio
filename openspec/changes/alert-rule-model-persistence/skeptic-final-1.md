## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established (cold, not from prior reports):**
- Read `ticket.md`, `proposal.md`, `design.md`, `specs/alert-rule-persistence/spec.md`,
  `specs/alert-rule-crud-api/spec.md`, `tasks.md`, `files-modified.md`, `evaluation-1.md`,
  `skeptic-design-1.md` directly from disk.
- `git diff main...e772232c --stat` — 28 files changed, all within the ticket's declared scope
  (domain model, V60 migration, repository, service, protocol, routes, wiring, 3 new test specs,
  1 modified test spec, 3 JSON schemas, planning artifacts). No frontend files touched (confirmed
  `git diff main...e772232c --stat -- frontend/` is empty), matching the ticket's "no frontend
  impact" — so the UI/design-judgment section of this gate does not apply.
- Read every changed source file in full: `model.scala` (AlertRuleId/Severity/Comparator/AlertRule),
  `V60__alert_rules.sql`, `AlertRuleRepository.scala`, `AlertRuleService.scala`,
  `AlertRuleRoutes.scala`, `AlertRuleProtocol.scala`, `ServiceError.scala`,
  `ServiceResponse.scala`, `ApiRoutes.scala`/`Main.scala`/`IdParsing.scala` diffs, and all three new
  test specs (`AlertRuleRepositorySpec`, `AlertRuleServiceSpec`, `AlertRuleRoutesSpec`) plus the
  `RlsPolicyGuardSpec` diff.

**Acceptance criteria traced to evidence:**
1. *Rule shape round-trips create → fetch unchanged, absent-optional normalizes* — `AlertRuleService.create`
   (`services/AlertRuleService.scala:73`) defaults `enabled` to `true` when `req.enabled` is `None`;
   proven by `AlertRuleServiceSpec` ("normalize an absent `enabled` field to true") and
   `AlertRuleRoutesSpec` ("normalize an absent `enabled` field to true" — literally omits the JSON key,
   not just `None` in Scala). Condition round-trip with unknown keys (`window`, `future`/`futureKey`
   nested object/array) proven at repository level (`AlertRuleRepositorySpec` line 114-137), service
   level (`AlertRuleServiceSpec` line 131-151), and HTTP level (`AlertRuleRoutesSpec` line 136-156,
   POST + subsequent GET both assert `resp.condition shouldBe condition`).
2. *Owner-scoped CRUD, 403/404 on cross-user* — `AlertRuleService.findById/update/delete` all route
   through `alertRuleRepo.findByIdOwned` first and return `ServiceError.NotFound` (→ 404 via
   `ServiceResponse.completeError`, confirmed in `ServiceResponse.scala:61`) on a miss, matching the
   ACL-triad "existence not leaked" pattern. `AlertRuleRoutesSpec` exercises GET/PATCH/DELETE by a
   second user and asserts 404 (or 403) for all three, and that the resource is left unmutated.
3. *Non-existent/non-owned targetDataTypeId → 422/404* — `AlertRuleService.create` calls
   `dataTypeRepo.findByIdOwned` (owner-scoped, not `*Internal`) and maps `None` → `UnprocessableEntity`
   (422). Both the non-existent and cross-owner cases are covered in `AlertRuleServiceSpec` (lines
   165-185) and `AlertRuleRoutesSpec` (lines 158-169) and both correctly return 422.
4. *condition persists as jsonb, unknown/extra keys survive* — `V60__alert_rules.sql` declares
   `condition JSONB NOT NULL`; `AlertRuleRepository` maps it as an opaque `String` (`jsonbStringType`,
   identity mapping) parsed/printed via `JsValue.parseJson`/`.compactPrint` at the domain boundary —
   the repository never destructures the blob. Verified round-trip (see #1).
5. *ScalaTest coverage + `sbt test` green* — see verification below.

**Gates re-run myself, fresh (not trusted from prior reports):**
```
$ cd backend && sbt -batch "testOnly com.helio.infrastructure.AlertRuleRepositorySpec \
    com.helio.services.AlertRuleServiceSpec com.helio.api.routes.AlertRuleRoutesSpec \
    com.helio.infrastructure.RlsPolicyGuardSpec"
  → Tests: succeeded 86, failed 0, canceled 0

$ cd backend && sbt -batch test
  → Total number of tests run: 1533
  → Tests: succeeded 1533, failed 0, canceled 0
  (matches the executor's/evaluator's claimed 1533/1533 exactly)

$ npm run lint          → clean (eslint --max-warnings=0)
$ npm run format:check  → All matched files use Prettier code style!
$ npm run check:schemas → schemas in sync with JsonProtocols (13 checked across 19 protocol files)
$ npm run check:scala-quality → clean (49 pre-existing soft file-size warnings only; none block)
$ npm test              → root: no tests, pass-with-no-tests; frontend: 115 suites / 1198 tests passed
```
All numbers match the executor's and evaluator's claims exactly — no discrepancy, no need to
re-run a second time.

**RLS owner-scoping — DB-level and service-level, independently checked:**
- `V60__alert_rules.sql`: `ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY` +
  `FORCE ROW LEVEL SECURITY` + `alert_rules_owner` policy on
  `owner_id = current_setting('app.current_user_id')::uuid` — byte-for-byte the same shape as the
  V35 direct-owner tables I compared it against (`pipelines`, `data_types`). `RlsPolicyGuardSpec` now
  asserts `alert_rules` has `relrowsecurity`/`relforcerowsecurity` = true and at least one policy
  (ran this spec myself, passed).
- `DbContext.withUserContext`/`withSystemContext` (pre-existing infra, unmodified by this change) —
  read in full: the app pool has no BYPASSRLS, the privileged pool does; `AlertRuleRepository` uses
  `withUserContext` for every owner-scoped method and `withSystemContext` only for
  `listEnabledByDataTypeInternal`, with the required inline justification comment.
- Service-level: every mutation (`findById`/`update`/`delete`) does an explicit `findByIdOwned` check
  *before* touching the repository's mutating methods — this is what actually protects
  `delete`/`update`, since those two repository methods do not additionally filter by `ownerId` in
  their SQL and rely on RLS alone. Confirmed this is not new/looser than existing sibling repos: grep
  of `DataTypeRepository`/`DataSourceRepository` shows the identical shape (delete/update filtered
  only by `id`, ownership enforced by RLS + upstream service check).

**condition jsonb round-trip incl. unknown/extra keys** — verified above (#1/#4); also independently
confirmed the JSON Schema (`schemas/create-alert-rule-request.schema.json`) does NOT set
`additionalProperties: false` inside the nested `condition` object (only at the top level), so the
schema itself doesn't contradict the "unknown keys survive" contract.

**Create-with-bad-targetDataTypeId 422 behavior** — verified above (#3). Both the non-existent-id and
non-owned-id cases are indistinguishable at the API surface (both 422), consistent with the ACL
triad's existence-not-leaked convention and with the ticket's "422/404" (either) framing.

**`listEnabledByDataTypeInternal` privileged-bypass justification** — read the inline comment at the
repository method and the migration comment; both explain HEL-455 as the future caller and that no
caller exists yet in this ticket. This mirrors `DataTypeRepository.findByIdInternal`'s pre-caller
landing pattern (grepped and confirmed that pattern exists and predates this change). Not a new
precedent being invented; a documented, established one being extended.

**`git commit -n` bypass** — reproduced: `npm run check:openspec` reports the change "complete (25/25)
but not archived", which is exactly the described, expected two-phase (execute-then-archive)
workflow artifact, not a masked defect. No other gate was bypassed (confirmed lint/format/schemas/
scala-quality/tests are all clean when run directly, not via the commit hook).

**Root-caused test removal (cross-owner repository-level delete assertion)** — verified the stated
root cause is real: `AlertRuleRepositorySpec`'s `DbContext` is built directly from
`embeddedPostgres.getPostgresDatabase` for *both* the app and privileged pool arguments (line 39:
`new DbContext(db, db)`), i.e. both pools use the embedded-Postgres default `postgres` superuser,
which unconditionally bypasses RLS including `FORCE ROW LEVEL SECURITY`. Confirmed the claimed
precedent holds: grepped `DataTypeRepositorySpec`/`DataSourceRepositorySpec` and neither one asserts
a cross-owner `delete()` no-op at the repository layer either (both specs' `delete` tests only cover
"deletes and returns true" / "returns false for unknown id" — the same two cases `AlertRuleRepositorySpec`
keeps). The real ownership guarantee for delete is covered end-to-end: `AlertRuleServiceSpec`
("reject delete on a rule owned by a different user") and `AlertRuleRoutesSpec` ("return 403 or 404 for
a cross-user caller and leave the rule in place") both pass and both exercise the actual
`AlertRuleService.delete` guard path that production traffic uses. This is a legitimate,
well-documented test-layer adjustment, not a coverage gap for the real guarantee.

**Scope / planning-artifact fidelity** — `design.md`'s decisions (table shape, RLS mirror, jsonb
representation, severity/comparator enum shape, cascade-delete self-approval, ownership-check
pattern) are all implemented exactly as specified. `tasks.md`'s 25/25 checked items all correspond to
real code (spot-checked each section against the diff). No scope creep — every changed file is
directly required by the ticket.

### Verdict: CONFIRM

### Non-blocking notes

- Same two items the evaluator already flagged and I independently agree are non-blocking:
  - `domain/model.scala` crossed CONTRIBUTING.md's ~400-line soft-budget threshold (382→458) without
    a split callout in the commit description. Purely informational per the quality script; worth a
    callout next time this file is touched (e.g., if HEL-455/HEL-466 add more alert-domain types,
    consider splitting into `domain/alerts.scala`).
  - `AlertRuleRepositorySpec`'s "listEnabledByDataTypeInternal bypasses per-owner RLS and returns
    rules across owners" test seeds both sample rules under the same owner, so it doesn't literally
    exercise the "different owners" phrasing from the spec scenario name, even though the
    `withSystemContext` bypass mechanism itself is correct by inspection and proven elsewhere. Worth
    tightening before HEL-455 starts relying on this method in production, not blocking now.
  - The `scripts/concertino/start-servers.sh` `nohup`+env-prefix regression the evaluator called out
    is unrelated to this ticket's diff (pre-existing on `main`) and doesn't affect this verdict.
