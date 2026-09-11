## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Core decision (Decision 1: rename `StaticSource` -> `DatasetSource`, one ADT member, `kind = "dataset"`) is sound.** HEL-1074 Decision 6 (archive design.md) explicitly left the ADT member and wire `type` to this ticket; `DataSourceRepository.scala:64` already maps stored `"dataset"` onto `StaticSource`, and `:96` writes `"dataset"`. A second sibling member would be unreachable. Ticket context asked for this choice to be justified; it is. CONFIRMED.
- **Decision 2's central premise is false.** The design says alias resolution in `DataSourceKind.parseKind` means "every caller — API route validation, MCP tool handlers, `DataSourceProtocol`'s JSON reader — gets the canonical value for free". `grep -rn parseKind backend/src/main/scala` shows `DataSourceKind.parseKind` is called in exactly two places: `services/sources/ConnectorCompletionService.scala:51` and `services/sources/ConnectorEntityService.scala:75`. None of the write paths that accept `type: "static"` go through it:
  - `POST /api/data-sources`: `DataSourceRoutes.scala:122-167` has an if/else chain, and anything that is not csv/text/pdf/image falls through to `StaticDataSourceRequest`. `type` is never validated, so `"dataset"` is already accepted there today. No `parseKind` call.
  - Inline pipeline source creation: `PipelineService.scala:759` and `:1588` match on the literal `DataSourceKind.Static`.
  - Pipeline proposals: `PipelineProposalProtocol.scala:198` has `case Some("static")`. `PipelineProposalService.scala:195`, `:330` and `:557` use the `Set(Csv, RestApi, Sql, Static)` allow-list, and `:374` and `:384` also reference it.
  - Patch-set dataSource create: `PatchSetApplyResolvers.scala:425-428` rejects anything where `type != DataSourceKind.Static`.
  - LLM tool schema: `AssistantProposalToolSchemas.scala:118` has the enum `["csv","rest_api","sql","static"]`.

  If `DataSourceKind.Static` is removed or re-pointed to `"dataset"`, `"static"` will break on these paths. If it stays `"static"`, the `"dataset"` value the design adds to the pipeline schemas (Decision 3) gets rejected at `PipelineService:759`, `PipelineProposalProtocol:198`, `PipelineProposalService:557` and `PatchSetApplyResolvers:425`. Either way the AC "static still round-trips and resolves to dataset" and the schema change are unimplementable as the design describes them.
- **The proposal's and task 3.2's backend file list is wrong.** It lists `DataSourceService`, `InProcessPipelineEngine`, `PipelineRowJson` and `SparkJobSubmitter`. These are type-only rename sites: `PipelineRowJson` has no `StaticSource` match at all, and `SparkJobSubmitter:165` is a type match. The list leaves out every file above that has kind-string logic. The repository path given is also wrong: it is `infrastructure/persistence/sources/DataSourceRepository.scala`, not `persistence/sources/...`.
- **Decision 4's claim that "the frontend renders off the registry's `kind` generically" is false and needs no verification to disprove.** `SourceTypeToggle.tsx` passes the registry's `kind` through `onChange`. `AddSourceModal.tsx:41` types it as `"static"`, and `AddSourceModal.tsx:324` and `:379` branch on `sourceType === "static"` to render the Manual form. Once the registry returns `"dataset"`, clicking "Manual" will not render the manual-entry form. `e2e/hel910-pipeline-to-dashboard-flow.spec.ts:109` drives exactly this flow. `SourceTypeToggle.tsx:43` `FALLBACK_CONNECTORS` also still says `kind: "static"`. Task 5.3's wording ("confirm create-time UX is unaffected") plans the opposite of what is needed.
- **The consumer inventory in Decision 3 / task 5 is incomplete.** `grep -rln "'static'\|\"static\"" frontend/src helio-mcp/src` also finds:
  - `frontend/src/features/sources/services/dataSourceService.ts:113`
  - `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx:148`
  - `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx:150`
  - `helio-mcp/src/tools/pipelines.ts:48`, a zod enum `["rest_api","sql","static"]`
  - `helio-mcp/src/tools/pipelineProposal.ts:60`, a zod enum `["csv","rest_api","sql","static"]`

  These are write-side, but the zod enums would reject `"dataset"` after the JSON schemas gain it, which is contract drift between `schemas/` and MCP.
- **A spec delta is missing.** `openspec/specs/frontend-data-sources-page/spec.md:113-116` requires a badge for sources "whose discriminator `type` is `"static"`". That requirement becomes false on read once responses return `"dataset"`, and the change has no delta for `frontend-data-sources-page`. `pipeline-proposal-analyze-api/spec.md:58` (inline root `type: "static"`) needs at least a check for whether `"dataset"` is now also accepted there.
- **The spec deltas for `connector-registry` and `static-data-connector` are internally consistent with the ticket's ACs.** The drift test pins a literal set that contains `dataset` and not `static`. OK.
- **No migration needed:** agreed. HEL-1074 already moved storage (V106), and nothing here changes the schema.

### Verdict: REFUTE

### Change Requests

1. **Rewrite Decision 2 to match the real code.** `parseKind` is not on any write path. Name the actual normalization point or points, for example a single `DataSourceKind.canonicalize(s: String): String` (or have `parseKind` do it), and list every entry point that must call it so both `"static"` and `"dataset"` are accepted and turned into `"dataset"`:
   - `DataSourceRoutes.createStaticRoute` (or `DataSourceService.createStatic`)
   - `PipelineService.scala:759` and `:1588`
   - `PipelineProposalProtocol.scala:198`
   - `PipelineProposalService.scala:195`, `:330`, `:374`, `:384` and `:557` (allow-list)
   - `PatchSetApplyResolvers.scala:425-428`

   Also state what `DataSourceKind.Static` becomes (removed, or kept as an alias-only constant) so no literal `== DataSourceKind.Static` check survives by accident.
2. **Replace task 3.2's file list** with the kind-string sites above (keep the type-rename sites as a separate sub-bullet) and correct the `DataSourceRepository` path to `infrastructure/persistence/sources/`. Include `AssistantProposalToolSchemas.scala:118` and decide whether its enum gains `"dataset"`, which it should to match `pipeline-proposal.schema.json`.
3. **Add tasks for alias round-trips on the non-data-source write paths.** Add backend tests showing that `type: "static"` and `type: "dataset"` are both accepted by (a) the inline-source branch of `POST /api/pipelines`, (b) pipeline proposal validate/apply, and (c) patch-set dataSource create. Stored/persisted proposals or patch sets that carry `"static"` must still apply.
4. **Fix Decision 4 and task 5.3.** State plainly that `AddSourceModal.tsx` (`SourceType` union at `:41`, branches at `:324` and `:379`) and `SourceTypeToggle.tsx` (`SourceType` at `:20`, `FALLBACK_CONNECTORS` at `:43`) must switch to `"dataset"`, or the Manual tab breaks. Decide what the modal sends on create (`"dataset"` is the natural choice). Name `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` as the acceptance signal that must pass.
5. **Complete task 5's inventory** with `dataSourceService.ts:113`, `PipelineProposalReviewPage.tsx:148`, `CombinedProposalReviewPage.tsx:150`, `helio-mcp/src/tools/pipelines.ts:48` and `helio-mcp/src/tools/pipelineProposal.ts:60`. Specify that the MCP zod enums gain `"dataset"` alongside `"static"`, matching task 5.5's JSON-schema change.
6. **Add a spec delta for `frontend-data-sources-page`.** The badge requirement (lines 113-116) should cover `type: "dataset"`, and the Manual-tab POST requirement (lines 90 and 106) should reflect the chosen create discriminator. Check `pipeline-proposal-analyze-api` (line 58) and add a delta if `"dataset"` becomes an accepted inline root type.

### Non-blocking notes

- `POST /api/data-sources` never validates `type` today: any unknown value falls through to `createStatic`. That is outside this ticket, but the executor should not assume a 400 path exists for it.
- `SparkJobSubmitter.scala:206`'s error string "Only 'static' and 'csv'" should become "dataset" as part of the rename.
