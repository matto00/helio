## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spec deltas are faithful, full-block copies.** `diff openspec/specs/connector-spi/spec.md` vs the
  change delta, and same for `connector-registry`: every hunk is a name/path change only
  (`Connector[Config]`->`ConnectorDriver[Config]`, `SqlConnector`->`SqlConnectorDriver`,
  `RestApiConnector`->`RestApiConnectorDriver`, `/api/connectors`->`/api/connector-types`,
  `list_connectors`->`list_connector_types`), plus two additive "previously served at / previously
  named" sentences. No SHALL weakened, no scenario dropped, no behavior drift.
  `grep -c '^### Requirement'` = 6 in each source spec and 6 in each delta — every requirement block
  carried over in full, per the MODIFIED rule. Delta files correctly drop the `# ... Specification`
  header and `## Purpose`/`## Requirements` scaffolding in favor of `## MODIFIED Requirements`.
- **Capability dirs not renamed** (design Decision 4) — confirmed the deltas live under the same
  `specs/connector-spi/` and `specs/connector-registry/` paths.
- **`ConnectorRegistry`/`ConnectorMetadata`/`ConnectorFieldDescriptor`/`ConnectorRoutes`/
  `ConnectorProtocol` are correctly OUT of the trait-rename scope.** Read
  `ConnectorRoutes.scala:9` and `ConnectorRegistry.scala:4,19`: the route is a DB-free shell mapping
  `ConnectorRegistry.all` -> `ConnectorMetadataResponse`. These name the connector-*kind* metadata
  concept, distinct from the SPI trait. Design Decision 3 + tasks 1.4/5.3 handle this correctly.
- **Gate-chain checklist claim is TRUE.** `ls .husky/` = `_`, `pre-commit`. `grep -rniE 'connector'
  .husky/ scripts/` returns exactly one hit: a comment in `scripts/check-schema-drift.mjs:18`
  ("domain/ root into model/connectors/engine/util") which does not name any renamed symbol. No
  gate-chain script is touched. The "does not touch .husky/**" determination holds.
- **Endpoint/tool consumer set re-derived.** `grep -rn '/api/connectors'` and `grep -rn
  'list_connectors'` (excluding node_modules/target/this change dir) reproduce the ticket's list
  exactly: `ConnectorRegistry.scala`, `ConnectorProtocol.scala:14`, `ConnectorRoutes.scala:9`,
  `ConnectorRoutesSpec.scala:14`, `ApiRoutesSpec.scala:3164-3165`, `helioApi.ts:307`,
  `types.ts:444,453`, `tools/read.ts:197`, `scripts/verify.ts:64,71`, `connectorService.ts:3,21`,
  `SourceTypeToggle.tsx:8`, `SourceTypeToggle.test.tsx:81`, `AddSourceModal.test.tsx:18`.
  **This list is complete and accurate** — plus one match the artifacts do not name:
  `connectorService.ts:4` mentions `list_connectors` in prose. Also stale prose lives in the
  *built* `openspec/specs/connector-registry/spec.md:5` Purpose paragraph, which no MODIFIED-
  requirements delta can reach (see note 1).
- **Trait-rename surface re-derived — the artifacts materially undercount it.**
  `grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|\bConnector\[' --include=*.scala backend/src | wc -l`
  = **44** (26 of them under `backend/src/test`). The ticket asserts "`Connector` appears across 22
  backend files total"; `grep -rlw 'Connector' --include=*.scala backend/src | wc -l` = 19, so 22 is
  wrong under either reading. Re-ran both counts — stable. See CR 2.
- **Other openspec capabilities carry the old names.** `grep -nE ... openspec/specs/*/spec.md` finds
  stale-after-rename text in **five capabilities the plan declares out of scope**:
  `fetch-error-envelope` (10 hits incl. requirement + scenario titles),
  `schema-inference-facade` (9 hits), `connection-test-endpoint` (5 hits),
  `pipeline-run-execution:227`, `rest-api-connector:52`. See CR 1.
- **`TestConnectionAffordance.tsx:3`** does reference the Scala trait name
  (`// any source form with a Connector[Config]-backed connection to test`) — task 2.2's open
  question is answerable now.

### Verdict: REFUTE

### Change Requests

1. **The plan knowingly leaves five openspec capabilities naming a trait that will no longer exist —
   which is exactly the drift the ticket's own AC forbids.** design.md Non-Goals says "touched files
   here are limited to the two capabilities whose behavior-naming actually changes," but ticket.md AC
   4 says "`openspec/specs/` references updated for the renamed concept — do not add a second instance
   of that drift [HEL-804]." Ground truth: after this change, `openspec/specs/fetch-error-envelope/
   spec.md` (lines 4, 9, 16, 18-19, 32, 62, 74, 79, 86), `openspec/specs/schema-inference-facade/
   spec.md` (lines 4, 19, 22-23, 27-28, 57, 64, 69 — line 57 even names the file
   `domain/Connector.scala`), `openspec/specs/connection-test-endpoint/spec.md` (lines 10-11, 46, 51,
   65), `openspec/specs/pipeline-run-execution/spec.md:227`, and
   `openspec/specs/rest-api-connector/spec.md:52` all assert requirements about `Connector[Config]` /
   `SqlConnector` / `RestApiConnector` by name. Resolve this explicitly: either add MODIFIED deltas
   for those capabilities (name-only, same full-block-copy discipline already applied correctly to
   the two existing deltas) — with matching tasks — or state a concrete, defended carve-out in
   design.md that reconciles with AC 4 rather than silently contradicting it. Do not leave the
   contradiction unaddressed.

2. **Re-derive and correct the trait-rename enumeration; several real reference sites appear in no
   artifact.** ticket.md's "22 backend files" is wrong (actual: 44 Scala files, 26 of them tests), and
   proposal.md's Impact list plus tasks 1.4 / 2.1 omit reference sites that exist today:
   - **DI wiring, named in AC 2 but absent everywhere in proposal/tasks:**
     `backend/src/main/scala/com/helio/app/Main.scala:9,117` (`new RestApiConnector()`) and
     `backend/src/main/scala/com/helio/api/ApiRoutes.scala:28,75,256,273`.
   - **Compiler-invisible doc-comment references — the exact silent-drift class design.md's own Risks
     section flags:** `domain/engine/PipelineRowJson.scala:75-76,82,84`,
     `domain/engine/InProcessPipelineEngine.scala:22,24,26,37,132` (plus real code at 3, 29, 141),
     `ai/ClaudeWireModels.scala:128`, `ai/HttpClaudeTransport.scala`,
     `services/sources/ContentSourceSupport.scala`, `services/pipelines/PipelineService.scala`,
     `PipelineRunService.scala`, `PipelineProposalService.scala`.
   - **Tests:** task 2.1 names 6 spec files; 26 test files match. Missing include
     `ApiTokenAuthSpec.scala:11,154`, `AuditMutationInstrumentationSpec.scala`,
     `DataSourceRoutesSpec.scala` (10 hits), `PipelineAnalyzeProposalRoutesSpec.scala` (7),
     `InProcessPipelineEngineSpec.scala`, `ComputedFieldsRoutesSpec.scala`,
     `PipelineRunRoutesSpec.scala`, `UploadRoutesSpec.scala`, `ApiRoutesCorsErrorHandlingSpec.scala`,
     `MfaApiRoutesSpec.scala`, `DashboardPanelAclSpec.scala`, `DataTypeDataSourceAclSpec.scala`,
     `HookRoutesSpec.scala`, `PipelineApplyProposalSpecBase.scala`, `ApplyProposalSpecBase.scala`,
     `CombinedApplyProposalSpecBase.scala`, `PipelineRunServiceSpec.scala`,
     `SchemaInferenceRegressionSpec.scala`, `ConnectorRegistrySpec.scala`.
   Update ticket.md's count, proposal.md's Impact, and tasks 1.4/2.1 to reflect the re-derived set (a
   category-level enumeration is fine, but it must name the DI-wiring and doc-comment-only files,
   since those are the ones a compile-driven rename will not surface).

3. **Fix task 2.2 — misfiled and hedged on a question ground truth already answers.** It sits under
   "## 2. SPI trait rename (tests)" but edits a frontend component, and says "confirm whether this
   file actually references the Scala trait name." It does:
   `frontend/src/features/sources/ui/TestConnectionAffordance.tsx:3` reads
   `// any source form with a Connector[Config]-backed connection to test (SQL,`. Restate it as a
   definite task under a frontend heading with a real verification step (currently it has none — the
   only task in the file without one).

### Non-blocking notes

- The built `openspec/specs/connector-registry/spec.md:5` Purpose paragraph names `GET /api/connectors`
  and `list_connectors`, and `connector-spi/spec.md:4-6` names `Connector[Config]`/`SqlConnector`/
  `RestApiConnector`. A `## MODIFIED Requirements` delta cannot reach a Purpose block. Add an explicit
  task to update both Purpose paragraphs at spec-sync/archive time, or this rename ships with stale
  prose at the top of the two capabilities it is specifically about.
- `helioApi.ts`'s `listConnectors()` method and `connectorService.ts`'s `listConnectors` export keep
  the old name while the path/tool move. Defensible (they are client-internal), but it leaves
  `listConnectors` occupied for the entity client method HEL-826+ will want. Worth a one-line decision
  in design.md either way. Also `connectorService.ts:4` names `list_connectors` in prose — covered by
  task 3.4's repo-wide sweep, but not by the file lists.
- `ConnectorRoutes`/`ConnectorProtocol`/`ConnectorMetadataResponse` keep their names while serving
  `/api/connector-types`. Tasks 1.4/5.3 guard them from accidental rename (good), but design
  Decision 3 only justifies `ConnectorRegistry`/`ConnectorMetadata`/`ConnectorFieldDescriptor`.
  Extending Decision 3's sentence to cover the routes/protocol pair would close the gap.
- Environmental, non-blocking, FYI to the orchestrator: this worktree's `scripts/concertino/` predates
  the current tooling (no `next-report-number.sh`, `persist-evidence.sh`, or `emit-event.sh`). I ran
  those from the main checkout at `/home/matt/Development/helio/scripts/concertino/` instead.
