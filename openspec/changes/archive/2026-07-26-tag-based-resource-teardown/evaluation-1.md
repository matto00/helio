## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Verified against ticket.md, proposal.md, design.md (4-round-confirmed), and tasks.md
(all 32 items marked done, cross-checked against code, not just trusted):

- All 7 ticket acceptance criteria addressed, none silently reinterpreted:
  - Tag on create + returned on reads + in MCP `get_workspace_context` — confirmed
    (`DataSourceProtocol`/`DataTypeProtocol`/`PipelineProtocol` responses,
    `helio-mcp/src/context.ts`).
  - Bulk teardown deletes exactly the tagged set, dependency-safe, per-kind counts —
    confirmed live via curl (see Phase 3) and `WorkspaceTeardownServiceSpec`.
  - Idempotent + owner-scoped/RLS-enforced — confirmed via 6.7/6.9/6.12 tests run
    under a real non-superuser `helio_app_test` role, and live curl repro.
  - List/filter by tag returns exactly the tagged set, owner-scoped — confirmed
    (`?tag=` on all three list endpoints, `ResourceTaggingSpec` 6.2).
  - Migration applies cleanly, existing rows unaffected — confirmed (`V73`,
    `ResourceTagMigrationSpec`, staged-Flyway `.target("72")` pattern).
  - ScalaTest coverage matches the ticket's list (persistence, filtered list, order +
    counts, idempotency, cross-owner isolation) — all present and passing.
  - MCP tools updated (`teardown_resources`, `tag` on create/read/context tools).
- tasks.md's two documented deviations (2.3(b)'s actual output-DataType insertion
  site is `PipelineRepository.create`, not `PipelineRunService`; 5.1's no-schema-
  exists-for-these-3-entities finding) are traced-and-confirmed-true against the
  actual code, not asserted — verified independently by reading `PipelineRunService.
  upsertFieldsFromRows` (only ever calls `findByIdInternal`/`updateInternal`, never
  `insert`) and the `DataSourceResponse` discriminated-union shape in
  `DataSourceProtocol.scala`.
- No scope creep: diffed file list is entirely tag/teardown/MCP/schema files; no
  trace of HEL-367 (auto-pack), HEL-368 (panel id key), HEL-369 (external-run
  hooks), or HEL-624 (pie/scatter aggregation) in the diff.
- No regression to existing single-resource delete/cascade behavior — untouched;
  `DataTypeService.checkSourceLink`/`existsBoundToAnyOwnedPanel`'s original call
  sites are behavior-preserved (existing wrapping in `withUserContext` unchanged,
  confirmed via `DataTypeRepository.scala:193-194`).
- API contracts: `schemas/workspace-teardown-{request,response}.schema.json` added
  and verified in sync with the Scala protocols via `npm run check:schemas`
  (27 protocol files checked, clean). The `tag` field addition to the three
  existing entities has no schema (none exists today for those entities — verified
  the drift-checker's actual behavior, not just trusted the deviation note).
- Planning artifacts (design.md, tasks.md) reflect the final implemented behavior;
  no artifact drift found between design's decisions and the code.

### Phase 2: Code Review — PASS
Issues: none blocking.

Danger-critical checks (the point of this review), each independently re-derived
from the raw code, not the executor's prose:

- **`IS DISTINCT FROM :tag` semantics, not a bare NULL check**, confirmed present
  verbatim in `WorkspaceTeardownRepository.scala` for all three required guards:
  `sourceDependentPipelineConflict` (line 107: `WHERE source_data_source_id = ...
  AND tag IS DISTINCT FROM $tag`), `outputTypeDependentPipelineConflict` (line 130),
  and `sourceLinkConflict` (line 156). All three correctly catch both "untagged
  dependent" and "dependent tagged into a different, live batch" — verified via a
  live curl repro is out of scope for a same-owner smoke test, but the differently-
  tagged-batch case is directly exercised by `WorkspaceTeardownServiceSpec` 6.4/6.5/
  6.6's second scenario in each ("...tagged into a DIFFERENT, live batch"), all
  passing.
- **Whole plan+delete runs through exactly one composed `DBIO`, executed via
  `withUserContext`, never `withSystemContext`**: confirmed — the entire
  for-comprehension (tagged-set SELECTs, all four guard-check `DBIO.sequence`
  calls, and the conditional DELETE `andThen` chain) is one `val action: DBIO[
  TeardownOutcome]`, wrapped once at the bottom in `ctx.withUserContext(user.id.
  value)(action.transactionally)` (line 93) — the only `ctx.*Context` call in the
  file. `existsBoundToAnyOwnedPanelAction` (the panel-bound guard) is a bare `DBIO`
  extracted from the existing `withUserContext`-wrapped call site with zero
  behavior change to that call site (`DataTypeRepository.scala:193-205`).
- **`dryRun` correctness / the reported 84003cc7 fix**: verified the fix is
  structurally correct — `sourcesDeleted`/`pipelinesDeleted`/`typesDeleted` are
  gated on `clean` (`conflicts.isEmpty`), not `committed` (lines 81-83), so a clean
  dry run reports the would-be counts while `committed` stays `false`;
  `deletedSources` (the file-cleanup input) is correctly still gated on `committed`
  alone (line 90), so a dry run never triggers file deletion. Live-repro'd end to
  end (see Phase 3) and covered by `WorkspaceTeardownServiceSpec` 6.8 (both the
  clean and blocked dry-run cases).
- **All-or-nothing**: the conflict list is computed from the tagged-set snapshot
  taken before any delete; the DELETE `andThen` chain only runs `if (clean &&
  !dryRun)`; a blocked call takes the `DBIO.successful(false)` branch entirely,
  issuing zero DELETE statements. Confirmed by 6.4/6.5/6.6's "nothing deleted, not
  even the unblocked resource" assertions and live-repro.
- **Post-commit file cleanup is best-effort and transaction-independent**:
  `WorkspaceTeardownService.cleanupFiles` runs strictly after `teardownRepo.
  teardown` resolves (the DB transaction has already committed or not — this is
  outside any DBIO), uses `.recover { case _ => () }` per file matching
  `DataSourceService.delete`'s existing posture, and is a provable no-op for
  blocked/dry-run calls since `outcome.deletedSources` is empty in both (gated on
  `committed`, per above).
- **6.9/6.12 genuinely prove owner isolation under real RLS, not a same-pool
  shortcut**: confirmed the test harness (`WorkspaceTeardownServiceSpec.
  beforeAll`) creates a real non-superuser `helio_app_test` Postgres role and
  routes the app pool through `SET ROLE helio_app_test`, mirroring
  `RlsOwnerTablesSpec`'s dual-pool pattern — not the simplified same-superuser-pool
  pattern most ACL specs use. 6.9 does direct DB assertions as user B
  (`sourceExists(bSrc.id, userB)`, etc.), not just trusting A's response. 6.12
  constructs a genuinely-impossible-via-real-create-path dangling cross-owner
  `sourceId` reference via the privileged pool specifically to prove the
  source-link guard's RLS-scoping hides it rather than leaking existence.
- **MCP surface / schema consistency**: `helio-mcp/src/tools/write.ts`,
  `helioApi.ts`, `read.ts`, `context.ts`, `types.ts` all updated and internally
  consistent with the backend wire contract; the deliberate `create_rest_data_
  source`/`create_sql_data_source` `tag` exclusion is correct — verified
  `CreateSourceRequest`/`SqlCreateSourceRequest` in `DataSourceProtocol.scala`
  genuinely lack a `tag` field.
- **Standards compliance**: no inline FQNs in any new/touched file (`grep` for
  `com.helio.` outside import blocks in the 4 new workspace-teardown files: zero
  hits); `npm run check:scala-quality` clean (file-size warnings only, all
  pre-existing large files plus the new 591-line
  `WorkspaceTeardownServiceSpec.scala` — informational per CONTRIBUTING.md, not a
  hard gate). Per-domain protocol formatter convention followed
  (`WorkspaceProtocol.scala` under `api/protocols`, mixed into the `JsonProtocols`
  aggregator, not added directly). Nullable-optional-dependency wiring pattern for
  `ApiRoutes`/`Main.scala` matches the established precedent
  (`alertRuleRepo`/`pipelineScheduleRepo`).
- DRY: the `existsBoundToAnyOwnedPanel` extraction is a genuine single-query,
  two-caller composition, not duplicated SQL. The source-link guard's
  reimplementation is a deliberate, explicitly-justified, narrowly-scoped
  duplication (documented in both call sites with cross-referencing comments,
  confirmed present in `DataTypeService.scala:143-149` and
  `WorkspaceTeardownRepository.scala:141-150`) — not accidental drift.
- Error handling: `WorkspaceTeardownService.teardown` validates `tag` presence and
  length before touching the repository; `ServiceResponse.run` maps
  `Either[ServiceError, TeardownResponse]` to the HTTP response uniformly with the
  rest of the codebase.
- Tests are meaningful: each guard has both a positive (blocks) and negative
  (doesn't block on same-batch) case; the 6.4/6.5/6.6 "differently-tagged, not
  just untagged" scenarios are exactly the shape of bug the design gate's round-2/
  round-3 catches were about, and they're exercised, not just asserted in prose.
- No dead code / no leftover TODOs found in the new files.

### Phase 3: UI Review — N/A (no frontend UI surface), with a direct-endpoint
verification substituted per the orchestrator's brief
Issues: none.

This ticket is backend + MCP only (confirmed: `git diff --stat` touches no
`frontend/**` files). Per the task brief, ran the live HTTP endpoint directly
instead of a browser walkthrough:

- Started dev servers via `scripts/concertino/start-servers.sh` /
  `assert-phase.sh servers` — both `PASS`.
- Logged in as the dev account, created a tagged static data source, then:
  1. `POST /api/workspace/teardown {tag, dryRun:true}` → `{"blocked":false,
     "committed":false,"conflicts":[],"dryRun":true,"pipelinesDeleted":0,
     "sourcesDeleted":1,"typesDeleted":1}` — reported would-be counts, nothing
     deleted (confirmed via a follow-up `GET ?tag=` still showing the resource).
  2. `POST /api/workspace/teardown {tag}` (real) → `{"committed":true,
     "sourcesDeleted":1,"typesDeleted":1,...}` — resource actually deleted.
  3. Repeat call → `{"committed":true,"sourcesDeleted":0,"pipelinesDeleted":0,
     "typesDeleted":0,...}` — idempotent, all-zero.
  4. `GET /api/data-sources?tag=...` post-teardown → empty list.
- No errors in `.concertino-backend.log` beyond pre-existing JVM/SLF4J startup
  warnings unrelated to this change.
- CSRF (`X-Helio-Requested-With: 1`) and session-cookie auth both worked exactly
  as documented elsewhere in the codebase — no surprises in the new route's auth
  wiring.

### Verification gate (fresh evidence, this run)
- `cd backend && sbt test` — **2134 tests, 0 failed** (includes the 30
  HEL-366-specific tests in `WorkspaceTeardownServiceSpec`/`ResourceTaggingSpec`/
  `ResourceTagMigrationSpec`, individually re-run first and confirmed passing).
- `npm test` (root + frontend) — **137 suites / 1423 tests, 0 failed**.
- `npm run lint` — clean (zero-warnings policy).
- `npm run format:check` — clean.
- `npm run check:schemas` — in sync (27 protocol files).
- `npm run check:scala-quality` — clean (informational file-size warnings only).
- `npm run check:openspec` — reports the change is complete-but-not-archived,
  which is expected at this workflow stage (archiving happens post-merge), not a
  code defect.
- `cd helio-mcp && npm run typecheck` — clean.
- Live `POST /api/workspace/teardown` exercised directly against the running dev
  backend (see Phase 3).

### Overall: PASS

### Non-blocking Suggestions
- `WorkspaceTeardownServiceSpec.scala` (591 lines) and `ResourceTaggingSpec.scala`
  (278 lines) both exceed the ~250-line soft budget — consistent with how most of
  this codebase's larger spec files already sit above budget, and CONTRIBUTING.md
  treats this as informational only; not a blocker, but a natural split
  (guard-scenarios vs. happy-path/idempotency/dry-run) would help future
  readability given how safety-critical this file is.
