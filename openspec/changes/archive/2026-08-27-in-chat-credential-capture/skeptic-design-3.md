## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Re-derived every load-bearing claim from the live worktree from scratch (not from rounds 1/2).

**Round-2 CRs that are genuinely fixed:**

- **CR-1 (helio-mcp allow-list).** Fresh `grep -rniIl "credential" helio-mcp/src/` returns exactly
  seven files: `context.ts`, `helioApi.ts`, `tools/read.ts`, `tools/restDataSourceSchema.test.ts`,
  `tools/restDataSourceSchema.ts`, `tools/write.ts`, `types.ts`. design.md 4c and task 3.5 now list
  those seven with per-file reasons. `rejectCredentialField` is real
  (`helio-mcp/src/tools/restDataSourceSchema.ts:31`, applied to `auth`/`apiKey`/`token`/`password`/
  `credential` at :54-58) and `restDataSourceSchema.test.ts:8` names it — the "they reject, they
  don't carry" reason is accurate. **Fixed.**
- **CR-3 (protocol path).** `find backend -name WorkspaceContextProtocol.scala` →
  `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala`.
  design.md 4c and tasks now cite that path. **Fixed.**
- **CR-2, partially — the vacuous grep is gone and replaced by a real structural mechanism.**
  I re-confirmed the vacuity finding: `grep -rniIl "credential"` over
  `backend/src/main/scala/com/helio/{ai,services/assistant,services/workspace}/` returns nothing
  (exit 1) — so the token-grep-over-`services/workspace` is correctly no longer the mechanism.
  The replacement (pin the `jsonFormat4` field set + assert a serialized `WorkspaceContext` payload
  for a workspace with a credentialed Connector carries none of the credential bytes) is coherent
  and would actually detect a future regression. `ConnectorSummary` is genuinely `jsonFormat4` over
  `{id,name,kind,host}` (`ConnectorEntityProtocol.scala:38-43`, formatter at :98), and
  `WorkspaceContextProtocol.scala:221` genuinely carries `connectors: Vector[ConnectorSummary]`.
  The mechanism is sound; only its cited *home* is wrong (CR-2 below).
- **CR-5 (client wire key).** `frontend/src/features/pipelines/types/pipelineProposal.ts:17-22`
  types `PipelineProposalSource` as `{sourceId?, type?, name?, config?: Record<string,unknown>}` —
  no `restConfig`. `PipelineProposalProtocol.scala`'s writer emits `fields("config") = v.toJson`
  for all four kinds. design.md Decision 3's opening paragraph and task 2.2 now state exactly this
  (`proposal.source.config`, narrowed via a runtime shape check into `ProposalRestApiConfigClient`,
  degrading to "no unresolved reference" rather than throwing). **Fixed in design.md and tasks.md**
  — but not in the review-ui spec delta (CR-3 below).
- **CR-4 (`url` kept).** Verified the underlying fact: `SourceService.createRest`'s
  `case (None, Some(url))` arm (SourceService.scala:99+) really does synthesize an implicit
  no-auth Connector via `ImplicitConnectorConfig.forLegacySource` and succeed (only failing when
  `connectorRepo == null`). design.md's type block, Context, Decision 2 guard, proposal.md's
  "What Changes", and the `pipeline-proposal-contract` delta all now say
  exactly-one-of `connectorId`/`url`/`newConnector`. **Fixed in those four places — but tasks.md
  was not updated to match (CR-1 below).**

**Other live-tree checks (all pass):** `PipelineProposalSource.restConfig: Option[RestApiConfigPayload]`
(PipelineProposalProtocol.scala:26) with the hand-written `read` decoding `rest_api` →
`RestApiConfigPayload`; `apply` re-runs `validateStructure` (PipelineProposalService.scala:84);
`resolveRestSource` builds `CreateSourceRequest(inlineName(source), DataSourceKind.RestApi, cfg,
fieldOverrides = None)` (:208); `package.json:8` `"lint": "eslint . --max-warnings=0"` and
`.husky/pre-commit` runs `check:scala-quality` as its own line before `npm test`;
`ConnectorCredentialField.tsx`, `CreateConnectorModal.tsx`, `connectors/state/connectorsSlice.ts`
(`createConnector` thunk at :53), `assistant/proposalExtraction.ts`,
`assistant/ui/ProposalHandoff.tsx`, `dashboards/ui/ProposalReview.tsx`,
`pipelines/ui/proposalReview/PipelineProposalReview.tsx`, `proposals/ui/CombinedProposalReview.tsx`
all exist at the cited paths; `CombinedProposal` is `{pipeline: PipelineProposal, dashboard:
DashboardProposal}` and `DashboardProposal` is `{dashboardName, panels}` — the design's
"dashboard-kind is vacuous by construction" claim is a verified fact about the type, not an
assumption.

### Verdict: REFUTE

Three of the five round-2 CRs are cleanly fixed, and the 4c two-mechanism split is now coherent in
substance. But two of the corrections were applied to design.md/proposal.md and **not propagated**
to the artifact the executor actually works from (tasks.md), and the 4c structural pin cites a file
that does not contain the thing being pinned — the same class of path defect CR-3 was about.

### Change Requests

1. **tasks.md 1.2 and 1.4 still specify the `url`-dropped guard, directly contradicting design.md,
   proposal.md and the `pipeline-proposal-contract` delta.** Task 1.2: "add `validateRestConfig`
   (exactly one of `connectorId`/`newConnector`)"; task 1.4: "`validateRestConfig` accepting exactly
   one of `connectorId`/`newConnector` and rejecting two/zero". Everything else in the change now
   says **`connectorId`/`url`/`newConnector`**. An executor implementing tasks.md verbatim
   reintroduces exactly the CR-4 defect: a model-emitted `config.url` (which
   `AssistantProposalToolSchemas.scala:122-125` still advertises as dual-supported, and which
   `SourceService.createRest:99` still genuinely resolves) is rejected as "neither branch present".
   Update both tasks to the three-way exactly-one-of.
   Relatedly, task 1.2's adapter is scoped to "a **resolved (connectorId-only)**
   `ProposalRestApiConfig`" — but the `url` branch must also flow through that same adapter into
   `RestApiConfigPayload.url` (design.md's field list includes `url`). As written the executor may
   legitimately drop `url` in the adapter and break the legacy path anyway. Say "connectorId-only
   **or url-only**" and name `url` in the mapped fields.

2. **design.md 4c cites `ConnectorSummary`'s formatter as living in `WorkspaceContextProtocol.scala`;
   it does not.** 4c reads "its wire type, `ConnectorSummary`/`WorkspaceContextProtocol.scala`
   (verified location, round 2 CR-3 — this file lives under `api/protocols/workspace/`) is
   `jsonFormat4` over `{id, name, kind, host}`". Ground truth:
   `ConnectorSummary` is declared at
   `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala:38` and its
   `jsonFormat4(ConnectorSummary.apply)` is at **ConnectorEntityProtocol.scala:98**;
   `WorkspaceContextProtocol.scala` merely *imports* it (line 4) and holds four unrelated
   `jsonFormat4`s (`WorkspaceContextCounts`/`DataSource`/`Column`/`PipelineStep`, lines 231-248).
   An executor writing the "pin the formatter field set" test against the cited file would either
   find no such formatter or pin the wrong one. Correct the citation in design.md 4c (and mirror it
   in task 3.5, which says only "pinning `ConnectorSummary`'s `jsonFormat4` field set" with no path
   at all — give it the real one): declaration + formatter in
   `api/protocols/sources/ConnectorEntityProtocol.scala`, consumed as
   `connectors: Vector[ConnectorSummary]` at `api/protocols/workspace/WorkspaceContextProtocol.scala:221`.

3. **The `pipeline-proposal-review-ui` spec delta was not updated for CR-5 — it still specifies the
   UI against `restConfig`, a field that does not exist client-side.** Round 2's CR-5 named this
   delta as one of three places; design.md and task 2.2 were fixed, the delta was not. It says
   "a `restConfig.newConnector` draft, or a `restConfig.connectorId` that does not match…",
   "whose REST source step carries `restConfig.newConnector`", and "whose
   `pipeline.source.restConfig` carries `newConnector`". The client type is
   `PipelineProposalSource.config?: Record<string, unknown>` and the wire key is `"config"`.
   Restate the requirement and its three scenarios in wire terms
   (`source.type === "rest_api"` and `source.config.newConnector` / `source.config.connectorId`),
   or add one explicit sentence to the requirement stating that `restConfig` is the Scala-side name
   for the wire key `config` so the delta is not read as naming a client field.

### Non-blocking notes

- design.md Decision 2 says the adapter maps "`ProposalRestApiConfig`'s **9** shared fields" and
  then lists **10** (`connectorId`/`url`/`endpoint`/`method`/`queryParams`/`headers`/`body`/
  `bodyContentType`/`rootSelector`/`parameters`). The list is right; the count is off by one —
  a leftover from before `url` was restored.
- Gate-Chain checklist's "What happens on its first run?" bullet still ends "…before wiring it into
  `lint`", which contradicts the (correct) CR-4 wiring decision stated three bullets above it
  (a sibling `.husky/pre-commit` line, `lint` unchanged). Stale phrasing only.
- proposal.md's "What Changes" describes the mechanical-enforcement lint as scanning for imports
  "outside an explicit allow-list (`ConnectorCredentialField`, `connectorsSlice`, the new setup
  component)" — but design.md 4a's rule is that `frontend/src/features/assistant/**` may not
  import those at all. The proposal's phrasing reads as allow-*listing* the very things 4a forbids.
  Design.md is the operative statement; a one-line proposal.md rewording would remove the
  ambiguity.
- proposal.md Non-Goals says "The legacy bare-`url` inline-source path is unchanged — still out of
  scope (HEL-822)" while "What Changes" says `url` is carried on the new type. Both are true
  (carried, not extended), but reading them together is briefly confusing.
- `frontend/src/features/connectors/state/connectorsSlice.ts` — design.md Decision 3 point 5 and
  task 2.1 still say bare `connectorsSlice.ts` (round-2 note, unfixed; harmless).
