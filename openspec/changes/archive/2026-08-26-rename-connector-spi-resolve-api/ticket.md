# HEL-825: Rename the internal Connector[Config] SPI to free the name, and resolve the /api/connectors surface

## Description

Child 0 of HEL-820 (epic: Connectors: reusable credentialed hosts + parameterized source authoring). Lands first — everything else in the epic writes against the freed name.

"Connector" is the user-facing entity: a saved host + credential. But `backend/src/main/scala/com/helio/domain/connectors/Connector.scala` currently uses that name for a stateless behavioral SPI:

```scala
trait Connector[Config] {
  def metadata: ConnectorMetadata
  def testConnection(config: Config): Future[Either[String, Unit]]
  def inferSchema(config: Config): Future[Either[String, InferredSchema]]
  def fetch(config: Config, maxRows: Int): Future[Either[String, Vector[JsValue]]]
}
```

That is a driver — behavior per source kind, generic over each kind's config type. No entity, no table, no instance. It shipped July 2026 (HEL-449) with exactly two implementations: `RestApiConnector` and `SqlConnector`. The other five kinds (csv/static/text/pdf/image) have registry metadata only, no trait implementation.

Renaming it now is small. Renaming it after the epic has built a `Connector` entity on top would be painful and confusing.

## Resolved decisions (escalated to, and answered by, the human before Planning — 2026-08-26)

**1. Internal SPI trait name: `ConnectorDriver`.** Reads well at the type-parameter site (`ConnectorDriver[Config]`); avoids two real collisions: `kind` is already a plain string discriminator in `ConnectorRegistry`/`ConnectorMetadata` ("sql", "rest_api"), and `Source` is a distinct domain concept (sources are built FROM a connector kind, not identical to one). `Connector` is thereby freed for the future user-facing saved-credentialed-host entity the sibling tickets will build.

**2. `/api/connectors` + MCP `list_connectors`: move kind metadata to `/api/connector-types` (MCP tool renamed `list_connector_types`); free `/api/connectors` for the new entity. Take the break now, no deprecation window.** The caller set is 100% first-party and updated atomically in this same PR — there is no external SLA to protect. Doing this now, before any sibling ticket builds a real `/api/connectors` entity endpoint, avoids two different `/api/connectors` shapes ever coexisting.

Independently verified first-party consumer set (starting point — re-derive exhaustively during Execution, since doc comments and openspec specs also carry the path/name in prose):
- `backend/src/main/scala/com/helio/api/routes/sources/ConnectorRoutes.scala`
- `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorProtocol.scala`
- `backend/src/main/scala/com/helio/domain/connectors/ConnectorRegistry.scala` (doc comments reference the path)
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` (~3164-3165)
- `backend/src/test/scala/com/helio/api/routes/sources/ConnectorRoutesSpec.scala`
- `helio-mcp/src/types.ts` (~444, ~453)
- `helio-mcp/src/helioApi.ts` (~307)
- `helio-mcp/src/tools/read.ts` (~197)
- `helio-mcp/scripts/verify.ts` (~64, ~71)
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` + its test
- `Connector[Config]`/`SqlConnector`/`RestApiConnector`/`Connector.testConnection`/`Connector.scala`
  (file-name form) appear across **46 backend Scala files total** (19 main + 27 test — re-derived via
  the FULLY WIDENED pattern
  `grep -rlE '\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.scala\b|\bConnector\.testConnection\b' --include=*.scala backend/src`;
  this supersedes two earlier undercounts — "22 files", then "44 files" — each from a narrower
  pattern; see the round-5 design-gate note below on why the pattern needed widening a second time).
  Main-source files not already listed above include DI wiring (`app/Main.scala`,
  `api/ApiRoutes.scala`) and compiler-invisible doc-comment-only references a compile-driven rename
  will NOT surface: `domain/engine/PipelineRowJson.scala`, `domain/engine/InProcessPipelineEngine.scala`,
  `ai/ClaudeWireModels.scala`, `ai/HttpClaudeTransport.scala`,
  `services/sources/ContentSourceSupport.scala`, `services/pipelines/PipelineService.scala`,
  `services/pipelines/PipelineRunService.scala`, `services/pipelines/PipelineProposalService.scala`,
  `services/auth/SecretField.scala` (missed until round 5 — its doc comment names `Connector.scala`
  specifically, the file-name form the pattern didn't cover until this widening).
- Seven further `openspec/specs/` capabilities assert requirements naming `Connector[Config]`/
  `SqlConnector`/`RestApiConnector`/`Connector.testConnection`/`Connector.scala` (file-name form) and
  would otherwise go stale after this rename — exactly the drift AC 4 forbids: `fetch-error-envelope`,
  `schema-inference-facade`, `connection-test-endpoint`, `pipeline-run-execution`, `rest-api-connector`,
  `assistant-conversation-loop`, `connector-secret-redaction`. These get name-only MODIFIED/RENAMED
  deltas alongside `connector-spi`/`connector-registry` (9 capabilities total). The re-derivation
  pattern is
  `\bSqlConnector\b|\bRestApiConnector\b|Connector\[|\bConnector\.testConnection\b|\bConnector\.scala\b`
  — two successively narrower patterns (first omitting `Connector.testConnection`, then omitting
  `Connector.scala`) each missed one capability (`assistant-conversation-loop`, then
  `connector-secret-redaction`) in earlier passes; use the fully widened pattern above when
  re-verifying during Execution, and re-run it against the FINAL renamed code (not just this
  pattern's current form) in case yet another reference shape exists.

**Two caveats the human explicitly flagged, to be handled during Planning/Execution, not skipped:**

(a) Renaming the MCP tool changes what agents see. Tool discovery is dynamic so live sessions adapt, but check whether any committed prompt, skill, doc, or script in this repo names `list_connectors` in prose and update those too — a stale reference in a doc is exactly the drift HEL-804 tracks for openspec specs, and this rename must not create a second instance of that pattern.

(b) `helio-mcp` runs from a locally built `dist`. Once this merges, a stale local `helio-mcp` build will 404 against the new backend route until rebuilt. Not a blocker, but a real operational footgun for anyone driving prod through MCP — note this explicitly in the PR body and the Linear closing comment so it's discoverable.

## Constraint

**Behavior-preserving.** This is a rename plus an endpoint move (per the resolved decision above). No logic changes, no new capability, no "while I'm here" fixes. A reviewer should be able to confirm correctness from the diff being mechanical. Anything that looks like a real bug gets recorded as a spinoff ticket for the human to triage — never fixed inline inside this rename, except genuinely trivial fixes (per CONTRIBUTING.md refactor discipline).

## Acceptance Criteria

- [ ] The SPI trait (`Connector[Config]` -> `ConnectorDriver[Config]`) and its implementations (`RestApiConnector` -> `RestApiConnectorDriver`, `SqlConnector` -> `SqlConnectorDriver`, or equivalent) are renamed; the name `Connector` is free for the new entity
- [ ] Every reference updated — trait, implementations, registry, metadata types, DI wiring, tests, and any role/spec docs that name it. Enumeration verified in BOTH directions: nothing missed, nothing wrongly renamed (e.g. `ConnectorMetadata`/`ConnectorRegistry`/`ConnectorFieldDescriptor` describe connector KINDS, not the SPI trait — these are a separate naming question, addressed by the /api/connector-types decision, not swept into the trait rename by mistake)
- [ ] `GET /api/connectors` -> `GET /api/connector-types`; MCP `list_connectors` -> `list_connector_types`. Every consumer (frontend `connectorService.ts`/`SourceTypeToggle.tsx` + tests, `helio-mcp` `helioApi.ts`/`types.ts`/`tools/read.ts`/`scripts/verify.ts`) updated in this same PR. Prose references to `list_connectors` in any committed prompt/skill/doc/script also checked and updated (caveat a)
- [ ] `openspec/specs/` references updated for the renamed concept — note HEL-804 already tracks stale FQN references from the prior repackage; do not add a second instance of that drift
- [ ] PR body and Linear closing comment both note the `helio-mcp` local-`dist`-goes-stale operational footgun (caveat b)
- [ ] Full backend suite green with no test logic changed — only names
- [ ] No behavior change; any genuine bug found while moving code is either fixed trivially inline (and called out) or recorded as a spinoff ticket, never silently folded into this diff
