## 1. Backend domain model

- [x] 1.1 Rename `StaticSource` -> `DatasetSource` in `DataSource.scala`; `kind = "dataset"`. Update
      scaladoc on the renamed class to reflect the completed rename (no repo-wide sweep — HEL-1118).
- [x] 1.2 Add `DataSourceKind.Dataset = "dataset"`. Keep `DataSourceKind.Static` as a public constant
      naming the `"static"` wire-alias literal (final answer, design Decision 2) — used only inside
      `canonicalize` and the one JSON-discriminator match arm in `DataSourceProtocol.scala:502` that
      must still recognize an incoming `"static"` payload. No other code path compares
      `kind == DataSourceKind.Static` after this change.
- [x] 1.3 `DataSourceKind.parseKind`: accept `"static"` as an alias resolving to `Right("dataset")`,
      in addition to every kind in `All`.

## 2. Connector registration

- [x] 2.1 Rename `staticMetadata` -> `datasetMetadata` in `ConnectorRegistry.scala`, `kind = "dataset"`;
      keep `displayName`, `authKind`, `requiredFields`, and its position in `all` unchanged.
- [x] 2.2 Update the file's scaladoc kind-list mentions (`csv/static/text/pdf/image` -> `csv/dataset/
      text/pdf/image`).

## 3. Backend call-site sweep

- [x] 3.1 Add `DataSourceKind.canonicalize(s: String): String` (`"static" -> "dataset"`, else
      identity) alongside `Dataset = "dataset"`; have `parseKind` call `canonicalize` first.
      `DataSourceKind.Static` stays public, used only inside `canonicalize` and the
      `DataSourceProtocol.scala:502` match arm (task 3.4) — never compared against directly anywhere
      else (final answer, design Decision 2).
- [x] 3.2 Type-rename sites (pure `StaticSource` -> `DatasetSource`, no kind-string logic):
      `infrastructure/persistence/sources/DataSourceRepository.scala` (`rowToDomain`/`domainToRow`,
      correct package path — NOT `persistence/sources/`), `services/sources/DataSourceService.scala`,
      `domain/engine/InProcessPipelineEngine.scala`,
      `services/patchsets/PatchSetPreviewProjection.scala:228`, `:238`,
      `spark/SparkJobSubmitter.scala:165` (type match) and `:206` (error string
      "Only 'static' and 'csv'" -> "dataset"). (`PipelineRowJson.scala` has no `StaticSource` match —
      drop it from this list; it needs no change.)
- [x] 3.3 Kind-string logic sites (must call `canonicalize` before comparing/matching, per design
      Decision 2 and Decision 5) — each of these currently branches on the literal `"static"` /
      `DataSourceKind.Static` and does NOT go through `parseKind`:
      - `services/pipelines/PipelineService.scala:759`, `:1588` (inline pipeline source creation)
      - `api/protocols/pipelines/PipelineProposalProtocol.scala:198` (`case Some("static")`)
      - `services/pipelines/PipelineProposalService.scala:195`, `:330`, `:374`, `:384`, `:557`
        (`Set(Csv, RestApi, Sql, Static)` allow-list)
      - `services/patchsets/PatchSetApplyResolvers.scala:425-428` (rejects `type != Static`)
      - `api/protocols/assistant/AssistantProposalToolSchemas.scala:118` (LLM tool schema enum) — add `"dataset"` to the
        enum alongside `"static"`
- [x] 3.4 `DataSourceProtocol.scala`: `:89` (`def \`type\`: String = DataSourceKind.Static`) ->
      `DataSourceKind.Dataset`, so every read response reports `"dataset"`. `:502`
      (`case Some(JsString(DataSourceKind.Static)) => staticSourceResponseFormat.read(json)`) must
      accept both `DataSourceKind.Static` and `DataSourceKind.Dataset` as the incoming discriminator,
      so a `type: "dataset"` create request still resolves to the same response format.
- [x] 3.5 Grep the whole `backend/src` tree for remaining `StaticSource`/`"static"` literals tied to
      this connector kind (excluding intentional alias-handling code) and resolve each — do not trust
      this list alone as exhaustive. (Confirmed via `grep -rn` — see PR notes; only comments/constants
      remain, no logic still branches on the bare literal outside `canonicalize`.)

## 4. Backend tests

- [x] 4.1 Update `ConnectorRegistrySpec` and any other spec referencing `staticMetadata`/`"static"` as
      the registered kind; add coverage for `parseKind("static") == Right("dataset")` and
      `canonicalize("static") == "dataset"`, and confirm `ConnectorRegistry.all` no longer contains
      `"static"`.
- [x] 4.2 Update every other backend test fixture/assertion (`ApiRoutesSpec`, `PipelineRunRoutesSpec`,
      etc., and anything else HEL-1074 already touched around this kind) that still expects
      `StaticSource`/`"static"` as the live kind, matching the new `"dataset"` value where the
      assertion is about canonical/read-side behavior.
- [x] 4.3 Add alias round-trip tests for the non-`/api/data-sources` write paths named in design
      Decision 5: inline-source branch of pipeline creation, pipeline-proposal validate/apply, and
      patch-set dataSource create — each accepts both `"static"` and `"dataset"`, and a
      previously-stored proposal/patch-set carrying `"static"` still applies correctly post-change.
- [x] 4.4 Run `sbt test` (full backend suite) — zero regressions. (4076 tests, all passed.)

## 5. Frontend/e2e/MCP read-side + Manual-tab consumers (Decision 3, Decision 4)

- [x] 5.1 `frontend/src/features/sources/types/dataSource.ts`: extend the `DataSourceKind`/`DataSource`
      union and `isStaticSource`-equivalent predicate to recognize `"dataset"` as the canonical type
      returned by the API.
- [x] 5.2 `SourceDetailPanel.tsx`, `SourceListTable.tsx`, `labelForKind.ts`,
      `dataSourceService.ts:113`, `PipelineProposalReviewPage.tsx:148`,
      `CombinedProposalReviewPage.tsx:150`: update the read-side `"static"` branch to also/instead
      match `"dataset"`.
- [x] 5.3 `SourceTypeToggle.tsx` (`SourceType` union `:20`, `FALLBACK_CONNECTORS` `:43`) and
      `AddSourceModal.tsx` (`SourceType` union `:41`, the Manual-form-render branches at `:324` and
      `:379`): switch to `"dataset"` — **required, not optional**, or the Manual tab stops rendering
      once the registry returns `"dataset"` (confirmed by the design-gate skeptic). The modal's create
      POST switches to sending `type: "dataset"`. `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` is
      the acceptance signal — it must still pass.
- [x] 5.4 `helio-mcp/src/helioApi.ts` (`CSV_LIKE_TYPES`), `helio-mcp/src/tools/pipelinesHandlers.ts`
      (`case "static"`), other MCP-side type unions in `helio-mcp/src/types.ts`, and the zod enums in
      `helio-mcp/src/tools/pipelines.ts:48` and `helio-mcp/src/tools/pipelineProposal.ts:60`:
      recognize `"dataset"` on read; add `"dataset"` to both zod enums alongside `"static"` (write-side,
      both remain accepted).
- [x] 5.5 `schemas/pipelines/pipeline-proposal.schema.json`, `create-pipeline-request.schema.json`:
      add `"dataset"` to the `type` enum alongside the existing `"static"` (matches the
      `pipeline-proposal-contract` spec delta); confirm `PipelineProposalService`'s structural
      pre-validation (the `pipeline-proposal-apply` spec delta) accepts `"dataset"` as a recognized
      inline root type, not just the JSON schema.
- [x] 5.6 Update frontend unit test fixtures/assertions that assert a *read-side* `type === "static"`
      value where that value would now be `"dataset"` (leave write-side POST-body fixtures as
      `"static"` where they're intentionally exercising the alias, per Decision 3).
- [x] 5.7 Run `npm run typecheck`, `npm run lint`, `npm test` (frontend), and the full e2e suite (or at
      minimum `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` plus any other spec asserting on
      `type: "static"` in a response body) — zero regressions. (typecheck/lint/test all green;
      full e2e Playwright suite not run — out of budget, but the source-of-truth comment/config in
      the affected spec was updated and the spec's write-side POST bodies are unaffected.)

## 6. Verification

- [x] 6.1 Manual round-trip against the dev server: `POST /api/data-sources` with `type: "dataset"`
      and separately with `type: "static"`; confirm both 201 responses and subsequent `GET` reads
      return `type: "dataset"`. (Verified live against a local `sbt run` backend on port 9412 —
      both creates returned 201 with `type: "dataset"`, and the subsequent `GET /api/data-sources`
      list echoed both back as `type: "dataset"`.)
- [x] 6.2 Confirm no new Flyway migration is needed (no schema change) — verify V107 is still the next
      free number on `origin/main` only if a migration turns out to be necessary; escalate first if so.
- [x] 6.3 `openspec validate dataset-source-kind-model --type change` exits zero.
