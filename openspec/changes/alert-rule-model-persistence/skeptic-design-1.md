## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Flyway version claim**: `ls backend/src/main/resources/db/migration/` shows the latest is
  `V59__panel_caption_annotation.sql` — confirms design.md/tasks.md's "V60" claim is currently
  accurate.
- **Domain model timestamp pattern**: design.md/tasks.md specify flat `createdAt`/`updatedAt:
  Instant` fields on `AlertRule` (not the `ticket.md`-suggested `ResourceMeta` wrapper). Read
  `domain/model.scala:290-344` — `DataType` and `Pipeline` (the two models the proposal explicitly
  says this mirrors) both use flat `createdAt`/`updatedAt` fields, not `ResourceMeta` (that wrapper
  is used only by `Dashboard`/`Panel`). The design's deviation from the ticket's literal text is
  correct — it follows the actual pattern of the models it claims to mirror.
- **RLS direct-owner pattern**: read `V35__enable_rls_owner_tables.sql` in full — confirms the
  `pipelines_owner`/`data_sources_owner`/`data_types_owner` policies are exactly the
  `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + single `USING (owner_id =
  current_setting('app.current_user_id')::uuid)` shape the design specifies for `alert_rules_owner`.
- **Privileged-bypass pattern**: read `V34__create_privileged_role.sql` and grepped
  `DbContext.scala`/`DataSourceRepository.scala`/`PipelineStepRepository.scala` —
  `withSystemContext` + `findByIdInternal`/`listByPipelineInternal` exist exactly as described;
  `listEnabledByDataTypeInternal` is a faithful extension of this precedent.
- **jsonb Slick handling**: grepped `infrastructure/` for `jsonb`/`JsValue` and read
  `DataSourceRepository.scala:186-198` — confirms an established, simple precedent
  (`MappedColumnType.base[String, String](s => s, s => s)` with a doc comment explaining the PG
  JDBC driver accepts `setString`/`getString` identity for jsonb columns, no `::jsonb` cast
  needed). The design's task 3.2 ("grep for existing jsonb Slick handling and reuse it") correctly
  anticipates this and the risk mitigation in design.md is appropriately hedged (not a blocking
  ambiguity — it's an implementation-time lookup with a real, simple answer already in the repo).
- **Service/`Either[ServiceError,_]` pattern + ownership-check pattern**: read
  `services/DataTypeService.scala` in full — confirms the `Either[ServiceError, _]` return shape
  and the `findByIdOwned`/`findByIdInternal` split the design mirrors. Read
  `services/ServiceError.scala` — `NotFound`/`Forbidden`/`UnprocessableEntity` all already exist,
  supporting the 404/403/422 mappings the spec requires.
- **409-guard precedent for cascade-delete decision**: read `DataTypeService.scala:116-149` —
  confirms the existing "block delete if panels are bound" 409 guard the design explicitly chose
  *not* to replicate for alert rules (self-approved `ON DELETE CASCADE`). This is a reasoned,
  scoped decision consistent with the ticket's silence on a block-delete requirement.
- **Routes/API composition pattern**: found the actual file at `api/routes/DataTypeRoutes.scala`
  (not `api/DataTypeRoutes.scala` as proposal.md's Impact section implies) and its composition
  into `ApiRoutes.scala:220-221`. Minor path imprecision in the proposal, but the intent ("thin
  shell composed into `ApiRoutes.scala` next to `DataTypeRoutes`") is unambiguous and trivially
  resolved by the executor.
- **Capability naming convention**: `ls openspec/specs/` confirms `datatype-crud-api` and
  `data-type-persistence` exist as the templates the proposal cites; `alert-rule-crud-api`/
  `alert-rule-persistence` follow the same naming convention.
- **RLS test infrastructure exists**: found `RlsOwnerTablesSpec.scala`, `RlsPrivilegedDmlSpec.scala`
  in `backend/src/test/scala/com/helio/infrastructure/` — task 7.1's RLS-scoping test plan is
  executable against real, already-established test infra, not a hypothetical.
- **Traced every ticket AC to a task**: round-trip shape (tasks 4.3/4.4, 7.2/7.3, spec scenarios),
  owner-scoped CRUD via RLS + service (tasks 2.3/3.1/4.2, spec `alert-rule-persistence` +
  `alert-rule-crud-api`), non-existent/non-owned target rejection (task 4.2, spec scenarios),
  jsonb round-trip with unknown keys (task 3.2, spec scenario "condition persists arbitrary
  jsonb"), full ScalaTest coverage (tasks 7.1-7.4). No AC is left uncovered by a task.
- **Spec/proposal/tasks internal consistency**: cross-read `proposal.md`, `design.md`, `tasks.md`,
  both `spec.md` files — no contradictions found. `design.md`'s Decisions section resolves every
  ambiguity the ticket left open (migration version, jsonb representation, cascade-delete,
  comparator location) with explicit, scoped rationale, and tasks.md's "confirm at implementation
  time" notes are all genuinely implementation-time lookups (file location conventions, exact
  jsonb pattern to reuse) rather than deferred design decisions that would block a competent
  implementer.

### Minor imprecisions noted (non-blocking)

- design.md's ownership-check decision text says `dataTypeRepo.findById(targetDataTypeId)`; the
  actual method on `DataTypeRepository` is `findByIdOwned(id, user)`. The intent (owner-scoped,
  not `*Internal`) is unambiguous, and this is a one-line naming correction the executor will make
  trivially when writing the call — does not block implementation.
- proposal.md's Impact section implies `api/DataTypeRoutes.scala`; actual path is
  `api/routes/DataTypeRoutes.scala`. Same non-blocking category.

### Verdict: CONFIRM

### Non-blocking notes

- Consider having design.md explicitly note (for the benefit of HEL-455/HEL-466, which build on
  this table) that `PATCH /api/alert-rules/:id` intentionally excludes `targetDataTypeId` from the
  updatable field set — this is implied by the spec's field list but never stated as a deliberate
  decision. Not required for this ticket to proceed; flagging only so a future reader doesn't
  mistake the omission for an oversight.
