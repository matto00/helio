# Design — HEL-845 reject a mismatched-kind Connector

## Context

Established by probe against `main` at `e01aa6d4` before this document was written (full record:
`.concertino/runs/HEL-845/evidence/premise-validation.md`). Three independent layers currently
have the information needed to reject a REST-source-to-non-REST-Connector binding, and none of
them looks:

| Layer | File / line | Current behavior |
| --- | --- | --- |
| Picker | `ConnectorSelectField.tsx:37` | maps every Connector into options; no kind predicate |
| Create boundary | `SourceService.createRest` + `RestApiConfigPayload.toDomain` (`DataSourceProtocol.scala:388-404`) | validates `connectorId` structurally (non-empty, not a reserved sentinel); never loads the Connector, so cannot see `kind` |
| Fetch choke point | `RestApiConnectorDriver.resolveConnector` (lines 72-85) | returns `Right(c)` on any resolved Connector; `:143` then joins `connector.baseUrl` into the request URI |

## Decision 1 — The guarantee is server-side; the UI filter is an affordance

**Both layers ship, and they are not co-equal.** This is stated here because the ticket asks for
it explicitly and because getting it wrong reproduces HEL-827's defect inverted.

- **Guarantee (enforcement):** the server-side kind check. Nothing can bind a REST source to a
  non-`rest_api` Connector, whether the caller is the form, `curl`, or the agent/MCP surface.
- **Affordance (usability):** the picker filter. It keeps a user out of a known-bad state before
  they can enter it. It enforces nothing and must never be the only thing standing between a
  caller and the bad state.

Rejected alternative: **UI-only filtering.** It satisfies the ticket's headline sentence and
leaves the actual defect fully reachable through the agent surface that HEL-828 built — the exact
"wrong thing that looks like a right thing" class this ticket is filed against.

Rejected alternative: **server-only, no picker change.** Technically sufficient, but it makes the
form offer choices it then rejects on submit, which is HEL-827's complaint (UI/API divergence)
pointed the other way.

## Decision 2 — Two server-side checkpoints, for two different populations

**2a. Create-time, in `SourceService.createRest`
(`backend/src/main/scala/com/helio/services/sources/SourceService.scala:91-133`).** Inserted on the
`(Some(connectorId), None)` branch at the exact position *after* the existing
`rejectBodyOnSafeMethod` check and immediately before `createRestWithConfig` writes any row (note
this is after `rejectBodyOnSafeMethod`, not directly after `toDomain`). Use
`DataSourceKind.RestApi` (`domain/model/DataSource.scala:187`) rather than an inline `"rest_api"`
literal; the frontend filter necessarily uses the raw string. The Connector is resolved with `connectorRepo.findByIdOwned(ConnectorId(cid), user)` —
owner-scoped, so this check cannot be used as an existence oracle for another tenant's
Connector ids. A non-`rest_api` `kind` yields
`ServiceError.BadRequest("Connector <name> is a 'sql' Connector; a REST source requires a 'rest_api' Connector")`
— names both kinds, names the Connector by its user-visible **name**, never by id, baseUrl, or
credential material.

This covers *new* bindings from every surface at once: `PipelineProposalService:359` and
`PipelineService:754` both create REST sources through this same `SourceService.createRest`
entry point, so the agent/MCP path inherits the guard without a second implementation.

**2b. Fetch-time, in `RestApiConnectorDriver.resolveConnector`.** After the Connector resolves and
before `buildResolvedRequest` composes a URI or `credentialRepoOpt.decryptForUse` decrypts
anything, a non-`rest_api` `kind` short-circuits to a curated `Left`. Ordering is load-bearing and
is an assertion, not a comment: no HTTP request is issued to the foreign `baseUrl`, and no
credential is decrypted for a mismatched binding.

2b is not redundant with 2a. 2a cannot reach rows that already exist — mismatched bindings are
creatable on `main` today, so this ticket must assume they exist in real databases. 2b is the only
thing that makes those rows behave predictably (AC 5). This placement also honors HEL-826's
invariant, restated in this ticket: **decode is total; validation belongs at create-time or at the
request-issuing choke point, never in the decode path.** `RestApiConfigPayload.toDomain` and
`DataSourceConfigCodec` are therefore deliberately left alone.

## Decision 3 — No update-path check, because there is no update path

`UpdateDataSourceRequest` is `(name: Option[String])` — `DataSourceProtocol.scala:129`. The source
`PATCH` route (`DataSourceRoutes.scala:102`) can rename a source and nothing else; there is no
contract by which a stored `connectorId` can be changed after creation.

**An acceptance criterion or test asserting "update rejects a mismatched kind" would be describing
an unreachable code path, and must not be written.** The spec delta carries this as an explicit
negative statement so a later reader does not mistake the absence for an oversight. If a
config-mutating update contract is ever added, it inherits this requirement and the check must be
added with it.

## Decision 4 — `connectorRepo == null` fails closed, and fixtures get wired

`SourceService`'s constructor takes `connectorRepo: ConnectorRepository = null` (line 40) for test
fixtures that never wire one. The create-time check needs that repo.

**Fail closed:** when `connectorRepo` is null and the request carries a `connectorId`, reject
rather than skip the check. A fail-open default here would mean the guarantee silently evaporates
in exactly the configuration a future refactor is most likely to introduce, and "the check didn't
run" would be indistinguishable from "the check passed."

**Measured, so the executor does not re-derive it:** 7 test files construct a `SourceService`;
exactly **2** exercise a `connectorId` path — `SourceServiceSpec.scala` (lines 110/121) and
`RestConnectorEgressGuardSpec.scala` (lines 261/314) — and **both already pass a real
`connectorRepo`**. The two fixtures passing none (`PipelineRootRoutesSpec.scala:124,140`,
`PipelineAnalyzeProposalRoutesSpec.scala:146`) contain zero `connectorId` references. Fail-closed
is therefore safe and costs no fixture rewrites. If the executor nonetheless finds a fixture that
would have to be relaxed, that is an escalation, not a licence to fail open.

## Decision 5 — Empty state, and what the picker does with an already-bound mismatch

- The picker lists only `kind === "rest_api"` Connectors. `Connector.kind` is already on the client
  (`connectors/types/connector.ts:35`); no API change, and deliberately **no** `?kind=` filter
  parameter added to `GET /api/connectors` — that would be new API surface whose only consumer is
  a filter the client can already apply, and it would move a decision to the server that is
  presentational.
- When the filtered list is empty, the control is replaced by an explanatory empty state that says
  no REST Connector exists yet and offers the existing inline "create new Connector" flow, per
  `DESIGN.md`'s empty-state pattern (`empty-state-cta-pattern`). The distinguishing test is that
  the explanation text is present — not merely that the option list has length zero.
- **There is deliberately no "already-bound mismatched Connector" affordance in the picker,
  because the picker is create-only.** `ConnectorSelectField` is mounted from exactly one place
  (`RestApiForm.tsx:56`), rendered only by `AddSourceModal.tsx:499` — a *create* modal. Its
  `connector` state is `useRestSourceForm.ts:71`'s `useState<Connector | null>(null)`, never
  hydrated from an existing source, and by Decision 3 no contract can change a stored
  `connectorId` anyway. The picker therefore can never be mounted with a pre-selected mismatched
  Connector. Building a warning for that state would be building an untestable affordance for an
  unreachable code path — the same error Decision 3 refuses to make. (Independently, it would not
  even work: `Select.tsx:44` computes `selected = options.find((o) => o.value === value) ?? null`,
  so a filtered-out Connector renders as the bare placeholder, not as itself.) AC 5 —
  "any existing source bound to a mismatched Connector behaves predictably" — is satisfied
  entirely by Decision 2b's fetch-time guard, which is the only layer such a source can reach.

## Decision 6 — No migration

No schema change, no data backfill. Existing mismatched rows are handled at read/fetch time by 2b,
not rewritten. A backfill would have to guess a replacement Connector, and there is no correct
guess. Main is at V102; this change adds no migration, so it cannot collide with the shared
`flyway_schema_history` or with concurrent runs HEL-890/HEL-973.

## Decision 7 — Contract surface: the OpenSpec delta *is* the contract record

Verified by search, not assumed: **there is no OpenAPI document in this repo.** `find` for
`openapi*` / `*.openapi.*` returns nothing; `openspec/` holds OpenSpec capability markdown, not
OpenAPI, despite `CLAUDE.md`'s wording. `schemas/sources/` contains only
`field-override-payload.schema.json` and `static-column-payload.schema.json` — there is no
REST-source create-request schema and no error-surface documentation to amend.

The only schema file in the repo carrying `connectorId` is
`schemas/pipelines/create-pipeline-request.schema.json`, which sits in the pipelines schema
directory the coordinator declared **HEL-973-owned**. Editing it would race a concurrent run.

**Therefore: no `schemas/` edit is made in this change.** The OpenSpec spec delta under
`specs/rest-api-connector/` is the contract record for the new `400`. `CLAUDE.md`'s
"same change" rule is satisfied — the contract artifact that exists for this endpoint is updated
in this change; the ones it names do not exist for this endpoint. If a reviewer believes a
`schemas/` file should describe the REST source create request, that is a new ticket, not a
silent expansion of this one into HEL-973's files.

## Evidence plan

The ticket's AC 4 demands a red test, and the coordinator's standard demands the red arm be shown
capable of firing. Concretely:

1. **Create-time guard (backend, ScalaTest).** Write the test first against unmodified
   `SourceService.createRest`: create a `sql`-kind Connector, POST a REST source referencing it,
   assert a `400` naming both kinds. **Run it and capture it failing** — on `main` this returns a
   success, so the red arm demonstrably fires. Then implement 2a and show it green. The failure
   must isolate to the kind check: a sibling case creating a REST source against a `rest_api`
   Connector must stay green throughout, proving the guard did not simply break creation.
2. **A `400` assertion is not enough on the success arm.** Per the HEL-590 lesson, the
   matching-kind test must assert on the created source's returned `connectorId`/config content,
   not merely that the call returned `201`.
3. **Fetch-time guard (backend).** Construct a source whose stored `connectorId` points at a
   non-`rest_api` Connector — i.e. the pre-existing-row case, which must be built by writing the
   row directly, since 2a will (correctly) prevent creating it through the service. Assert the
   curated error, and assert **no** outbound request was attempted and **no** credential
   decryption occurred.

   **The no-decrypt assertion is vacuous by default and must be built so it can fail.**
   `buildResolvedRequest` has `credentialRepoOpt match { case None => Future.successful(Right("")) }`
   — a driver fixture with no credential repo never decrypts anything, so a naive assertion passes
   whether or not the guard exists. The spec MUST wire a **recording**
   `ConnectorCredentialRepository` (or an equivalent call-counting seam) and assert the recorded
   `decryptForUse` call count is zero.

   **Named mutation proving the two assertions are separate axes:** move the guard from
   `resolveConnector` to *after* `decryptForUse` but *before* URI composition. That mutation MUST
   fail the no-decrypt assertion while leaving the no-request assertion green. If both go red
   together, they are one axis wearing two labels and the evidence does not hold. (The ordering
   genuinely supports this: `decryptForUse` runs strictly before `joinUrl`/`Uri` composition.)
4. **Picker filter (frontend, Jest).** Render with a mixed Connector list; assert the option list
   contains the `rest_api` Connector and does not contain the other. This is a content assertion
   on the rendered options, not a focus or visibility assertion — **jsdom has no layout, so any
   focus/visibility claim here would be vacuous by construction** and must not be written.
5. **Live demonstration (AC 1) is Playwright, not Jest.** AC 1 says "demonstrated live, not
   asserted from the filter expression." The evaluator/skeptic must observe the real form in a
   real browser with both Connector kinds present. If `start-servers.sh` reports "already
   healthy … reusing", the JVM may predate this change (CON-155, unfixed): verify freshness
   functionally by issuing a request only the new code can satisfy — e.g. the create-time `400`
   from step 1 — or kill the JVM and restart before observing anything.
6. **Credential hygiene.** Fixtures use obviously-fake credential values. No real secret is
   logged, echoed, committed, or written into a fixture or ticket comment.
