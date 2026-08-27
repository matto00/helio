## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Cited symbols exist as described.** `ConnectorMeta` at
  `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala:16`
  with `id/ownerId/name/kind/baseUrl/config/createdAt/updatedAt/dependentCount` (jsonFormat9) —
  design.md's field list is accurate. `ConnectorEntityService.scala`,
  `ConnectorEntityRoutes.scala` (`pathPrefix("connectors")`, distinct from
  `/api/connector-types`), `WorkspaceAssistantTools.scala`, `WorkspaceContextService.scala`,
  `AssistantProposalToolSchemas.scala`, `AssistantToolExecutor.scala` (at
  `com/helio/services/assistant/`) all exist. No stale-path finding.
- **HEL-826 invariant holds as described.** `DataSourceProtocol.scala:347` —
  `case (None, Some(_)) => Left("legacy-url: caller must resolve the implicit Connector")`.
  Decode is total; the bare-url rejection genuinely lives at the caller, exactly as Decision 1 says.
- **Create-time synthesis located.** `SourceService.scala:99-141` — bare-`url` branch calls
  `RestSourceConnectorMigration.splitUrl` + `ImplicitConnectorConfig.forLegacySource` +
  `connectorRepo.create`. `ImplicitConnectorConfig` is a **shared** helper used by both this
  create path and the startup migration (its own scaladoc says so) — so "remove the create path,
  keep the helper" is coherent, and task 1.2's shared-helper caution is correct. `splitUrl` has 3
  other uses inside `RestSourceConnectorMigration.scala` itself, so it must not be deleted as
  "now unused".
- **First-party bare-url callers.** Frontend never emits `url`
  (`frontend/src/features/sources/hooks/useRestSourceForm.ts:103-125`). `helio-mcp`
  `write.ts:132` still requires `url` — changed by this ticket itself. Design's risk claim checks out.
- **MCP surface today.** Only `list_connector_types` (`helio-mcp/src/tools/read.ts:197`);
  `list_connectors` is free. Ticket's premise findings verified.
- **Workspace context is two different things** — see CR1. `helio-mcp/src/context.ts:1-17`
  states the MCP `get_workspace_context` is a *client-side fan-out* over existing endpoints, with
  its own trimming tiers (`context.ts:662+`), independent of backend
  `WorkspaceContextResponse` (`WorkspaceContextProtocol.scala:203`, jsonFormat9) /
  `WorkspaceContextBudget.scala`.
- **`connectors.config` is not credential-safe for agent exposure** — see CR2.
  `ConnectorAuthShape` (`backend/src/main/scala/com/helio/domain/connectors/ConnectorAuthShape.scala:24-29`)
  carries `defaultHeaders: Map[String, String]`, free-form and user-supplied
  (merged into outbound requests at `RestApiConnectorDriver.scala:143`).

### Verdict: REFUTE

### Change Requests

1. **Resolve the workspace-context surface conflation (blocking).** Decision 5 and tasks 2.1–2.3
   only add `connectors` to the *backend* `WorkspaceContextResponse`, but the MCP
   `get_workspace_context` tool an agent actually calls is assembled client-side in
   `helio-mcp/src/context.ts` and never reads that response. As scoped, the ticket's workspace-context
   AC would not be satisfied on the MCP surface at all, while
   `specs/workspace-context-assembly/spec.md` writes "`get_workspace_context` (or
   `GET /api/workspace/context`)" as if they were one surface. Decide explicitly and make the
   artifacts agree: either add a `helio-mcp/src/context.ts` task (and say which trimming
   implementation task 2.3 targets — backend `WorkspaceContextBudget` or `context.ts`'s tiers, they
   are different code), or declare the MCP context out of scope and rewrite the spec scenarios to
   name only `GET /api/workspace/context`.

2. **Drop the `Vector[ConnectorMeta]` option; the "structurally cannot carry a credential" premise
   is false at the agent boundary.** Task 2.1 offers `connectors: Vector[ConnectorMeta]` and task 2.2
   justifies it as "structural — reuse `ConnectorMeta`, which cannot carry one". `ConnectorMeta`
   includes `config: JsValue`, i.e. `ConnectorAuthShape`, whose `defaultHeaders` map is arbitrary
   user-supplied headers and can hold `Authorization: Bearer …` / `X-Api-Key: …` verbatim
   (ConnectorAuthShape.scala:28; merged into requests at RestApiConnectorDriver.scala:143). It also
   leaks `ownerId` and a full `baseUrl`. Both spec deltas require **only** `id/name/kind/host`.
   Required: mandate an explicit slim projection type on both the workspace-context field and
   `list_connectors` (task 3.1's "or the workspace context connectors field … pick one" must not
   become a `ConnectorMeta` pass-through), and change the test in 2.2/7.1 from "no
   credential-shaped key" (a substring hunt that would sail past a token sitting inside
   `defaultHeaders`) to an **exact allowed-key-set assertion** over the serialized JSON.

3. **Decision 1's untouched-set is incomplete: name the other live bare-`url` paths.** Besides the
   migration, bare-`url` acceptance is also live in `SourceService.inferRest` (`:186-206`) and
   `testRest` (`:222-240`) via `toEphemeral`, and — per the comment at
   `DataSourceProtocol.scala:335-338` — in `PipelineService.resolveInlineSourceSchema`. Task 1.1's
   "In `RestApiConfigPayload.toDomain` (or the create-time resolution code in `SourceService`)"
   leaves it open whether those go too. State explicitly that preview/test/pipeline-inline bare-url
   remain accepted (or that they don't), add a regression test pinning that decision, and note that
   the `toDomain` change is **message-only** — deleting that `case (None, Some(_))` branch would
   break the ephemeral callers and violate the totality invariant.

4. **Fix the self-contradicting scenario title in `specs/rest-api-connector/spec.md`.** A MODIFIED
   scenario titled "Legacy bare-url create still succeeds (dual-support)" now asserts a 400, while a
   requirement of the identical name appears under `## REMOVED Requirements` in the same file.
   Rename the scenario to what it now asserts (e.g. "Bare-url create is rejected") so the delta is
   not internally contradictory.

### Non-blocking notes

- Design.md characterizes `ImplicitConnectorConfig` as serving "already-persisted rows"; it is in
  fact shared by both the create path and the migration today. The instruction (keep it) is right;
  the rationale sentence is imprecise. Also worth an explicit warning that
  `RestSourceConnectorMigration.splitUrl` stays (3 in-file callers) even though the create path
  stops calling it.
- Items 3 (agent-creates-Connector forbidden, Decision 2 + spec requirement + scenario) and 4
  (`AssistantProposalToolSchemas`/`AssistantToolExecutor` scoped verify-only in proposal, design
  Goals, and task 5.1) are correctly and consistently scoped — no objection.
- Task 4.4's hostile-input test is a genuine falsifiable check (not documentation), satisfying the
  ticket's "checked in both directions" AC — good. Note in execution that the MCP SDK's zod schema
  strips unknown keys silently; the test should assert the stripping, not a thrown error.
