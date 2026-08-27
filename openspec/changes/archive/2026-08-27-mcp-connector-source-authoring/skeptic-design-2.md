## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**CR1 (workspace-context surface conflation) — FIXED.**
`helio-mcp/src/context.ts:1-17` header states verbatim "Implementation is a CLIENT-SIDE FAN-OUT
over existing endpoints" with its own call budget — it is what design.md Decision 5 describes, and
it never reads the backend `WorkspaceContextResponse`. Both surfaces are now covered independently:
task 2.2 (backend `WorkspaceContextResponse.connectors`) and task 2.5 (`context.ts` own
`GET /api/connectors` fan-out, marked "required for the AC, not optional"). Specs match: an ADDED
requirement in `specs/workspace-context-assembly/spec.md` scoped to `GET /api/workspace/context`
only, plus a separate ADDED "Connectors surfaced in the MCP workspace-context fan-out" requirement
in `specs/mcp-data-source-tools/spec.md` naming `buildWorkspaceContext`. No remaining
"get_workspace_context (or GET /api/workspace/context)" conflation.

**CR2 (ConnectorMeta reuse) — FIXED.**
`ConnectorAuthShape.scala:24-29` confirmed: `defaultHeaders: Map[String, String]`, free-form and
user-supplied — correctly named as the risk in design.md Decision 6. Decision 6 now mandates
`ConnectorSummary {id, name, kind, host}` built "by naming exactly those four fields, never by
taking ConnectorMeta/ConnectorAuthShape and subtracting or substring-scanning". Tasks 2.1/2.3/3.1/
3.3 enforce it: 2.1 allow-list construction, 2.3 exact-key-set assertion `{"id","name","kind",
"host"}` with an `Authorization`-shaped `defaultHeaders` fixture, 3.1 maps the slim shape not
`ConnectorMeta`, 3.3 gives the TS type no `config`/`defaultHeaders` field at all. The
workspace-context spec scenario likewise requires asserting the exact key set "not merely the
absence of a field literally named credential".

**CR3 (Decision 1 edit-site precision) — FIXED, and verified against source myself.**
`SourceService.scala` `createRest`: the match is on `(request.config.connectorId,
request.config.url)`; `RestApiConfigPayload.toDomain` is invoked ONLY inside the
`case (Some(_), None)` arm (line ~89), while `case (None, Some(url))` (line ~99) does its own
`splitUrl` + `ImplicitConnectorConfig.forLegacySource` + `connectorRepo.create`. So `toDomain`'s
own `(None, Some(_))` branch is indeed unreachable on this path — design.md and task 1.1 identify
the edit site correctly. Task 1.2 enumerates exactly the five untouched paths required
(`RestSourceConnectorMigration`, `ImplicitConnectorConfig`, `inferRest`, `testRest`,
`PipelineService.resolveInlineSourceSchema`).

**CR4 (spec self-contradiction) — NOT FIXED. Still present, verbatim.**
`specs/rest-api-connector/spec.md` still contains BOTH:
- under `## MODIFIED Requirements` → `#### Scenario: Legacy bare-url create still succeeds
  (dual-support)` whose THEN clause is "the response is 400, not 201"; and
- a `## REMOVED Requirements` block headed `### Requirement: Legacy bare-url create still succeeds
  (dual-support)`.
The exact defect round 1 raised is unchanged. Additionally verified against the baseline
(`openspec/specs/rest-api-connector/spec.md:53`): that name exists in the baseline as a
**scenario nested under "Create a REST/HTTP data source"**, not as a top-level requirement — so
the REMOVED block removes a requirement that does not exist, while the requirement it actually
belongs to is being MODIFIED in the same file. `openspec validate --strict` passes (it does not
cross-check delta headers against the baseline), so the validator's green is not evidence here.

**New-staleness sanity pass.** Proposal/design/tasks are mutually consistent on scope, the
untouched set, and the two context surfaces. Ticket ACs (list_connectors, connectorId-based
create, credential-never-in-context enumeration, e2e demo) each map to tasks 3.x/4.x/7.1/6.1.
No new contradiction introduced by the round-1 revisions other than CR4 remaining open.

### Verdict: REFUTE

### Change Requests

1. In `openspec/changes/mcp-connector-source-authoring/specs/rest-api-connector/spec.md`, delete
   the entire `## REMOVED Requirements` section. It names
   `### Requirement: Legacy bare-url create still succeeds (dual-support)`, which is not a
   requirement in the baseline spec — the baseline has it as a scenario at
   `openspec/specs/rest-api-connector/spec.md:53`, inside the "Create a REST/HTTP data source"
   requirement this delta already MODIFIES. Its rationale/migration prose, if worth keeping, belongs
   in the MODIFIED requirement body (where the **BREAKING** paragraph already says the same thing)
   or in design.md Decision 1 — not as a phantom removal.
2. In the same file, rename the MODIFIED scenario `#### Scenario: Legacy bare-url create still
   succeeds (dual-support)` to state what it now asserts (e.g. `#### Scenario: Bare-url create is
   rejected`), and drop the now-pointless parenthetical "(as of this change, retiring the
   create-time dual-support path per Decision 1)" from the THEN clause so the scenario reads as a
   plain assertion. A scenario whose title says "still succeeds" and whose body asserts a 400 is
   exactly the contradiction round 1 asked to remove, and it will be read by the executor as the
   authoritative behavior statement.

### Non-blocking notes

- Task 2.4 ("budget-trimming behavior doesn't silently drop the new field") still does not name
  which trimming implementation it targets. The spec scenario it points at lives under
  `workspace-context-assembly`, so it plainly means the backend `WorkspaceContextBudget`, not
  `context.ts`'s own tiers — worth making explicit so `context.ts`'s trimming isn't silently
  skipped when task 2.5 adds a field there too.
- Round-1's note stands and is not reflected: `RestSourceConnectorMigration.splitUrl` must not be
  deleted as "now unused" once `createRest`'s bare-url arm stops calling it — it has other callers
  inside `RestSourceConnectorMigration.scala`. Consider adding that to task 1.2's checklist.
