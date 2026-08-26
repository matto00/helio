## 1. SPI trait rename (backend, main sources)

- [x] 1.1 Rename `trait Connector[Config]` -> `ConnectorDriver[Config]` in `Connector.scala` (rename
      file to `ConnectorDriver.scala`); update its doc comments to the new name; verify `sbt compile`
      still resolves this file with only the name changed
- [x] 1.2 Rename `RestApiConnector` -> `RestApiConnectorDriver` in `RestApiConnector.scala` (rename
      file to `RestApiConnectorDriver.scala`), update its `extends Connector[...]` to
      `extends ConnectorDriver[...]`; verify `sbt compile` succeeds
- [x] 1.3 Rename `SqlConnector` -> `SqlConnectorDriver` in `SqlConnector.scala` (rename file to
      `SqlConnectorDriver.scala`), update its `extends Connector[...]` to
      `extends ConnectorDriver[...]`; verify `sbt compile` succeeds
- [x] 1.4 Update every other backend `main` reference to the old names — compiler-checked sites:
      `ConnectorRegistry.scala`, `SchemaInferenceEngine.scala`, `CreateSourceEnvelope.scala`,
      `SourceService.scala`, `ConnectionTest.scala`, DI wiring in `app/Main.scala` and
      `api/ApiRoutes.scala`; verify `sbt compile` succeeds with zero remaining old-name references in
      these files
- [x] 1.5 Update compiler-invisible doc-comment-only references (will NOT be caught by 1.1-1.4's
      compile check — verify each by grep, not by relying on the build): `domain/engine/
      PipelineRowJson.scala`, `domain/engine/InProcessPipelineEngine.scala`,
      `ai/ClaudeWireModels.scala`, `ai/HttpClaudeTransport.scala`,
      `services/sources/ContentSourceSupport.scala`, `services/pipelines/PipelineService.scala`,
      `services/pipelines/PipelineRunService.scala`, `services/pipelines/PipelineProposalService.scala`,
      `services/auth/SecretField.scala` (line ~37: `` see `Connector.scala`'s `'''Secret redaction'''`
      doc block `` — a round-5 design-gate finding: an earlier pass's verification pattern omitted the
      `Connector.scala` file-name form and missed this file); verify via the FULLY WIDENED pattern
      `grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.scala\b|\bConnector\.testConnection\b' backend/src/main` ==
      empty (excluding the new `ConnectorDriver`-named files themselves matching only the new name) —
      NOT the narrower pattern used in earlier drafts of this task, which reports false-clean here
- [x] 1.6 Update `backend/src/main/scala/com/helio/domain/connectors/README.md`; verify no remaining
      old-name references in it

## 2. SPI trait rename (backend, test sources)

- [x] 2.1 Update every test file matched by the FULLY WIDENED pattern
      `grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.scala\b|\bConnector\.testConnection\b' --include=*.scala backend/src/test`
      (27 files — 26 from an earlier, narrower pass plus `SchemaInferenceEngineSpec.scala`, line ~117:
      `// Connector.scala's '''Schema inference''' doc block.`, a round-5 design-gate finding the
      narrower pattern missed): `NewConnectorInferenceSpec`, `RestApiConnectorSpec` (rename file to
      `RestApiConnectorDriverSpec.scala`), `SqlConnectorSpec` (rename file to
      `SqlConnectorDriverSpec.scala`), `ConnectorSpec`, `ConnectorRegistrySpec`,
      `CreateSourceEnvelopeSpec`, `SourceServiceSpec`, `ApiRoutesSpec`, `ApiTokenAuthSpec`,
      `AuditMutationInstrumentationSpec`, `InProcessPipelineEngineSpec`, `HookRoutesSpec`,
      `PipelineAnalyzeProposalRoutesSpec`, `ComputedFieldsRoutesSpec`, `DataSourceRoutesSpec`,
      `PipelineRunRoutesSpec`, `ApplyProposalSpecBase`, `MfaApiRoutesSpec`,
      `CombinedApplyProposalSpecBase`, `UploadRoutesSpec`, `PipelineRunServiceSpec`,
      `SchemaInferenceRegressionSpec`, `PipelineApplyProposalSpecBase`, `DashboardPanelAclSpec`,
      `DataTypeDataSourceAclSpec`, `ApiRoutesCorsErrorHandlingSpec`, `SchemaInferenceEngineSpec`, and
      `ConnectorRoutesSpec` (its matches are route-path references, not trait references — confirm
      before editing, since `ConnectorRoutesSpec` primarily belongs to task 3.2's endpoint-move scope,
      not this one. CORRECTION from a round-6 design-gate finding: this file's route mounting uses the
      PREFIX-LESS path form — `"GET /connectors" should {` (line 23) and five `Get("/connectors")`
      calls (lines 26, 35, 47, 55, 63) — not just the one `/api/connectors` prose mention at line ~14
      an earlier pass claimed was the only match. The pattern `/api/connectors\b` alone does not
      match a route registered as `path("connectors")` under an existing `pathPrefix("api")`, since
      the test only ever writes the un-prefixed `/connectors` when constructing requests against the
      route directly) — names only, no assertion/fixture logic changes; verify `sbt test` passes with
      the same test count and same pass/fail outcomes as before the rename

## 3. Frontend trait-name reference + endpoint/tool move

- [x] 3.1 Update `frontend/src/features/sources/ui/TestConnectionAffordance.tsx:3` (confirmed
      doc-comment reference: `// any source form with a Connector[Config]-backed connection to test`)
      to the new trait name; verify no remaining `Connector[Config]` reference in this file
      (`grep -n 'Connector\[' frontend/src/features/sources/ui/TestConnectionAffordance.tsx` == empty)
- [x] 3.2 Change the route in `ConnectorRoutes.scala` from `GET /api/connectors` to
      `GET /api/connector-types`; update `ConnectorProtocol.scala`'s doc comment; update
      `ApiRoutesSpec.scala`/`ConnectorRoutesSpec.scala` to the new path — in `ConnectorRoutesSpec.scala`
      specifically this means the `"GET /connectors" should {` block label (line ~23) AND all five
      `Get("/connectors")` request constructions (lines ~26/35/47/55/63), not just a doc comment,
      since this spec mounts `ConnectorRoutes` directly without the `pathPrefix("api")` wrapper
      `ApiRoutes.scala` normally supplies (a round-6 design-gate finding — the un-prefixed form isn't
      caught by an `/api/connectors`-anchored grep); verify those specs pass
- [x] 3.3 Update `frontend/src/features/sources/services/connectorService.ts` to call
      `/api/connector-types` (keep the `listConnectors` export name — see design.md decision 3a);
      update `SourceTypeToggle.tsx` doc comment; update `SourceTypeToggle.test.tsx`/
      `AddSourceModal.test.tsx` mocks to intercept the new path; verify
      `npm test -- --testPathPattern=SourceTypeToggle` and `AddSourceModal` pass
- [x] 3.4 Rename the MCP tool `list_connectors` -> `list_connector_types` in
      `helio-mcp/src/tools/read.ts`; update `helioApi.ts`'s `/api/connectors` call site to
      `/api/connector-types` (keep the `listConnectors()` method name — design.md decision 3a) and its
      doc comment; update `types.ts` doc comments; update `helio-mcp/scripts/verify.ts`'s tool-name
      references; verify `helio-mcp` builds (`npm run build` or equivalent in `helio-mcp/`)
- [x] 3.5 Grep the whole repo (prompts, skills, docs, scripts — not just `helio-mcp/src`), EXCLUDING
      `openspec/changes/archive/**` (immutable historical records of already-shipped changes — not
      in scope, do not edit them), for `list_connectors` in prose and update any committed match,
      including `frontend/.../connectorService.ts:4`'s doc-comment mention; verify zero remaining
      matches outside git history and outside `openspec/changes/archive/**`

## 4. Spec sync

- [x] 4.1 Confirm the nine MODIFIED/RENAMED-requirements deltas under
      `openspec/changes/rename-connector-spi-resolve-api/specs/` (`connector-spi`, `connector-registry`,
      `fetch-error-envelope`, `schema-inference-facade`, `connection-test-endpoint`,
      `pipeline-run-execution`, `rest-api-connector`, `assistant-conversation-loop`,
      `connector-secret-redaction`) are complete and accurate against the final code. Re-derive the
      set with the fully widened pattern
      `grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.testConnection\b|\bConnector\.scala\b' openspec/specs/`
      (two successively narrower patterns each undercounted this set by one: first omitting
      `Connector.testConnection` — missed `assistant-conversation-loop`, undercount at 7 — then
      omitting the `Connector.scala` file-name form — missed `connector-secret-redaction`, undercount
      at 8). Re-run this pattern one more time against the FINAL state of `openspec/specs/` right
      before archiving (task 4.2), in case yet another reference shape surfaces during Execution that
      this document's own history shows is a real, recurring risk, not a hypothetical one.
      `openspec validate rename-connector-spi-resolve-api --type change` passing is a
      necessary but NOT sufficient check — it does not catch a MODIFIED header openspec archive can't
      find, or a MODIFIED block that drops a scenario the canonical spec still has. Verify for real
      with an archive rehearsal against a throwaway copy of `openspec/`, not the live worktree:
      `rm -rf /tmp/hel825-archive-check && cp -r openspec /tmp/hel825-archive-check/openspec && (cd /tmp/hel825-archive-check && openspec archive rename-connector-spi-resolve-api -y --json)`,
      confirming the JSON output has a non-null `"archive"` key and no `archive_spec_update_failed`
      error, then `rm -rf /tmp/hel825-archive-check`. Only `openspec archive` (unmodified, no
      `--skip-specs`) at the real archive step (task 4.2) is the actual acceptance signal.
- [x] 4.2 Run the real `openspec archive rename-connector-spi-resolve-api --yes` in the worktree
      (this is also Phase 3 Delivery's own archive step, not a separate action) and confirm it
      succeeds with no `archive_spec_update_failed` error, matching task 4.1's rehearsal
- [x] 4.3 After the real archive (task 4.2), directly edit the `## Purpose` paragraphs of the five
      canonical spec files that name an old identifier — `openspec/specs/connector-spi/spec.md`,
      `openspec/specs/connector-registry/spec.md`, `openspec/specs/fetch-error-envelope/spec.md`,
      `openspec/specs/schema-inference-facade/spec.md`, `openspec/specs/connection-test-endpoint/spec.md`
      (the latter three were missed by an earlier pass that used the narrower, pre-widened grep
      pattern — `connection-test-endpoint`'s Purpose specifically names `Connector.testConnection`,
      which only the widened pattern catches) — to the new trait/route/tool names (a
      MODIFIED-requirements delta cannot reach `## Purpose` text — see design.md decision 6).
      `openspec/specs/pipeline-run-execution/spec.md`, `openspec/specs/rest-api-connector/spec.md`,
      `openspec/specs/assistant-conversation-loop/spec.md`, and
      `openspec/specs/connector-secret-redaction/spec.md` need NO Purpose edit (confirmed their
      Purpose paragraphs carry no old-name text). Verify with
      `grep -n 'Connector\[Config\]\|SqlConnector\b\|RestApiConnector\b\|Connector\.testConnection\b\|/api/connectors\b\|list_connectors\b' openspec/specs/connector-spi/spec.md openspec/specs/connector-registry/spec.md openspec/specs/fetch-error-envelope/spec.md openspec/specs/schema-inference-facade/spec.md openspec/specs/connection-test-endpoint/spec.md`
      returning no matches

## 5. Full verification

- [x] 5.1 Run the full backend suite (`sbt test`) and confirm the same tests pass as on `main` before
      this change (no test logic changed, only names) — record before/after test counts
- [x] 5.2 Run `npm run typecheck`, `npm run lint`, and `npm test` in `frontend/` and confirm no
      regressions
- [x] 5.3 Bidirectional final check: grep for the OLD names (`Connector\[`, `\bSqlConnector\b`
      excluding `SqlConnectorDriver`, `\bRestApiConnector\b` excluding `RestApiConnectorDriver`,
      `Connector\.testConnection\b`, `Connector\.scala\b`, `(/api)?/connectors\b`, `list_connectors\b`)
      across the whole repo (the `(/api)?/connectors\b` form — widened by a round-6 design-gate
      finding — also catches the prefix-less `/connectors` route form used where a test mounts
      `ConnectorRoutes` directly without `ApiRoutes.scala`'s `pathPrefix("api")` wrapper, e.g.
      `ConnectorRoutesSpec.scala`'s `Get("/connectors")` calls — see task 3.2)
      (backend, frontend, helio-mcp, openspec/specs, docs/prompts/skills), with FOUR explicit
      exclusions (this check can never be a bare "zero matches" — state the expected count per
      exclusion so it's falsifiable, not aspirational):
      1. `openspec/changes/archive/**` — immutable historical records, legitimately contain old-name
         prose from already-shipped changes (e.g. `2026-07-24-connector-registry-capability-metadata/**`,
         `2026-07-25-smart-shape-mcp-surface/**`, and many more); not in scope, never edit them.
      2. The two deliberate "previously served at `GET /api/connectors`" / "previously named
         `list_connectors`" migration-note sentences in this change's own
         `specs/connector-registry/spec.md` delta (design.md decisions 1-2's migration-path
         documentation, not drift).
      3. The harmless lowercase package-path prose `domain/connectors`/`domain.connectors` (e.g. in
         `ConnectorRoutes.scala`'s own package declaration/imports, or path mentions like
         `backend/src/main/scala/com/helio/domain/connectors/`) — the widened `(/api)?/connectors\b`
         pattern's optional-prefix form can match the `connectors` segment of that package path; this
         is the unrelated package/directory name, never the renamed route, and is not touched by this
         change.
      4. `#### Scenario:` TITLE lines carrying an old name in `openspec/specs/` (NOT their bodies) —
         per design.md decision 5a, scenario titles are deliberately never renamed. Expect exactly 8
         such lines post-archive: `connector-spi` x5 (`SqlConnector is reachable as a Connector`,
         `RestApiConnector is reachable as a Connector`, `Existing SqlConnector/RestApiConnector
         behavior unchanged`, `SqlConnector exposes metadata`, `RestApiConnector exposes metadata`),
         `fetch-error-envelope` x1 (`Helper compiles against any Connector[Config] implementation`),
         `schema-inference-facade` x2 (`SqlConnector routes through the facade unchanged`,
         `RestApiConnector routes through the facade unchanged`). A grep for old-name matches confined
         to lines starting with `#### Scenario:` should find exactly these 8 and no others; treat any
         additional scenario-title match, or any old-name match OUTSIDE a `#### Scenario:` title line
         and outside exclusions 1-3, as a real failure.
      Confirm zero remaining matches outside all four exclusions and git history/CHANGELOG;
      separately confirm `ConnectorRegistry`, `ConnectorMetadata`, `ConnectorFieldDescriptor`,
      `ConnectorRoutes`, `ConnectorProtocol`, `ConnectorMetadataResponse`, and the frontend/`helio-mcp`
      `listConnectors` client method names were NOT accidentally renamed (design.md decisions 3/3a)
