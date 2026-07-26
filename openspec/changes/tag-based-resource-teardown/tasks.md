## 1. Backend — Data model

- [x] 1.1 Re-confirm max Flyway V-number (latest at write time: V72) and add
      `V73__add_resource_tag.sql`: nullable `tag TEXT` (`CHECK (length(tag) <= 200)`) on
      `data_sources`, `pipelines`, `data_types`; partial index `(owner_id, tag) WHERE tag IS NOT NULL`
      on each. Re-confirm the V-number again immediately before `git push` (branch contention).
- [x] 1.2 Add `tag: Option[String]` to the `DataSource`, `Pipeline`(summary/domain), and `DataType`
      domain case classes; thread through repository row mappers (Slick `column[Option[String]]("tag")`).

## 2. Backend — Create/read paths

- [x] 2.1 Add optional `tag` to `StaticDataSourceRequest`/CSV/text/pdf/image create request
      protocols and `DataSourceService` create paths (persist as-is; no validation beyond length,
      already enforced by the DB CHECK — surface a `400` via `RequestValidation` if over 200 chars
      before hitting the DB).
- [x] 2.2 Add optional `tag` to `CreatePipelineRequest` and `PipelineService.create`.
- [x] 2.3 Add optional `tag` to `DataType` creation paths that originate at `DataSourceService`
      create (the companion DataType) and at pipeline-run output-type creation. Two propagation
      rules, both required for design.md Decision 6's guards to ever pass on the common case:
      (a) at every `DataSourceService` companion-DataType construction site (`createStatic`,
      `createCsv`, `createTextUpload`/`createTextUrl`, `createPdfUpload`/`createPdfUrl`,
      `createImageUpload`/`createImageUrl`, and `upsertSourceDataType`'s refresh path), the
      companion DataType's `tag` MUST be set to the same value as its owning DataSource's `tag` —
      DONE, all 7 sites set `tag = source.tag`/the create-path's own tag.
      (b) **Deviation from design.md's stated file location, confirmed by tracing the actual code**:
      design.md/tasks.md state the output `DataType` row is inserted in `PipelineRunService`.
      Traced and confirmed FALSE — `PipelineRunService.upsertFieldsFromRows` only calls
      `findByIdInternal` + `updateInternal` (never `insert`) to sync `fields` after a run. The
      output DataType's ONLY insertion site is `PipelineRepository.create` (called from
      `PipelineService.create`), which is where propagation is implemented: the pipeline's `tag`
      (threaded from `CreatePipelineRequest.tag`) is passed to both the new `PipelineRow.tag` and
      the new output `DataType.tag` in the same call. This is the sole place that can satisfy the
      "output DataType's tag mirrors its producing Pipeline's tag" invariant, since no other code
      path ever creates a fresh output-DataType row.
- [x] 2.4 Return `tag` on `DataSource`, `Pipeline` (summary), and `DataType` response protocols.
- [x] 2.5 Add optional `tag` query parameter to `GET /api/data-sources`, `GET /api/pipelines`,
      `GET /api/types` (owner-scoped exact match on the repo's existing `findAll`).

## 3. Backend — Bulk teardown

- [x] 3.1 Extract `DataTypeRepository.existsBoundToAnyOwnedPanel`'s underlying query into a bare
      `DBIO[Boolean]`-returning method (e.g. `existsBoundToAnyOwnedPanelAction`); update the
      existing call site to wrap it in `withUserContext` exactly as today (no behavior change).
      This is app-pool logic already — see design.md Decision 6.
- [x] 3.2 In `WorkspaceTeardownRepository`, implement the source-link guard as its own narrow,
      app-pool, `withUserContext`-scoped query against `data_sources` for a tagged DataType's
      `sourceId`: blocks ONLY when a DataSource with that id exists AND its `tag` is NOT the same
      tag being torn down (`WHERE id = :sourceId AND tag IS DISTINCT FROM :tag`) — a source tagged
      into the SAME teardown batch is not a blocker, since it's being deleted in the same call
      (design.md Decision 6, round-2 fix; mirrors Decision 2's "untagged dependent" scoping). Do
      NOT call `DataTypeService.checkSourceLink` (it uses the privileged pool via
      `findByIdInternal`; not composable into this transaction — design.md Decision 3/6, AND its
      bare-existence semantics would wrongly block the common tagged-source+tagged-companion case).
      Added cross-referencing code comments in both `DataTypeService.checkSourceLink` and this new
      check per Decision 6.
- [x] 3.3 In `WorkspaceTeardownRepository`, implement Decision 2's two dependent-cascade guards as
      their own narrow, app-pool, `withUserContext`-scoped queries, each using the SAME
      `IS DISTINCT FROM :tag` predicate shape as 3.2 (not a bare `tag IS NULL` check — that would
      miss a dependent tagged into a *different, live* batch and let it be silently
      cascade-deleted, per design.md Decision 2's round-3 fix):
      - DataSource→Pipeline: for each tagged DataSource, block if a Pipeline exists with
        `source_data_source_id = <that source's id>` AND `pipelines.tag IS DISTINCT FROM :tag`.
      - Output DataType→Pipeline: for each tagged output DataType, block if the Pipeline with
        `output_data_type_id = <that type's id>` exists AND `pipelines.tag IS DISTINCT FROM :tag`.
- [x] 3.4 Add `WorkspaceTeardownRepository` with a single DBIO composition (SELECT tagged
      sources/pipelines/types + the dependent-cascade checks from 3.1/3.2/3.3, immediately followed
      by DELETE actions for pipelines → types → sources when clean and not `dryRun`), wrapped in
      `.transactionally` under `withUserContext(user.id.value)` (mirror
      `DashboardContentsOps.replaceContents`). **Every action in this composition must run via
      `withUserContext` — never `withSystemContext`** (design.md Decision 3 hard constraint).
- [x] 3.5 Add post-commit best-effort file cleanup: after 3.4's transaction commits, for each
      torn-down file-backed DataSource (CSV/Text/PDF/Image), call `fileSystem.delete(path)` with
      the same `.recover { case _ => () }` best-effort posture `DataSourceService.delete` already
      uses (design.md Decision 3). A file-delete failure must not fail the already-committed
      teardown.
- [x] 3.6 Add `WorkspaceTeardownService.teardown(tag, dryRun, user)` — thin wrapper producing the
      `{ tag, dryRun, committed, blocked, conflicts, sourcesDeleted, pipelinesDeleted, typesDeleted }`
      response shape from design.md Decision 4. Normalize `dryRun` (absent-vs-null-vs-false all
      mean "not a dry run") per design.md Decision 8.
- [x] 3.7 Add `WorkspaceRoutes` (`POST /api/workspace/teardown`) and wire into `ApiRoutes.scala`.
      Added request/response protocols to `WorkspaceProtocol.scala` (mixed into `JsonProtocols`).
      Never inline fully-qualified names.
      **Implementation note**: `WorkspaceTeardownRepository` needs a raw `DbContext` (not a
      pre-built repository) since its whole plan+delete composition must run through
      `ctx.withUserContext` as ONE transaction — no existing repository exposed its `ctx`. Added a
      nullable `dbContext: DbContext = null` param to `ApiRoutes` (mirrors the established
      nullable-optional-repo wiring pattern already used for `alertRuleRepo`/`alertEventRepo`/
      `pipelineScheduleRepo`), wired from `Main.scala`'s existing `ctx`.

## 4. MCP surface

- [x] 4.1 Accept `tag` on `create_data_source`, `create_pipeline`, and any type-producing create
      tools in `helio-mcp/src/tools/write.ts` + `helio-mcp/src/helioApi.ts`. Also added to
      `create_csv_data_source` and `create_pipeline_from_shape` (both type-producing create paths).
      **Deviation, confirmed by tracing the backend**: `create_rest_data_source`/
      `create_sql_data_source` (`POST /api/sources`) do NOT get a `tag` param — traced
      `SqlCreateSourceRequest`/`CreateSourceRequest` in `DataSourceProtocol.scala` and confirmed
      task 2.1's already-committed backend scope deliberately excludes these two request types (only
      `StaticDataSourceRequest`/CSV/text/pdf/image gained `tag`); adding a wire param the backend
      silently ignores would be misleading.
- [x] 4.2 Add `teardown_resources` tool (`POST /api/workspace/teardown`) in `write.ts` +
      `helioApi.ts`; tool description documents the refuse-on-untagged-dependent and dry-run
      semantics, and recommends calling with `dryRun: true` first.
- [x] 4.3 Expose `tag` in `helio-mcp/src/tools/read.ts` list/get tools and in
      `helio-mcp/src/context.ts`'s `WorkspaceContext` (dataSources/dataTypes/pipelines entries).
      Also added an optional `tag` filter param to `list_data_sources`/`list_data_types`/
      `list_pipelines` (thin pass-through to the already-shipped `?tag=` backend filter, task 2.5) —
      a natural preview surface for `teardown_resources`, not just field exposure.

## 5. Schema / OpenAPI docs

- [x] 5.1 **Deviation, confirmed by inspecting `schemas/` + `scripts/check-schema-drift.mjs`**: no
      `schemas/*.schema.json` file exists today for DataSource/Pipeline-summary/DataType create or
      response shapes — this repo only formalizes a JSON Schema for select complex/agent-facing
      endpoints (proposal, panel binding, pipeline schedule, bound-panel, etc.), not for every
      entity's CRUD shape. The drift checker enforces an exact 1:1 `schema.title` ↔ Scala case-class
      field-set match; `DataSourceResponse` is a 7-variant discriminated union (Csv/Rest/Sql/Static/
      Text/Pdf/Image), so there is no single case class a `DataSourceResponse` schema could name.
      Inventing net-new schemas for these three entities' full existing shapes (not just `tag`) is a
      substantial, unrelated-to-`tag` undertaking, so left undone here — the `tag` field is fully
      documented instead via the wire-format-accurate `resource-tagging` capability spec (already
      present at `specs/resource-tagging/spec.md` from the design-gate) and via `git diff`-verifiable
      Scala protocol case classes. Flagged as a spinoff candidate (new schemas for these three
      entities, tag-agnostic) rather than done as an unscoped side effect of this ticket.
- [x] 5.2 Added `schemas/workspace-teardown-request.schema.json` (title `TeardownRequest`) and
      `schemas/workspace-teardown-response.schema.json` (title `TeardownResponse`, with an embedded
      `TeardownConflict` `$def`) for the new `POST /api/workspace/teardown` endpoint — both verified
      against `npm run check:schemas` (JSON Schema ↔ Scala protocol parity). The `?tag=` query-param
      addition on the three list endpoints is documented in the `resource-tagging` capability spec's
      "Resources can be listed filtered by tag" requirement (already present from the design gate) —
      query params aren't part of the JSON-Schema-per-body-shape convention this repo's `schemas/`
      directory follows, so no separate schema entry applies there.

## 6. Tests (ScalaTest — backend)

- [x] 6.1 Tag persists through create → read for data source, pipeline, DataType; omitted tag stays
      `null` and behaves unchanged. `ResourceTaggingSpec` "6.1 persists create -> read" (data
      source, pipeline, and the source→companion-DataType tag propagation, plus the
      omitted-tag-stays-null case).
- [x] 6.2 `?tag=` filtering on the three list endpoints returns exactly the tagged set, owner-scoped.
      `ResourceTaggingSpec` "6.2 list filtering" (all three endpoints; the DataType case is also
      the owner-scoping assertion — another owner's same-tagged DataType is excluded).
- [x] 6.3 Teardown happy path: mixed tagged/untagged resources, teardown deletes only the tagged
      set, correct per-kind counts, all-or-nothing verified (no partial deletes on a blocked case).
      `WorkspaceTeardownServiceSpec` "6.3 happy path".
- [x] 6.4 Teardown refuse-on-out-of-batch-dependent: tagged data source with an UNTAGGED dependent
      pipeline blocks the whole call; tagging the dependent into the same batch and retrying
      succeeds. **Also**: tagged data source with a dependent pipeline tagged into a *different,
      live* batch (`U`, not null) blocks the whole call, and that `U`-tagged pipeline is left
      completely untouched by the blocked call (design.md Decision 2 round-3 fix — the
      differently-tagged case, not just the untagged/null case).
      `WorkspaceTeardownServiceSpec` "6.4 DataSource -> Pipeline dependent guard" (both cases).
      **Bug found and fixed while writing 6.8** (see below) — unrelated to this task's own guard
      logic, which was already correct.
- [x] 6.5 Teardown refuse-on-out-of-batch-dependent: tagged output DataType with an UNTAGGED
      producing pipeline blocks the whole call. **Also**: tagged output DataType with a producing
      pipeline tagged into a *different, live* batch blocks the whole call (same round-3 fix as
      6.4, applied to the output-DataType→Pipeline direction).
      `WorkspaceTeardownServiceSpec` "6.5 output DataType -> Pipeline dependent guard" (both cases).
- [x] 6.6 Teardown DataType guards: panel-bound tagged DataType blocks (conflict reason matches
      `DELETE /api/types/:id`'s existing panel-bound Conflict); still-linked source-companion
      tagged DataType blocks ONLY when its linked DataSource is NOT tagged into the same teardown
      batch (untagged or differently-tagged source blocks; source tagged into the SAME batch does
      NOT block — design.md Decision 6 round-2 fix).
      `WorkspaceTeardownServiceSpec` "6.6 DataType guards" (panel-bound + untagged-source +
      differently-tagged-source, three separate scenarios).
- [x] 6.6a **Positive path (the ticket's primary use case — currently untested before this task):**
      a DataSource tagged `T` and its auto-inferred companion DataType also tagged `T` are BOTH
      deleted by a single `teardown {tag: "T"}` call — the source-link guard does not block when
      source and companion share the teardown tag.
      `WorkspaceTeardownServiceSpec` "6.6a positive path".
- [x] 6.7 Teardown idempotency: second call with the same tag after success returns all-zero counts.
      `WorkspaceTeardownServiceSpec` "6.7 idempotency".
- [x] 6.8 Teardown dry-run: clean set reports would-be counts without deleting; blocked set reports
      the same conflicts a real call would, without deleting.
      `WorkspaceTeardownServiceSpec` "6.8 dry run". **Found and fixed a real bug while writing this
      test**: `WorkspaceTeardownRepository.teardown` gated `sourcesDeleted`/`pipelinesDeleted`/
      `typesDeleted` on `committed` — but `committed` is unconditionally `false` for EVERY dry run
      (by construction, `dryRun` short-circuits it), so a dry run on a totally clean set was
      reporting all-zero counts instead of the would-be counts, directly contradicting design.md
      Decision 4 ("counts mean would-be/were affected either way") and this task's own literal
      wording. Fixed by gating the three count fields on `conflicts.isEmpty` ("clean") instead of
      `committed` — `committed` and the file-cleanup-input `deletedSources` field correctly stay
      gated on `committed` (a dry run must never trigger file deletion). All 15 tests in this spec
      (6.3–6.9, 6.12) pass with this fix; re-verified none of the other already-passing scenarios
      regressed.
- [x] 6.9 **Cross-owner isolation (required by ticket):** user A's teardown call never discovers,
      counts, reports, or deletes user B's same-tagged resources; verify via direct DB assertion
      that B's rows still exist after A's call, not just via A's response shape.
      `WorkspaceTeardownServiceSpec` "6.9 cross-owner isolation" (both the "B has resources, A's call
      doesn't touch them" and "A owns nothing tagged, B does" cases). Run under a REAL, non-
      superuser `helio_app_test` RLS role (mirrors `RlsOwnerTablesSpec`'s dual-pool harness) —
      deliberately NOT the simpler same-superuser-pool pattern most ACL specs in this repo use,
      because `WorkspaceTeardownRepository`'s dependent-cascade and source-link guard queries carry
      no explicit `owner_id` predicate; their cross-owner safety is 100% RLS-derived, so a
      superuser-bypasses-RLS harness would make this test (and 6.12) pass for the wrong reason.
- [x] 6.10 Migration test: V73 applies cleanly to a DB with pre-existing untagged rows; those rows
      remain fully functional (read/update/delete/analyze/run) after migration.
      `ResourceTagMigrationSpec` (staged Flyway `.target("72")` then full `migrate()`, mirroring
      `TriggerSourceMigrationSpec`'s established pattern): pre-existing rows across all three
      tables get `tag = NULL`, the `length(tag) <= 200` CHECK constraint is live post-migration
      (accepts a normal value, rejects 201 chars), and read/update/delete all still work through
      the repository layer. Scope note in the spec's doc comment: analyze/run aren't re-tested
      here (already exhaustively covered elsewhere; the additive nullable `tag` column has no
      code path touching either).
- [x] 6.11 Wire-format: create/teardown requests with `tag`/`dryRun` fields entirely absent from
      the JSON payload (not `null`) behave identically to explicit `null`/`false` (design.md
      Decision 8 spray-json Option gotcha). `ResourceTaggingSpec` "6.11 wire-format absent-vs-
      null/false": a hand-written raw JSON body with the `tag` key entirely absent vs. one with
      `tag: null` create identically-untagged sources; a raw teardown request JSON with `dryRun`
      entirely absent is proven to behave as `dryRun: false` by actually deleting the tagged
      resource (not just asserting a flag), ruling out a silent no-op.
- [x] 6.12 Teardown never touches the privileged pool: a DataType whose `sourceId` points at a
      DataSource that (by construction, for the test) is NOT owned by the caller is treated as
      "no linked source" by the app-pool existence check (proves the check is RLS-scoped, not
      privileged — design.md Decision 3/6), rather than leaking cross-owner existence info.
      `WorkspaceTeardownServiceSpec` "6.12 privileged-pool non-leak": constructs the dangling
      cross-owner `sourceId` reference directly via the privileged pool (no real create path can
      produce it), then asserts user A's teardown call is NOT blocked (RLS hides user B's source
      from the guard query entirely under `withUserContext(A)`, so it reads as "no linked source"),
      the dangling DataType is deleted, and B's source is untouched. Same real-RLS harness as 6.9.
