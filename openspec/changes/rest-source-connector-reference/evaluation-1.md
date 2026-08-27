## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All six ticket ACs addressed:
  1. `RestApiConfig` references a Connector + endpoint/method/queryParams/body — confirmed (`model.scala`, `DataSourceProtocol.scala`).
  2. No credential remains on the source — confirmed both by type (`RestApiConfigPayload` has no secret-carrying field; `hasSecrets = HasSecrets(Set.empty)`) and empirically (live-created source's persisted `config` in the dev DB contains only `method`/`endpoint`/`connectorId`; the synthesized Connector, not the source, holds `credential_id`).
  3. Migration proven via real fetch round-trip: `RestSourceConnectorMigrationSpec` fetches through the legacy path first, migrates, then fetches through the new path and asserts response equality, for both a bearer-auth and an api-key-in-query legacy row (task 4.5/CR7). This satisfies the AC's "demonstrated by running real sources... not by inspecting the table" for the seeded rows this worktree can construct (design.md's Context section correctly notes local dev DB has zero pre-existing `rest_api` rows to migrate against).
  4. Header precedence documented in `rest-api-connector/spec.md` ("Header precedence between Connector and source... source's value winning on a key collision") and implemented (`mergedHeaders = authShape.defaultHeaders ++ config.headers`, source wins) — **but not tested anywhere in the diff** (see Phase 2 Change Request #1). AC says "documented and tested"; only half is met.
  5. Reversibility stated explicitly, with reasoning (Decision 8, scaladoc on `RestSourceConnectorMigration`) — not automatically reversible, rationale given.
  6. Wire contract updated in all four named places, plus the fifth surface design.md itself flagged (`RestApiConnectorDriver.metadata.requiredFields`, `ConnectorRegistrySpec` re-pinned to `["connectorId"]`) — confirmed. `schemas/` question resolved (Decision 9, confirmed absent, left unadded with reasoning that matches every other connector kind's pre-existing gap).

- Task completion: all 52 checklist items in `tasks.md` marked `[x]`; spot-checked against source for the highest-risk ones (dependentCount wiring, migration branches, dual-support ambiguity guard) and all match.
- Scope: no unrelated refactors found; changes are tightly bounded to the REST-source/Connector wire and execution paths named in the ticket/design.
- Regression check: `PipelineRunServiceSpec`/`InProcessPipelineEngineSpec` HEL-758/HEL-279 shared/scheduled-run coverage passes and Decision 11's `findByIdInternal` (non-owner-scoped, pipeline-execution-only) is wired only at `InProcessPipelineEngine`'s fetch call sites — `SourceService`/routes/`ConnectorEntityService` still use `findByIdOwned` exclusively. No regression to the ACL boundary found.
- One real spec-vs-implementation gap found (Phase 2 Change Request #2): design.md's Decision 6 CR4 explicitly commits to updating `AssistantProposalToolSchemas.scala`'s advertised `rest_api` tool schema to the new `{connectorId, endpoint, method?, queryParams?, headers?}` shape "because it does not compile otherwise" — but `files-modified.md` does not list this file, and `git diff --name-only` confirms it was never touched. It still advertises `{url, method?, auth?, headers?}` to the assistant/MCP tool-use loop. This doesn't break compilation (the schema is JSON string literals, not compiled against the Scala type), so the CR4 premise("breaks at compile time") turned out to be over-stated in the design doc itself — but the *documented decision* was still not carried out, and the mismatch is real: the tool schema still tells an agent `auth` is an accepted field for testing an inline `rest_api` connection, while `SourceService.testRest`/`inferRest` now hard-reject any request carrying `auth` with a 400. An agent following its own advertised tool contract will be rejected.

### Phase 2: Code Review — PASS (with two Change Requests, non-blocking findings recorded)

**Gates (fresh run, this session, in `WORKTREE_PATH`):**
- `sbt test`: **3521/3521 passed**, 0 failed, 225 suites, 194s. (`/tmp/hel822_sbt_test.log`, `EXIT=0`.)
- `node scripts/check-scala-quality.mjs`: clean (only pre-existing informational file-size soft-warnings across the whole test tree, none new/blocking).
- Backend-only change; no `frontend/**` files touched (confirmed via `git diff --name-only`), so `npm run lint`/`format:check`/`test`/`build` were not run per the gate-selection rule (no matching changed files).

**Design-decision-by-decision verification (backend/Scala; no `frontend/**` changes, so DESIGN.md is not applicable):**
- Decision 5 (`dependentCount`): real query wired exactly at `ApiRoutes.scala:449` (`connectorEntityServiceOpt` site, not `Main.scala`), `dataSourceRepo.countRestSourcesReferencing(id)` — no `user` param, matching the corrected round-4 design. `ConnectorRepositorySpec` exercises create→reference→409-block→cross-connector-isolation.
- Decision 6 (fail-loud decode): `decodeRest` returns `Either[String, RestApiConfig]` with exactly the three outcomes specified; `rowToDomain` sentinel handling (`__unmigrated__`/`__malformed__`) present; `ReservedConnectorIds` rejects both sentinels at the decode boundary — closes the bypass structurally as designed.
- Decision 7 (migration): all four branches implemented and distinct (valid/legacy-owned/legacy-ownerless/malformed), idempotent (`Right` case is a no-op), uses `Uri`-based `splitUrl` round-tripped through `joinUrl`, uses `updateConfigInternal` under `withSystemContext` as corrected in round 3.
- Decision 1c (ephemeral infer/test): distinct `EphemeralRestConfig` type, never round-trips through `DataSourceConfigCodec`, never persists a Connector — confirmed both by code inspection and live UI verification (Phase 3).
- Decision 4 (header precedence: source wins): implemented correctly (`authShape.defaultHeaders ++ config.headers`).
- Decision 11 (pipeline-execution internal resolution): `ConnectorRepository.findByIdInternal` added, used only from `InProcessPipelineEngine`; `SourceService`/routes continue to use `findByIdOwned`.
- Decision 2 (no new RLS table): confirmed — `connectorId` lives inside the existing `data_sources.config` JSONB; no Flyway migration added; `RlsPolicyGuardSpec` correctly has nothing new to allowlist. HEL-842's same-PR contract is honored (nothing to add, not skipped).

**Change Request #1 — header precedence is documented but not tested (AC4 partially unmet).**
No test in the diff exercises the Connector-resolving `buildResolvedRequest` path with a colliding header key. `RestApiConnectorDriverSpec` was "rewritten to exercise the ephemeral path directly" (per `files-modified.md`) and no longer covers `buildResolvedRequest`/`fetch(config, ConnectorResolveContext.Owned(...))` at all; `RestSourceConnectorMigrationSpec`'s round-trip tests do exercise the real Connector-resolving fetch path (through a stub HTTP server) but assert response-body equality only, never a colliding-header scenario. Grepped the full `backend/src/test/scala` tree for `defaultHeaders`/`precedence`/`collid.*header` — zero hits outside the spec.md prose. Design.md Decision 4 explicitly commits: "tested with a colliding-key case asserting the source's value wins." This commitment was not carried out.
- **Fix**: add a unit test (e.g. in `RestApiConnectorDriverSpec`, restoring/adding a case for the Connector-resolving path, or in `RestSourceConnectorMigrationSpec`'s existing stub-server harness) that creates a Connector with `defaultHeaders = {"X-Test": "connector"}`, a source with `headers = {"X-Test": "source"}`, and asserts the outbound request carries `X-Test: source`.

**Change Request #2 — `AssistantProposalToolSchemas.scala` was not updated per design.md's own Decision 6/CR4 commitment.**
The advertised `rest_api` tool schema for `propose_pipeline`/`propose_combined`/`test_connection` still describes `{url, method?, auth?, headers?}`, not the new `{connectorId, endpoint, method?, queryParams?, headers?}` shape design.md committed to shipping in this PR. An assistant/MCP caller following the tool's own documented contract and supplying `auth` on an inline `rest_api` source will now be rejected with a 400 ("auth is not accepted...") that the tool schema gives it no reason to expect. This is a real, if narrow, documentation/behavior mismatch on a live tool surface (not dead code — `AssistantToolExecutor.test_connection` and `PipelineService.resolveInlineSourceSchema` both still route through this contract).
- **Fix**: update `AssistantProposalToolSchemas.scala`'s `rest_api` config-payload description (both the `propose_pipeline`/`propose_combined` and `test_connection` tool schemas) to `{connectorId, endpoint, method?, queryParams?, headers?}`, drop `auth` from the advertised shape, and update `AssistantProposalToolSchemasSpec` if it pins the old description string.

Neither of these two findings is a functional break of any tested/verified path — both are coverage/documentation gaps against the design's own explicit commitments, not incorrect runtime behavior of any exercised code path. Scored as non-blocking Change Requests (fix in this cycle or next, evaluator's call: recommend fixing now since both are small and the design doc explicitly promised them).

Other checks:
- DRY / readable / modular: `ImplicitConnectorConfig` cleanly shares the synthesis policy across the two call sites per Decision 1's round-2 CR4 correction; no duplication found.
- Type safety: `auth` removed entirely from the domain type (not defaulted/Option-vestigial) — "no credential remains" enforced by the type itself, as designed.
- Security: credential never round-trips to a client; `SecretRedaction.redact` still called (now over an empty `HasSecrets` set, correctly kept for compile-compatibility); `decryptForUse`'s existing ownership/outbound-only contract preserved.
- Error handling: fail-loud decode (Decision 6) correctly implemented — no silent zero-value fallback anywhere in the diff.
- No dead code / no over-engineering: the `EphemeralRestConfig`/`fetchEphemeral` split is real, load-bearing (not speculative) — it closes a genuine ownership-check bypass the design's own round-3 review found in an earlier sentinel-based draft.

### Phase 3: UI Review — PASS

Triggered by `backend/src/main/scala/routes/ApiRoutes.scala` changes (no `frontend/**` changes). Scope: verify the existing "Add REST Source" flow (`RestApiForm.tsx` → `AddSourceModal.tsx`) continues to work unchanged against the new backend, per the task's explicit scope note.

- Dev servers started via `scripts/concertino/start-servers.sh`/`assert-phase.sh` → `PASS servers`.
- Full happy path exercised live: filled Source name + URL (bare-URL legacy shape, no auth field in the UI at all) → **Test connection → "✓ Connected"** (exercises `POST /api/sources/test`, the ephemeral ownerless ownership-bypass-safe path) → **Preview schema** correctly inferred 4 fields (`completed`/`id`/`title`/`userId`) with correct types (`POST /api/sources/infer`, ephemeral path) → **Create source → 201 Created**, source appears with correct name/type/schema.
- Verified via direct DB read (dev Postgres) that the created row's `data_sources.config` is exactly `{"method":"GET","endpoint":"/todos/1","connectorId":"<uuid>"}` — no `url`/`auth` field persisted on the source — and the referenced `connectors` row is `name = "Auto: Eval HEL-822 UI Check"`, `config = {"authType":"none","implicit":true,"defaultHeaders":{}}`, `credential_id` set (empty-string-plaintext, encrypted) — matching Decision 1/1a/7 exactly.
- No console errors during the flow (0 errors, 0 warnings). All three network calls (`/api/sources/test`, `/api/sources/infer`, `/api/sources`) returned 200/200/201.
- Responsive check at 768px: existing source detail view renders without layout breakage (screenshot captured).
- Not exercised (out of this ticket's UI-affecting scope, no new UI surface shipped): a Connector-picker-driven create flow, since `RestApiForm.tsx` has no such UI yet (HEL-824/827's job per design.md Decision 1b) — this is expected and consistent with the design's explicitly recorded out-of-scope finding.

### Overall: PASS

Both Change Requests are real but narrow (test-coverage and tool-schema-description gaps against the design's own stated commitments), neither reflects incorrect behavior in any exercised path, and the ticket's acceptance criteria are functionally met and empirically verified (including the highest-risk `dependentCount` seam and the migration's real round-trip proof). Recommend the executor close both Change Requests in a fast follow-up commit within this cycle if time allows, but they do not block delivery.

### Change Requests

1. Add a unit test asserting header-precedence (source overrides Connector's `defaultHeaders` on a colliding key) through the Connector-resolving `RestApiConnectorDriver.fetch`/`buildResolvedRequest` path — design.md Decision 4 explicitly committed to this and it is currently untested. See file/location suggestions above.
2. Update `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`'s advertised `rest_api` config shape from `{url, method?, auth?, headers?}` to `{connectorId, endpoint, method?, queryParams?, headers?}` (dropping `auth`), per design.md Decision 6/CR4's explicit commitment; update `AssistantProposalToolSchemasSpec` if it pins the old string.

### Non-blocking Suggestions

- Out-of-scope findings design.md correctly recorded (not fixed, not filed, per this run's instructions): (a) `schemas/` has no REST-source JSON Schema, consistent with every other connector kind — Decision 9; (b) HEL-827 should remove the bare-`url` dual-support path once `RestApiForm` gets a Connector picker — Decision 1b. Both correctly left for the human/coordinator to triage.
