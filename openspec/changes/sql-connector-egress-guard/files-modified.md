# Files modified — HEL-952 SQL connector egress guard

## Main sources

- `backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala` — extracted
  `checkResolvedHost` (behaviour-preserving refactor of `checkEgress`); added `checkEgressHost` —
  the bare-host SSRF entry point (charset gate + round-trip identity check + shared resolve/classify
  core), parameterised message noun.
- `backend/src/main/scala/com/helio/domain/connectors/SqlConnectorDriver.scala` — added
  `SqlEgressRefusedException`, `checkConfigEgress` (create-time-tolerant / connect-time-strict on
  `Unresolvable`), wired into `connect`; widened `execute`/`testConnection`/`inferSchema`/`fetch`
  with defaulted `resolveHost`/`isBlocked` params; curated refusal message surfaced verbatim
  (non-sensitive) instead of the generic category message.
- `backend/src/main/scala/com/helio/domain/connectors/ConnectorDriver.scala` — widened the trait's
  `testConnection`/`inferSchema`/`fetch` with defaulted `resolveHost`/`isBlocked` params (the
  task-2a seam).
- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — widened
  overrides to match the trait (ignores the new params; already carries its own instance-level
  resolveHost/isBlocked).
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — added
  `sqlResolveHost`/`sqlIsBlocked` constructor params, threaded into the `SqlSource` `fetch` call.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — reuses its
  existing `resolveHost`/`isBlocked` params for the engine's new SQL seam (previously only used
  for URL-backed csv/text/pdf/image fetches).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — inline-SQL-source
  analyze branch (`resolveInlineSourceSchema`) now reuses `sourceService`'s
  `sqlResolveHost`/`sqlIsBlocked` when a `SourceService` is wired, defaulting to production
  otherwise.
- `backend/src/main/scala/com/helio/services/sources/ConnectionTest.scala` — `run` forwards
  `resolveHost`/`isBlocked` to `connector.testConnection`.
- `backend/src/main/scala/com/helio/services/sources/CreateSourceEnvelope.scala` — `build`
  forwards `resolveHost`/`isBlocked` to `connector.inferSchema`.
- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — added
  `sqlResolveHost`/`sqlIsBlocked` constructor params (public `val`s so `PipelineService` can reuse
  them); `createSql` gains a create-time guard (`Disallowed`/`Invalid` → 400,
  `Unresolvable` tolerated); `inferSql`/`testSql`/`refreshSql`/`previewSql` thread the same
  override through to `SqlConnectorDriver`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — added `sqlUrlResolveHost`/
  `sqlUrlIsBlocked` defaulted constructor params; wired to `SourceService` and to
  `PipelineRunService`'s `resolveHost`/`isBlocked` (previously never overridden from `ApiRoutes`
  for pipeline runs).

## New test

- `backend/src/test/scala/com/helio/domain/connectors/SqlConnectorEgressGuardSpec.scala` — the
  RED-before-green SSRF proof (now flipped to the post-guard refusal assertion), blocked-class
  coverage (AC1/AC2), multi-A-record defence, unresolvable fail-closed-at-connect /
  tolerated-at-create-time, legitimate-host end-to-end connection (AC4), and the task-7 mutation
  check (inverse-direction assertion; the actual disable/re-enable transcripts are in
  `evidence/`).

## Repaired specs (regression sweep, task 8.1/8.1b) — admit-known-test-host override threaded
through the task-2a seam, no spec deleted/ignored/rewritten to route around the guard

- `backend/src/test/scala/com/helio/domain/connectors/SqlConnectorDriverSpec.scala`
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala`
- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpecBase.scala`
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/sources/SourceServiceSpec.scala` — beyond the
  admit-localhost repair, this file also gained NEW coverage (skeptic-final-1 CR1): a
  "reject createSql for a host resolving to ..." block asserting `BadRequest` and zero
  persistence for each blocked class, plus the "still create" permitted-host case. Mutation-
  checked (evidence/task-5.2-mutation-check-*.txt) by neutralising `SourceService.createSql`'s
  own `checkConfigEgress` call site — confirmed all 4 new tests go red for the right reason
  (a real row persisted, `fetchError` set from the untouched connect-time guard, instead of the
  expected `Left(BadRequest)`).

- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — touched
  during the run: it constructs `PipelineRunService` directly rather than via `ApiRoutes`, so it
  needed the same `isBlocked` override at that call site. The cycle-4 rewrite of the positive
  permitted-host test removed the need again, so this file's NET diff against `origin/main` is
  empty; it is declared here because it was genuinely edited during the run, not because it
  carries a surviving change.

## Test-double widening (task 2a.1, trait signature change)

- `backend/src/test/scala/com/helio/domain/connectors/ConnectorSpec.scala`
- `backend/src/test/scala/com/helio/domain/connectors/NewConnectorInferenceSpec.scala`
- `backend/src/test/scala/com/helio/services/sources/CreateSourceEnvelopeSpec.scala`

## Behaviour-preservation proof (task 1.0)

- `backend/src/test/scala/com/helio/services/sources/ContentSourceSupportSpec.scala` — added
  `checkEgressHost` unit coverage (tasks 1.2–1.4); `ContentSourceSupportSpec` + sibling
  `RestConnectorEgressGuardSpec` ran before AND after the `checkEgress` extraction (60/60 both
  times — see the executor's returned transcript).
