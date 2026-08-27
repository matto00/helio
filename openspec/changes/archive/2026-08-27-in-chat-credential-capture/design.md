## Context

Research (pre-Planning, see `ticket.md` premise notes) established:

- `connectorId` is already the primary path for REST sources everywhere (`POST /api/sources`,
  proposal apply); the bare-`url` legacy path is dual-supported (`SourceService.createRest`
  synthesizes an implicit Connector) and is NOT touched or extended by this change — kept exactly
  as-is on the new proposal-only type (round 2 CR-4).
- Proposal generation is connector-*aware only via prompting* (the tool schema tells the model to
  call `list_connectors` first) — there is no existence check, and no way for the model to say
  "this needs a Connector we don't have."
  `PipelineProposalService.validateStructure`/`validateSourceReference` never check
  `restConfig.connectorId` existence today — only `sourceId` (existing-source branch) is checked.
- No MCP tool creates/updates Connectors; `ConnectorMeta`/`ConnectorSummary` are structurally
  incapable of carrying a credential (allow-listed fields, no spread).
- No existing proposal-review page has a "missing prerequisite, capture it inline" pattern — this
  is genuinely new UI, though `CombinedProposalReview.tsx`'s `<section aria-label="...">`
  convention and `ProposalReview.tsx`'s local-`useState`-alongside-proposal-data pattern are
  reusable precedent.
- HEL-616 (mechanical secret-in-logs guard) is **not merged** — cannot depend on it. The
  established prior art for "mechanical, demonstrated-red" enforcement in this repo is HEL-460's
  `HasSecrets[T]` type-level opt-in + `SecretRedaction.redact` + a serialization test asserting
  absence, and `check-scala-quality.mjs`'s AST/text-pattern lint (already wired into
  `npm run check:scala-quality` / Husky) for the Scala side. This design reuses both patterns,
  adapted to TypeScript/frontend for the new surface.

## Decision 1 — Where the credential form lives (the security-boundary question)

The form is mounted **on the existing proposal-review pages** (`PipelineProposalReview`,
`CombinedProposalReview`, `ProposalReview`), not inside the chat drawer itself. Rationale, not an
open product question:

- The ticket's own text: "the chat surface renders a dynamic credential form inline... part of
  the proposal-review flow, not a detour out of it" — every existing proposal kind already leaves
  the chat drawer for its own review route (`ProposalHandoff.tsx`'s `navigate(...,
  {state:{proposal}})`, unchanged since HEL-739). A form embedded in the chat transcript itself
  would be the one true architectural fork worth escalating — it is not what is being built here.
- This keeps the boundary crisp: the chat drawer / `AssistantConversation` Redux state / any
  chat-message-persistence payload **never mounts, imports, or references** the credential
  component or its value at all — not "redacted before persisting," structurally absent from that
  part of the tree. That is what makes Decision 3's enforcement checkable by import-graph
  inspection rather than by runtime redaction (a strictly stronger guarantee).

## Decision 2 — Proposal schema: the `newConnector` draft branch, on a NEW proposal-only type

**Correction (skeptic-design-1.md CR-1/CR-2):** `RestApiConfigPayload` is **not** proposal-only —
it is `CreateSourceRequest.config` (`DataSourceProtocol.scala:177`), the live `POST /api/sources`
request body, and is consumed by `SourceService`, `SourcePreviewRoutes`, `PipelineService`,
`AssistantToolExecutor` (an agent-facing tool-verification type), and `DataSourceConfigCodec` (the
stored-JSONB codec). Adding a field to it would leak into all of those. Instead:

A **new, proposal-only type**, decoded by `PipelineProposalProtocol`'s own hand-written,
absent-optional-tolerant reader (the file's existing doc comment already calls this pattern out —
`PipelineProposalSource` itself is already a proposal-specific flattening of the real per-kind
config types, so this follows the file's own established convention rather than introducing a new
one):

```scala
// Proposal-only — never used by CreateSourceRequest/SourceService/DataSourceConfigCodec/
// AssistantToolExecutor. Lives in PipelineProposalProtocol.scala alongside PipelineProposalSource.
final case class ProposalRestApiConfig(
    connectorId: Option[String] = None,     // references an existing Connector
    url: Option[String] = None,             // legacy bare-URL path — UNCHANGED, still dual-supported
                                             // (CR-4 round 2: SourceService.createRest's
                                             // `case (None, Some(url))` arm synthesizes an implicit
                                             // Connector and succeeds; AssistantProposalToolSchemas
                                             // already prompts the model that this is dual-supported —
                                             // dropping it here would silently break that path)
    newConnector: Option[NewConnectorDraft] = None, // drafts a not-yet-existing one
    endpoint: Option[String] = None,
    method: Option[String] = None,
    queryParams: Option[Map[String, String]] = None,
    headers: Option[Map[String, String]] = None,
    body: Option[String] = None,
    bodyContentType: Option[String] = None,
    rootSelector: Option[String] = None,
    parameters: Option[Map[String, String]] = None
)

final case class NewConnectorDraft(
    name: String,
    baseUrl: String,
    authType: String,               // "none" | "bearer" | "api_key" — mirrors ConnectorAuthType
    apiKeyName: Option[String],
    apiKeyPlacement: Option[String], // "header" | "query"
    retrievalInstructions: String    // model-authored prose: where a human gets this key. NEVER a secret value.
)
```

`PipelineProposalSource.restConfig` changes type from `Option[RestApiConfigPayload]` to
`Option[ProposalRestApiConfig]` — this is the ONE proposal-side type touched; `RestApiConfigPayload`,
`CreateSourceRequest`, `SourceService`, `PipelineService`, `AssistantToolExecutor`, and
`DataSourceConfigCodec` are all **untouched** by this change (no `jsonFormat11`→`jsonFormat12`
anywhere — `RestApiConfigPayload`'s own formatter is never touched). `NewConnectorDraft` has no
field capable of holding a credential — this is what makes "the model can describe the need
without ever holding the secret" true by construction, not by convention.

**Exactly-one-of guard, with a named home (CR-2, updated round 2 CR-4):** `PipelineProposalService.
validateStructure` → a new `validateRestConfig(cfg: ProposalRestApiConfig): Either[ServiceError, Unit]`
requires exactly one of `connectorId`/`url`/`newConnector` present — `url` is kept (round 2 CR-4:
the legacy bare-URL path genuinely still works end-to-end via `SourceService.createRest`'s
`case (None, Some(url))` arm, which synthesizes an implicit Connector; dropping it from the
proposal-only type would silently break a path the model is still prompted to use). This is
proposal-side validation only — it never touches `RestApiConfigPayload.toDomain` (which stays
exactly as it is today, still only reachable from the real `POST /api/sources` path with its own
`connectorId`/`url` guard, now provably untouched by this change since `ProposalRestApiConfig`
never converts through it).

**Resolving `newConnector` before Apply:** when the frontend creates the real Connector (Decision
3) and patches its local proposal copy, it replaces the whole `restConfig` object with one that
has `connectorId` set and `newConnector`/`url` cleared — i.e. `apply`'s request body is,
structurally, an ordinary `connectorId`-only `ProposalRestApiConfig` by the time it's submitted
(unchanged from today for a step that always used `connectorId`, and unchanged for a step that
uses the legacy `url` path, which resolves exactly as it does today with no inline-setup UI
involved). `PipelineProposalService.apply`'s existing `resolveRestSource`
(`PipelineProposalService.scala:208`, verified — builds `CreateSourceRequest(inlineName(source),
DataSourceKind.RestApi, cfg, fieldOverrides = None)`) gets one small adapter mapping
`ProposalRestApiConfig`'s 9 shared fields (`connectorId`/`url`/`endpoint`/`method`/`queryParams`/
`headers`/`body`/`bodyContentType`/`rootSelector`/`parameters`) into
`RestApiConfigPayload` before calling `sourceService.createRest` exactly as it does today — **this
one small adapter function is the only change `apply`'s existing code path needs**; no new typed
apply-time error, no `newConnector` branch reaches `apply` at all (the frontend guarantees this,
and `validateStructure`'s exactly-one-of check, re-run inside `apply` as it already is today at
`PipelineProposalService.scala:84`, would reject an `apply` call that still carried a
`newConnector` before ever reaching `resolveRestSource` — belt-and-suspenders, not new
complexity).

`AssistantProposalToolSchemas` is updated to document `newConnector`: use it only after
`list_connectors`/`find` found no suitable existing Connector; `retrievalInstructions` must
describe where to obtain the key (e.g. "Generate an API key at https://dashboard.stripe.com/apikeys")
and must never contain an actual key value (the model has none to leak, by construction — but the
prompt states this defensively, and the frontend's rendering treats the string as
display-only, not as a value that can flow anywhere near `ConnectorCredentialFieldValue`).

## Decision 3 — Frontend: detection + inline setup section

**Wire-key correction (round 2 CR-5):** client-side, `PipelineProposalSource` has no typed
`restConfig` field at all — `frontend/src/features/pipelines/types/pipelineProposal.ts` types it
as `config?: Record<string, unknown>` (a single, deliberately loose per-kind bag; the backend's
`restConfig` name is a Scala-side-only field, serialized onto the shared wire key `"config"` by
`PipelineProposalProtocol.scala`'s writer, `fields("config") = v.toJson`). The detection helper
(task 2.2) therefore reads `proposal.source.type === "rest_api"` and narrows
`proposal.source.config` into a locally-defined `ProposalRestApiConfigClient` shape (mirroring the
backend `ProposalRestApiConfig` fields: `connectorId?`, `url?`, `newConnector?`, ...) rather than
trusting the loose `Record<string, unknown>` blindly — a runtime shape check (not just a TS cast),
since a malformed/absent field here must degrade to "no unresolved reference" rather than throwing,
given the untyped wire contract. This is stated explicitly so the helper is written against reality
rather than a `restConfig` field that does not exist on the client type.

Each proposal-review page, on load (and after every local edit that could add/remove a REST
step), computes a list of **unresolved connector references**: every REST step's `config.newConnector`
(a draft, needs creation), plus every `config.connectorId` not present in the already-loaded
`connectorsSlice` list (fetched the same way the REST source form's picker already does — HEL-827
— so no new fetch mechanism); a step whose `config.url` is set (no `connectorId`/`newConnector`)
is the legacy path and is explicitly excluded from this scan — it resolves through the existing
implicit-Connector mechanism with no inline-setup UI involved, unchanged by this ticket.
`dashboard`-kind proposals have no such field on their type at all — the scan is a no-op for that
kind by construction, not by a runtime branch that could be forgotten.

For each unresolved reference, render a `<section aria-label="Set up connector: <name>">`
(mirrors `CombinedProposalReview`'s existing section convention) containing, top to bottom:

1. The model-authored `retrievalInstructions` (or, for an unresolved bare `connectorId` with no
   draft — a proposal referencing a Connector that existed at generation time but was since
   deleted — a generic "this Connector no longer exists; create a replacement" message with no
   instructions to show).
2. An explicit, non-dismissible statement: *"Agents never see this key — it is enforced in code:
   this form submits directly to your workspace's encrypted credential store and is never part of
   the conversation."* (copy reviewed against DESIGN.md's tone guidance during Execution.)
3. `ConnectorCredentialField` (`mode="create"`) exactly as `CreateConnectorModal` already uses it
   — no new credential-input component.
4. Name/base-URL fields, pre-filled from the draft and editable.
5. A "Create connector" button that dispatches the **existing** `createConnector` thunk
   (`connectorsSlice.ts`) directly — the same action `CreateConnectorModal` dispatches. On
   success, the review page replaces that step's `newConnector`/dangling `connectorId` with the
   returned real `connectorId` in its **local** proposal copy only (never mutates
   `AssistantProposalExtraction`, never round-trips through chat state) and removes that section.
   "Apply proposal" is disabled while any section remains.
6. No reveal control anywhere in this component tree, at any stage, matching
   `ConnectorCredentialField`'s existing `type="password"` behavior — nothing new to build here,
   just nothing to remove.
7. **Carrier statement (CR-7):** the credential value lives only in `InlineConnectorSetup`'s own
   local `useState` for the lifetime of the "Create connector" submit call. It is never written to
   router state (the `navigate(..., {state:{proposal}})` blob `ProposalHandoff.tsx`/the review
   pages already round-trip), never written to `sessionStorage`/`localStorage`, and never
   dispatched into any Redux slice other than the single `createConnector` thunk call whose own
   payload carries it directly to `POST /api/connectors`. The value is discarded (component
   unmounts / section removed) immediately on that call's resolution, success or failure.

This is new code (`InlineConnectorSetup.tsx`, one component reused across all three review pages —
not three copies), using existing primitives (`FormField`, `Section`-equivalent markup,
`ConnectorCredentialField`, `connectorsSlice.createConnector`) per DESIGN.md's shared-primitives
rule.

## Decision 4 — Mechanical, demonstrated-red enforcement (the AC's hard requirement)

Two complementary checks, matching this repo's established "type-level opt-in + serialization
test" and "AST/text-pattern lint + wired into the commit-gate chain" patterns (HEL-460, HEL-616's
still-open design):

**4a. Import-graph lint (new, mirrors `check-scala-quality.mjs`'s approach for TS/JS).**
`scripts/check-no-credential-in-agent-surface.mjs`: statically walks the import graph rooted at
every module under `frontend/src/features/assistant/**` (chat drawers, `proposalExtraction.ts`,
conversation-persistence code) and fails if any of them transitively imports
`ConnectorCredentialField`/`ConnectorCredentialFieldValue`/`InlineConnectorSetup`, or if any object
literal/type declaration in those files declares a property literally named `credential`
(case-insensitive) outside an explicit allow-list.

**Wiring, corrected (CR-4 — verified against the live tree):** `package.json:8`'s `lint` script is
`eslint . --max-warnings=0`; `check:scala-quality` is its **own separate line** in
`.husky/pre-commit`, never composed into `lint` — this design does the same. Add
`"check:no-credential-leak": "node scripts/check-no-credential-in-agent-surface.mjs"` to
`package.json`'s `scripts`, and add it as its own new line in `.husky/pre-commit`, immediately
alongside the existing `check:scala-quality` line — a sibling gate, not a `lint` change.

**Demonstrated red**: the executor adds a temporary violating import during Execution (e.g.
threading `ConnectorCredentialFieldValue` into `proposalExtraction.ts`), captures the check's
failing output as evidence, then reverts it before committing — the same "prove the red, then
remove it" pattern `.concertino/laws/verification-before-completion.md` already requires elsewhere
in this repo, and the ticket's own AC text ("Demonstrated red") names explicitly.

**4b. Runtime absence test — respecified against the design's real carriers (CR-6, replacing the
vacuous version).** Decision 1 deliberately means the credential flow never touches assistant/chat
state at all — asserting absence from `AssistantProposalExtraction` would pass for reasons
unrelated to the guard (a test that cannot fail is not evidence). Instead, this test drives the
full flow — render a pipeline-proposal-review page with a `newConnector` step, fill
`ConnectorCredentialField` with a known non-real test value, submit — and asserts, against the
carriers this design *actually has* (per Decision 3's Point 7 carrier statement):
  - the raw test value is **absent** from the `location.state` blob the review route holds
    (`ProposalHandoff.tsx`'s `navigate(..., {state:{proposal}})` pattern) before AND after
    submission;
  - the raw test value is **absent** from a serialized snapshot of the Redux store taken
    immediately after submission (asserts it was never dispatched into any slice other than the
    one `createConnector` call);
  - across every outbound HTTP request the test's mocked transport captures, the raw test value
    appears in the `POST /api/connectors` request body **and no other request**.
**Demonstrated red (CR-6):** the executor temporarily has `InlineConnectorSetup` also write the
value into router state (e.g. via a `navigate(..., {state:{...}, replace:true})` call) or a second
Redux slice, confirms this test fails, captures the failure, then reverts — the same red/green
discipline as 4a, applied to the behavioral backstop rather than only the structural check.

**4c. Backend enumeration (the AC's "enumerate every surface, verify each — in both directions"),
roots and allow-list corrected against fresh grep output (round 2 CR-1/2/3).** Two separate
mechanisms, since a single token-grep cannot do both jobs (round 2 CR-2 finding: a grep over
`services/workspace` for the literal string `credential` returns zero hits — `WorkspaceContextService`
carries `ConnectorSummary` by field reference, never the word "credential" — so a token grep there
would be vacuously green forever and never actually detect a leak):

- **Token-grep change-detector**, scanned over `backend/src/main/scala/com/helio/ai/` (the real
  path — `services/ai` does not exist; verified empty today), `backend/src/main/scala/com/helio/services/assistant/`
  (verified empty today), and `helio-mcp/src/` for the literal token `credential`
  (case-insensitive). The test asserts the first two roots currently match **zero** files
  (asserted explicitly, not silently allow-listed), and that every `helio-mcp/src/` match is one
  of the **seven** files fresh `grep -rniIl "credential" helio-mcp/src/` actually returns (round 2
  CR-1 — corrected from an earlier five-file list that missed two): `types.ts`, `helioApi.ts`,
  `tools/read.ts`, `context.ts`, `tools/write.ts`, `tools/restDataSourceSchema.ts`,
  `tools/restDataSourceSchema.test.ts` — each pinned with a one-line reason:
  `restDataSourceSchema.ts`/`.test.ts` implement and test `rejectCredentialField` (they *reject*
  credential fields, they don't carry them); `read.ts`/`write.ts` reference that same guard;
  `helioApi.ts`/`types.ts`/`context.ts` type-reference `ConnectorSummary`, which has no
  credential-capable field.
- **Structural pin on the connector→model surface (round 2 CR-2, replacing the vacuous
  workspace-root grep; round 3 CR-2 — location corrected)**: `WorkspaceContextService.scala`
  (verified location: `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala`)
  puts `Vector[ConnectorSummary]` into the model's workspace context. `ConnectorSummary`'s wire
  formatter (`jsonFormat4` over `{id, name, kind, host}`) is declared in
  `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala:38`
  (`jsonFormat4` call at line 98) — **not** in `WorkspaceContextProtocol.scala`
  (`backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala`),
  which only imports `ConnectorSummary`'s formatter and declares four unrelated `jsonFormat4`s of
  its own for other workspace-context types. This design cites the formatter under its real
  declaring file. A dedicated test asserts (a) `ConnectorEntityProtocol`'s `ConnectorSummary`
  formatter's field count/name set directly (fails if a field is ever added without a matching
  update to this test — the actual "pin", not a token search), and (b) that a serialized
  `WorkspaceContext` payload (built via `WorkspaceContextProtocol`, the type `WorkspaceContextService`
  actually returns) for a workspace containing a Connector with a known non-real test credential
  does not contain that credential string anywhere in its JSON. This is what answers the AC's
  "direction 1" (does anything already send a credential toward the model) with a mechanism that
  can actually detect a future regression, not just today's absence of the word "credential" in a
  file that was never going to contain it under that name.

Direction 2 (can the model send a credential *back* as tool input) is answered by the existing
`rejectCredentialField` Zod refinement in `helio-mcp/src/tools/restDataSourceSchema.ts` — add an
explicit regression test exercising it directly if `restDataSourceSchema.test.ts` doesn't already
cover the rejection case by name (it is already in the allow-list above precisely because it
implements this guard).

## Gate-Chain Implications Checklist (CON-132 — a new line is added to `.husky/pre-commit`)

- **What does it execute?** `scripts/check-no-credential-in-agent-surface.mjs`, a pure static
  import-graph + text-pattern walk over `frontend/src/**` (no network, no subprocess beyond `fs`
  reads), invoked via a new `package.json` script (`check:no-credential-leak`) added as its own new
  line in `.husky/pre-commit`, immediately alongside the existing `check:scala-quality` line —
  corrected per skeptic CR-4: it is NOT composed into the `lint` script (`eslint . --max-warnings=0`),
  which is a separate, unmodified line.
- **What environment does it inherit, and from where?** Whatever Husky's pre-commit hook already
  provides today (repo-root `node`/`npm`, no new env vars) — identical to `check-scala-quality.mjs`'s
  existing wiring (its own separate pre-commit line), which this mirrors verbatim.
- **Does it write anything outside its own sandbox?** No — read-only filesystem walk, stdout/exit
  code only, same as `check-scala-quality.mjs`.
- **Does it behave differently from a linked worktree than from a main checkout?** No — it walks
  `frontend/src` relative to the invoking `cwd`, identically in either case; no worktree-specific
  path assumption.
- **What happens on its first run?** It runs against the full existing `frontend/src/features/assistant/**`
  tree (not just this change's new files) — the executor must confirm zero false positives against
  the pre-existing surface before wiring it into `lint` (i.e. run it once standalone first, exactly
  as `check-scala-quality.mjs`'s own AC required for its own first run).

## Decision 5 — JSON Schema stays unconstrained; enforcement is service-level (CR-3)

`schemas/pipelines/pipeline-proposal.schema.json` types `PipelineProposalSource.config` as an
unconstrained `{"type":"object"}` and its own description explicitly disclaims mutual exclusivity
("resolving which branch wins when both are present is an apply-time concern"). This design does
not tighten that schema — the exactly-one-of guard (Decision 2) is enforced at the SERVICE layer
(`PipelineProposalService.validateRestConfig`), not at JSON-Schema-validation time, consistent
with the schema's own stated intent and its `config` field being deliberately generic across all
four inline source kinds. The spec-delta scenario wording is corrected to say "service validation
rejects" rather than "the document fails schema validation" (see the corrected
`pipeline-proposal-contract` delta). No task touches `schemas/pipelines/pipeline-proposal.schema.json`,
and `npm run check:schemas` (`scripts/check-schema-drift.mjs`) is unaffected since the schema
itself is unchanged.

## Risks / Trade-offs

- **New UI pattern, no existing precedent** (Decision 3) — genuinely new code, reviewed carefully
  against DESIGN.md and the four canonical breakpoints during Execution/Evaluation/Skeptic gates.
- **Text-pattern lint (4a) can have false negatives** if credential-shaped data is threaded through
  an untyped bag under a different property name — 4b's runtime test is the deliberate backstop for
  exactly this gap, not redundant with 4a.
- **`dashboard`-kind AC is satisfied vacuously** (no source/connector data on that proposal type) —
  stated explicitly here rather than silently assumed, so a reviewer can confirm it's a fact about
  the schema, not an unhandled case.
