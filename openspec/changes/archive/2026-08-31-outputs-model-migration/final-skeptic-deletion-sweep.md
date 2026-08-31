## Skeptic Report — final gate (round 1, axis: deletion-sweep completeness)

HEAD verified: `dc95ccc4`. All commands run fresh in the worktree; no prior report's
conclusion was inherited.

### What I verified (with evidence)

**1. AC 6.1 grep, run verbatim.** 7,496 total hits across `backend/src`. Broken down per file,
7,174 are in `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` (the pre-migration
pg_dump fixture — legitimately pre-migration data, same category as `db/migration/**`), 46 in
`V94__outputs_model.sql`, and the rest in `V35`/`V41`/`V33`/`V46` migrations plus the migration
specs that assert on the pre-migration schema.

Filtering to real Scala **code** (non-comment, non-fixture) leaves exactly two families:
- `outputDataTypeId`/`outputDataTypeName` on `PipelineProposalProtocol.scala:117` and its call
  sites (`PipelineProposalService.scala:325,416,446`, `CombinedProposalService.scala:82,163,165,167`);
- `leftDataTypeId`/`rightDataTypeId`/`outputDataTypeId` on `WorkspaceContextProtocol.scala:56,58,126`
  and `WorkspaceContextService.scala:357,878,880,888`.

Both are covered by `design.md:317-350` ("two named wire-field-NAME exemptions from the 6.1 grep"),
a coordinator ruling recorded in the cycle-28→29 handoff. I re-derived the rationale rather than
accepting it: all are `String`-typed wire field **names**, no `DataTypeId`-typed value survives in
either path, and `grep -rln outputDataTypeId helio-mcp/src frontend/src` does return 30+
out-of-scope files. **This deferral is real and traceable — not a phantom.** Every other match is a
prose comment referencing a deleted class historically.

**2. Deletions are real, not merely unreferenced.** `find src -name "<Class>*.scala"` returns empty
for all of: `DataTypeRepository`, `DataTypeRowRepository`, `DataTypeService`, `MetricRepository`,
`MetricService`, `DataTypeProtocol`, `MetricProtocol`, `DataTypeRoutes`, `MetricRoutes`,
`BoundPanelService`. `api/protocols/metrics/`, `services/metrics/`, `api/routes/metrics/` no
longer exist as directories (evaluation-1's stale-README-only orphans are genuinely gone — those
three READMEs appear in `git diff --diff-filter=D`). `PanelServiceHelpers.withMaterializedMetric`
survives only as a historical comment at `PanelServiceHelpers.scala:189`. 54 files deleted in
`main...HEAD`, including all 9 specs for deleted classes I checked by name (`MetricRoutesSpec`,
`PanelMetricBindingRoutesSpec`, `MetricRepositorySpec`, `DataTypeRepositorySpec`,
`DataTypeServiceSpec`, `DataTypeRoutesSpec`, `BoundPanelRoutesSpec`, `DataTypeRowRepositorySpec`,
`PanelBindingSpecSpec`) — no orphaned dead-test-for-dead-code found.

**3. `GET /api/types/:id/panel-capabilities` is genuinely gone.** No route literal survives
anywhere in `src/main`; the only `panel-capabilities` occurrences are comments recording the
deletion plus the assistant tool's `panelCapabilities` JSON key (a different surface, rewired onto
`OutputRepository` — `AssistantToolExecutor.scala:169`). `PanelCapabilityService` is kept and
retargeted onto `OutputId` (`PanelCapabilityService.scala:27-29`); all four callers compile.

**4. No dangling wiring.** Every `dataTypeRepo`/`metricRepo`/`dataTypeService`/`BoundPanel*`
occurrence in `ApiRoutes.scala` and `Main.scala` is a comment. A whole-source grep for the deleted
symbols `BoundPanelService|BoundPanelRoutes|BoundPanelProtocol|PanelBindingSpec|MetricPanel|
ChartPanel|TablePanel|TimelinePanel|CollectionPanel|SourceSchemaHealthCheck` outside comments
returns exactly one hit, and it is a docstring in `OutputBindingSpec.scala:31`.

**5. `RlsPolicyGuardSpec`** has `"outputs" -> None` and `"node_snapshots" -> None` (lines 69-71)
and zero occurrences of `data_types`/`data_type_rows`/`metrics`.

**6. Compile + full test suite, run by me three times.**
- Run 1 (`compile Test/compile test`, `Test/parallelExecution := false`): **3 failures**, all in
  `V94OutputsMigrationSpec` — the markdown-bound panel absent from `panels`, and
  `stranded_output_panels_deleted` = 90 vs expected 88.
- Run 2 (`test`, same settings): 3342/3342 green.
- Run 3 (`clean test`): 3342/3342 green.
Per the reproduce-before-refuting rule I did not treat run 1 as a verdict. Diagnosis: the spec is
hermetic (`EmbeddedPostgres` per suite, fixture loaded from a classpath resource), so identical
input cannot legitimately produce two answers; run 1 was the only run against a pre-existing,
non-`clean` `target/` and its symptoms are precisely the pre-fix behaviour that commits `7b044b1c`
("fix markdown-binding data loss") and `971608e5` ("stranded-panel data loss") repaired — i.e.
stale compiled test classes/resources, not live code. **Not a blocking finding**, but recorded
below as a risk note because it is the one observation I could not fully close.

**7. Deferral spot-checks** (grepped the target, did not trust the citation) — 4 sampled:
- "`panels.kind SET NOT NULL` deferred to the increment that adds the write path" → **real**,
  `V94__outputs_model.sql:961-973` now performs it.
- "`binary_refs` RLS rewrite deferred to land with 2.9/2.10" → **real**,
  `V94__outputs_model.sql:1053-1057` drops and recreates `binary_refs_owner` pipeline-keyed and
  drops `data_type_id`.
- "DB-integration tests for `OutputRepository`/`NodeSnapshotRepository` deferred to 2.3/2.4" →
  **real**, covered by `V94OutputsMigrationSpec`'s RLS/snapshot groups.
- "narrowing `patch-set.schema.json`'s `EditTarget.kind` enum is section 3/4's consumer-rewire
  job" (`execution-progress.md:742-744`) → **NOT real.** See Change Request 2.

### Verdict: REFUTE

Two surviving artifacts of the deletion, both small and both cheap to fix, but both are exactly
the class of residue this axis exists to catch — one of them via the ticket's own demonstrated
phantom-deferral pattern.

### Change Requests

1. **Six package `README.md` manifests still list classes this ticket deleted, and omit their
   replacements.** The repo convention is that each package README enumerates its classes;
   `git diff --name-only main...HEAD -- '*README.md'` shows only the six `metrics`/`pipelines`
   READMEs were touched, so these were missed:
   - `backend/src/main/scala/com/helio/domain/panels/README.md:3-6` — lists `ChartPanel`,
     `CollectionPanel`, `MetricPanel`, `TablePanel`, `TimelinePanel`, `PanelBindingSpec`, all
     deleted; does not mention the actual contents `OutputPanel`/`OutputBindingSpec`.
   - `backend/src/main/scala/com/helio/api/protocols/pipelines/README.md:3,5` — "the DataType
     family's request/response protocol types" and `DataTypeProtocol` in the Holds list.
   - `backend/src/main/scala/com/helio/api/routes/pipelines/README.md:3,5` — "DataType HTTP
     routes" and `DataTypeRoutes` in the Holds list.
   - `backend/src/main/scala/com/helio/api/protocols/panels/README.md` — `BoundPanelProtocol`.
   - `backend/src/main/scala/com/helio/api/routes/panels/README.md` — `BoundPanelRoutes`.
   - `backend/src/main/scala/com/helio/services/panels/README.md` — `BoundPanelService`.

   Evidence: cross-checking every backticked class name in every `com/helio/**/README.md` against
   the filesystem returns these six (plus pre-existing, unrelated noise such as `RootJsonFormat`
   and `Directives`, which are library types and predate this branch). Update each manifest to the
   post-deletion contents.

2. **`schemas/patch-sets/patch-set.schema.json` still advertises the deleted `dataType` target
   kind.** Line 68's `"enum": ["panel", "dashboard", "dataSource", "dataType", "pipeline",
   "pipelineStep"]` (and the line-5 description's `panel/dashboard/dataSource/dataType/pipeline/
   pipelineStep`) still declare a kind that `PatchSetProtocol.scala:64` now removes outright and
   that V94's step (h) purged from every persisted journal row. `git diff main...HEAD --
   schemas/patch-sets/` is **empty** — the schema was never touched.

   This is a phantom deferral of the same shape the ticket has already been bitten by three times:
   `execution-progress.md:742-744` states "the app-level `recognizedKinds` enum and
   `patch-set.schema.json`'s `EditTarget.kind` enum are explicitly left untouched — narrowing
   those is section 3/4's consumer-rewire job, not this migration's." Section 3.3 then narrowed
   only the app-level enum: `grep -n "patch-set\|PatchSet" tasks.md` shows no task anywhere that
   owns the JSON schema file. Ticket scope item 9 explicitly says "the persisted enum loses those
   values." Net effect on `main`: the published wire contract offers a `target.kind` the backend
   hard-rejects. Remove `"dataType"` from the enum and from the description string (or, if it is
   genuinely P1.4/HEL-907's to own, write that deferral into `design.md` as a named exemption the
   way the two wire-field-name exemptions were, so it stops being an unowned dangler).

### Non-blocking notes

- The `V94OutputsMigrationSpec` failure in my first full run (item 6 above) did not reproduce
  across two subsequent runs including a `clean test`, and its symptoms match pre-fix compiled
  artifacts. I am satisfied it is not live-code non-determinism, but given this is a destructive,
  irreversible migration I'd want CI's clean-checkout run treated as the authoritative green, not
  a developer's incremental one.
- The two `design.md` wire-field-name exemptions leave `WorkspaceResourceType.DataType`, the
  `WorkspaceContextResponse.dataTypes` JSON key, and test helpers named `setDataTypeFields` in
  place. All are naming-only and correctly out of the AC 6.1 grep's reach, but P1.4/P1.5/P1.6
  should inherit an explicit list of them rather than rediscovering them.
