# Files modified — HEL-1073 (dataset-source-kind-model)

Compiled from `git status --short` (72 changed paths) at the end of delivery. All gates below
were run fresh after this final state was reached.

## Backend — domain model / connector registration / call-site sweep (Decision 1, 2, 4)

- `backend/src/main/scala/com/helio/domain/model/DataSource.scala` — `StaticSource` renamed to
  `DatasetSource` (`kind = "dataset"`); added `DataSourceKind.Dataset`, kept `DataSourceKind.Static`
  as the wire-alias literal, added `DataSourceKind.canonicalize`; `parseKind` canonicalizes first.
- `backend/src/main/scala/com/helio/domain/connectors/ConnectorRegistry.scala` — `staticMetadata`
  renamed to `datasetMetadata`, `kind = "dataset"`; scaladoc kind-list updated.
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — `StaticSource` ->
  `DatasetSource` (pure type rename).
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — `StaticSource` -> `DatasetSource`;
  error string "Only 'static' and 'csv'" -> "Only 'dataset' and 'csv'".
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjection.scala` —
  `StaticSource` -> `DatasetSource`.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `StaticSource` ->
  `DatasetSource`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` —
  `StaticSource` -> `DatasetSource`; `rowToDomain`/`domainToRow` comments updated for the completed
  rename; `domainToRow` writes `DataSourceKind.Dataset` instead of a bare `"dataset"` literal.
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` —
  `StaticSourceResponse.type` now `DataSourceKind.Dataset`; the `dataSourceResponseFormat.read`
  discriminator match accepts `DataSourceKind.Static | DataSourceKind.Dataset`; the response-mapping
  `case s: DatasetSource` updated; doc comments updated.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — both inline-source
  kind-string sites (`resolveInlineRootSourceId`, `resolveInlineSourceSchema`) canonicalize before
  matching; `DataSourceKind.Static` case arms replaced with `DataSourceKind.Dataset`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocol.scala` — the
  `type`-keyed config-branch match in `read` canonicalizes first; `"static"` case replaced by
  `"dataset"`; added `DataSourceKind` import.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala` —
  `validateSourceSelector`/`resolveSource` canonicalize before matching; `InlineSourceKinds` set and
  the `resolveStaticSource`/`ResolvedSource.kind` construction sites use `DataSourceKind.Dataset`.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` —
  `resolveDataSourceCreate`'s type check canonicalizes `request.\`type\`` before comparing against
  `DataSourceKind.Dataset`.
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` —
  the LLM tool-schema `type` enum gains `"dataset"` alongside `"static"`.

## Backend — tests

- `backend/src/test/scala/com/helio/domain/connectors/ConnectorRegistrySpec.scala` —
  `expectedKinds` updated to `"dataset"`; added `canonicalize`/`parseKind("static")` alias coverage
  and a "no longer registers 'static'" assertion.
- `backend/src/test/scala/com/helio/domain/model/DataSourceSpec.scala` — `DatasetSource carries kind`
  test and the exhaustive-pattern-match `describe` helper both updated from `"static"` to `"dataset"`;
  `parseKind` round-trip line switched from the stale `parseKind("static") shouldBe Right("static")`
  (wrong post-rename) to `parseKind("dataset") shouldBe Right("dataset")`.
- `backend/src/test/scala/com/helio/api/protocols/sources/DataSourceProtocolSpec.scala` — the
  `StaticSourceResponse` round-trip test now asserts `type: "dataset"` on write; added a new test
  confirming an incoming `type: "static"` payload still deserializes correctly (HEL-1073 write-side
  alias).
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — the
  `POST /api/data-sources (static)` "return 201..." test's response-type assertion updated to
  `"dataset"` (the create request body itself stays `"static"`, exercising the write-side alias).
- `backend/src/test/scala/com/helio/api/routes/sources/ConnectorRoutesSpec.scala` — the 7-kind set
  assertion updated to `"dataset"`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpec.scala` — the
  existing inline-static-proposal test's response-type assertion updated to `"dataset"`; added a new
  sibling test exercising the SAME apply path with the canonical `type: "dataset"` inline root
  (HEL-1073 design.md Decision 5, alias round-trip test #2).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRootRoutesSpec.scala` — added a new
  sibling test to the existing inline-`"static"`-root test, exercising the same `add_root` path with
  the canonical `type: "dataset"` (HEL-1073 design.md Decision 5, alias round-trip test #1).
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — added three
  new tests for `dataSource`/`create` patch-set edits: accepts `type: "dataset"`, accepts the legacy
  `type: "static"` alias (both resolve to a stored `kind = "dataset"` row), and rejects an unrelated
  type (HEL-1073 design.md Decision 5, alias round-trip test #3).
- Every other backend test file matching `StaticSource\b` was mechanically renamed to `DatasetSource`
  via `sed` (pure type rename, preserved e.g. `StaticSourceResponse` untouched via word-boundary
  match) — confirmed by a clean `sbt compile`/`Test/compile` and the full green `sbt test` run below.
  Every remaining bare `"static"` string literal across the whole `backend/src/test` tree was
  grep-swept and individually triaged: write-side request-body/fixture occurrences (exercising the
  wire alias deliberately) were left unchanged; every read-side occurrence (an assertion on a
  *response*'s `type`/`kind` field) was updated to `"dataset"` — the four line items above are the
  complete set of read-side fixes found by that sweep.

## Frontend

- `frontend/src/features/sources/types/dataSource.ts` — `DataSourceKind` union, `StaticSource` ->
  `DatasetSource` interface, `DataSource` union member, `isStaticSource` predicate, and
  `StaticSourcePayload.type` all switched to `"dataset"`.
- `frontend/src/features/sources/services/dataSourceService.ts` — `createStaticSource` now POSTs
  `type: "dataset"`.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — `labelForKind`/preview-branch switch
  from `"static"` to `"dataset"`.
- `frontend/src/features/sources/utils/labelForKind.ts` — same switch (shared util).
- `frontend/src/features/sources/ui/SourceListTable.tsx` — `locationFor`'s `"static"` case ->
  `"dataset"`; doc comment updated.
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` — `SourceType` union and
  `FALLBACK_CONNECTORS` entry switched to `"dataset"`.
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — `SourceType` union, the configure-footer
  guard, and the Manual-tab render branch switched to `"dataset"` (Decision 4 — required, not
  cosmetic).
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx` — dev-only demo
  fixture's inline root `type` switched to `"dataset"`; doc comments updated.
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx` — same dev-only demo fixture
  switch; doc comment updated.

## Frontend — tests

- `frontend/src/features/sources/ui/SourceListTable.test.tsx` — fixture `type: "static"` -> `"dataset"`.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — mocked connector-types entry `kind`
  and the static-source create-response fixture switched to `"dataset"`.
- `frontend/src/features/sources/ui/SourceTypeToggle.test.tsx` — mocked registry entry `kind` switched
  to `"dataset"`.
- `frontend/src/features/sources/state/sourcesSlice.test.ts` — two read-side response fixtures
  (`type: "static"`) switched to `"dataset"`.
- `frontend/src/shared/chrome/SidebarBody.test.tsx` — a `DataSource` fixture's `type: "static"`
  switched to `"dataset"` (read-side).
- `frontend/src/app/App.test.tsx` — four `DataSource` fixtures' `type: "static"` switched to
  `"dataset"` (read-side; found via the exhaustive `grep -rn '"static"' src/` sweep).
- The remaining `"static"` occurrences found by the sweep (`combinedProposalsSlice.test.ts`,
  `CombinedProposalReviewPage.test.tsx`, `pipelinesSlice.test.ts`, `unresolvedConnectorRefs.test.ts`,
  `ProposalHandoff.test.tsx`, `CombinedProposalReview.test.tsx`) are all write-side
  `PipelineProposalSource.roots[].type` fixtures (a loose `string` field, not compared against a
  literal anywhere) — deliberately left unchanged, exercising the write-side alias per Decision 3.

## MCP (helio-mcp)

- `helio-mcp/src/helioApi.ts` — `CSV_LIKE_TYPES` now includes `"dataset"` alongside `"static"`.
- `helio-mcp/src/tools/pipelinesHandlers.ts` — `CreatePipelineSourceInput.type` union and the
  `resolveSource` switch both accept `"dataset"` (falls through the same branch as `"static"`); the
  default-case error message's supported-types list updated to `"dataset"`.
- `helio-mcp/src/types.ts` — `CreatePipelineRootRequest.type` and `PipelineProposalSource.type` unions
  both gain `"dataset"` alongside `"static"`.
- `helio-mcp/src/tools/pipelines.ts` — `createPipelineSourceSchema`'s zod enum gains `"dataset"`.
- `helio-mcp/src/tools/pipelineProposal.ts` — `pipelineProposalSourceSchema`'s zod enum gains
  `"dataset"`.

## Schemas

- `schemas/pipelines/pipeline-proposal.schema.json` — `PipelineProposalSource.type` enum gains
  `"dataset"`.
- `schemas/pipelines/create-pipeline-request.schema.json` — `roots[].type` enum gains `"dataset"`.

## e2e

- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` — updated a stale comment referencing
  `kind: "static"` to `kind: "dataset"` (with an HEL-1073 note); the spec's actual write-side POST
  body (`type: "static"`) is unchanged, deliberately exercising the wire alias.

## openspec

- `openspec/changes/dataset-source-kind-model/tasks.md` — all 24 tasks (sections 1–6) checked off
  complete, with brief evidence notes on 4.4/5.7/6.1–6.3.

---

## Verification gates — all run fresh, in the foreground, after the /tmp inode-exhaustion blocker
## from the prior cycle was cleared

| Gate | Command | Result |
| --- | --- | --- |
| Backend compile | `sbt compile` | clean (no errors) |
| Backend test compile | `sbt Test/compile` | clean (no errors) |
| Backend full suite | `sbt test` | **4076 tests, 0 failed, `All tests passed.`** |
| Frontend typecheck | `npm run typecheck` | clean (no output = no errors) |
| Frontend lint | `npm run lint` (zero-warnings) | clean (no output = no errors) |
| Frontend unit tests | `npm test -- --ci` | **301 suites / 3197 tests, all passed** |
| openspec validate | `openspec validate dataset-source-kind-model --type change` | `Change 'dataset-source-kind-model' is valid`, exit 0 |
| Manual round-trip (task 6.1) | live `sbt run` on port 9412 | `POST /api/data-sources` with `type: "dataset"` → 201, `type: "dataset"` in response; `POST` with `type: "static"` → 201, response resolves to `type: "dataset"`; subsequent `GET /api/data-sources` list echoes both rows back as `type: "dataset"` |

Full e2e Playwright suite was **not** run (out of this session's remaining budget) — the one spec
named by design.md as the acceptance signal (`e2e/hel910-pipeline-to-dashboard-flow.spec.ts`) had
only a stale comment touched, not its actual assertions/POST bodies, so no behavior change is
expected there; flagging this explicitly for the evaluator to run if a stronger signal is wanted.

No Flyway migration was needed or added (task 6.2) — this ticket is pure Scala/TS/schema rename plus
one wire-parsing alias, matching design.md's stated Non-Goals.

**Root cause / probe / fix for the one red result hit during this cycle** (systematic-debugging law):
- **Root cause:** the new `DataSourceProtocolSpec` alias-deserialization test (added this cycle)
  constructed a raw `JsObject` missing the `inferredSchema` field; `StaticSourceResponse`'s
  spray-json `jsonFormat6` reader treats it as required (only `Option` fields are implicitly
  optional on read), so the read failed the reader's own `fromField` lookup, at the JSON-decode
  layer.
- **Probe:** `sbt -no-colors "testOnly com.helio.api.protocols.sources.DataSourceProtocolSpec"`
  reproduced the failure with `spray.json.DeserializationException: Object is missing required
  member 'inferredSchema'`, pointing exactly at the reader in `DataSourceProtocol.scala:502`.
  Reading the case class definition confirmed `inferredSchema: Vector[InferredFieldResponse]`
  is not `Option`-typed, so a Vector-default does not exempt it from spray-json's required-field
  check on read.
  <br>- **Fix:** added `"inferredSchema" -> JsArray()` to the test's raw JSON object (the same
  empty-vector shape a real absent-schema response encodes as). Re-ran the same targeted test —
  green — then reran the full suite, which was clean.
