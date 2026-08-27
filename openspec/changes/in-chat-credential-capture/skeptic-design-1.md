## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas. Then checked
every load-bearing claim against the live tree.

- **`ConnectorCredentialField` exists and is reusable** — `frontend/src/features/connectors/ui/ConnectorCredentialField.tsx:22`
  exports `ConnectorCredentialFieldValue { authType, credential, apiKeyName, apiKeyPlacement }`,
  `mode: "create" | "rotate"`, header comment explicitly written for HEL-829 reuse. **Claim holds.**
- **`ConnectorSummary` is allow-listed** — `ConnectorEntityProtocol.scala:38` + `jsonFormat4`
  (id/name/kind/host), projected via `fromDomain`. **Claim holds.** (Design's `ConnectorMeta` is
  loose naming for `ConnectorMetadata` in `domain/connectors/ConnectorDriver.scala:51` — harmless.)
- **`helio-mcp` `rejectCredentialField` exists** — `helio-mcp/src/tools/restDataSourceSchema.ts:31`,
  applied to `auth`/`apiKey`/`token`/`password`/`credential` (lines 54-58), with an existing
  `restDataSourceSchema.test.ts`. **Claim holds.**
- **`PipelineProposalService` never existence-checks `restConfig.connectorId`** — `validateStructure`
  (line 95) → `validateInlineSource` (126) → `requireConfig(source.restConfig)` only. `apply`'s
  `resolveRestSource` (line ~208) passes `cfg` straight to `sourceService.createRest`. **Claim holds.**
- **`RestApiConfigPayload` is NOT proposal-only** — `grep -rn RestApiConfigPayload backend/src/main`:
  it is defined at `api/protocols/sources/DataSourceProtocol.scala:142` and is `CreateSourceRequest.config`
  (line 177), used by `SourceService.create/inferRest/toEphemeral`, `SourcePreviewRoutes` (46, 71),
  `PipelineService:359`, `AssistantToolExecutor:30,191`, and `DataSourceConfigCodec:20,57,71` (the
  persisted JSONB blob codec). **Claim REFUTED.** See CR-1.
- **`npm run lint` is `eslint . --max-warnings=0`** (`package.json:8`); `check:scala-quality` is a
  separate script (line 19) invoked as its own line in `.husky/pre-commit`, not composed into `lint`.
  **Design's wiring claim REFUTED.** See CR-4.
- **`backend/src/main/scala/com/helio/services/ai` does not exist** (`ls` → no such dir; the package
  is `com.helio.ai` per CLAUDE.md), and `grep -rniIl credential backend/.../services/assistant` returns
  **zero files**, while `helio-mcp/src` returns five files the design's allow-list never names
  (`types.ts`, `helioApi.ts`, `read.ts`, `context.ts`, `write.ts`). **Claim REFUTED.** See CR-5.
- **`schemas/pipelines/pipeline-proposal.schema.json`** declares `PipelineProposalSource.config` as a
  bare `{"type":"object"}` with no inner constraints, and documents explicitly that it "does not
  enforce mutual exclusivity". **Spec-delta scenario REFUTED.** See CR-3.

### Verdict: REFUTE

The overall shape (Decision 1's placement, reuse of `ConnectorCredentialField`, dispatching
`createConnector` directly) is sound and I confirm it. Decision 1 in particular is correct and
well-argued: the ticket says "part of the proposal-review flow", every proposal kind already
leaves the chat drawer via `ProposalHandoff.tsx`, and mounting off the assistant subtree is what
makes the import-graph guard meaningful rather than a redaction pass. No objection there.

But Decision 2 rests on a false statement about the live tree, and Decision 4 — the AC's hard
requirement — contains one vacuous test, one test rooted at a nonexistent directory, and an
allow-list that does not intersect its own scan roots. As written, an executor could complete
every task in `tasks.md`, get green, and have demonstrated nothing.

### Change Requests

1. **Decision 2's central premise is false: `RestApiConfigPayload` is the live `POST /api/sources`
   type, not a proposal-only type.** design.md states it is "used only within
   `PipelineProposalProtocol`, not the persisted `POST /api/sources` protocol". It is
   `CreateSourceRequest.config` (`DataSourceProtocol.scala:177`) and is consumed by
   `SourceService`, `SourcePreviewRoutes`, `PipelineService:359`, `AssistantToolExecutor:30`, and
   `DataSourceConfigCodec` (which encodes the *stored* config JSONB). Adding `newConnector` to it
   therefore (a) adds a field to the public source-creation request body, (b) adds it to an
   agent-facing tool-verification type, and (c) risks it being persisted into stored source config.
   Revise Decision 2 to either introduce a **separate proposal-only payload type** (e.g.
   `ProposalRestApiConfigPayload`, decoded by `PipelineProposalProtocol`'s hand-written reader at
   line 90 instead of `RestApiConfigPayload`), or explicitly justify the shared-type choice and
   enumerate/handle every one of the call sites above. State which, and update tasks 1.1/1.2.

2. **The "exactly-one-of" guard has no stated home, and task 1.1 assumes a guard that isn't where
   the design implies.** The only exactly-one-of check is inside
   `RestApiConfigPayload.toDomain` (`DataSourceProtocol.scala:340-346`), which Decision 2 says is
   "untouched". Task 1.1 then says "Extend the proposal-side exactly-one-of guard" — no such
   proposal-side guard exists. Name the exact function that will enforce
   `connectorId` XOR `url` XOR `newConnector` on the proposal path (presumably a new check in
   `PipelineProposalService.validateStructure`/`validateInlineSource`), and state what happens if a
   `newConnector`-carrying payload reaches `toDomain` (today it falls into the `(None, None)` arm →
   "Missing required fields: connectorId or url", which is a confusing error for that input).
   Also: if the shared type is kept, both `jsonFormat11` sites (`DataSourceProtocol.scala:405` and
   `DataSourceConfigCodec.scala:20`) must become `jsonFormat12` — currently mentioned in no task.

3. **Spec delta `pipeline-proposal-contract` scenario "A proposal cannot combine newConnector with
   connectorId or url — THEN the document fails validation" is not satisfiable as written.**
   `schemas/pipelines/pipeline-proposal.schema.json` types `source.config` as an unconstrained
   `{"type":"object"}` and its own description states it "does not enforce mutual exclusivity;
   resolving which branch wins when both are present is an apply-time concern". Either (a) reword
   both scenarios to say *service* validation rather than *document/schema* validation, or (b) add
   an explicit task to tighten the JSON Schema — and note that `npm run check:schemas`
   (`scripts/check-schema-drift.mjs`, a pre-commit gate) is in play either way. No task currently
   touches `schemas/` at all.

4. **Decision 4a's gate wiring is factually wrong and would change `lint`'s semantics.**
   design.md says the new check is "composed into the existing `lint` script Husky's pre-commit hook
   already runs... identical to `check-scala-quality.mjs`'s existing wiring, which this mirrors
   verbatim." Ground truth: `package.json:8` — `"lint": "eslint . --max-warnings=0"`;
   `check:scala-quality` is `package.json:19` and appears as its **own line** in `.husky/pre-commit`,
   never inside `lint`. Revise to add `check:no-credential-leak` as a sibling `npm run` line in
   `.husky/pre-commit` (the actual existing pattern) and correct the Gate-Chain checklist. Task 3.2
   must be updated to match.

5. **Decision 4c scans a directory that does not exist and allow-lists files outside its own scan
   roots — it would be vacuously green or immediately wrong.** Verified:
   `backend/src/main/scala/com/helio/services/ai` **does not exist** (the package is `com.helio.ai`);
   `grep -rniIl credential` under `services/assistant` matches **zero files**; under `helio-mcp/src`
   it matches five files (`types.ts`, `helioApi.ts`, `tools/read.ts`, `context.ts`, `tools/write.ts`)
   that the design's allow-list (`ConnectorEntityService`, `ConnectorEntityRoutes`,
   `ConnectorEntityProtocol`, `ConnectorCredentialRepository`) does not name — and none of those four
   allow-listed sites live under any of the three roots. Fix the roots (use the real `com/helio/ai`
   path) and derive the allow-list from an actual grep of the real roots, pasted into design.md.
   **Additionally: the roots miss the one real connector→model surface.**
   `WorkspaceContextService.scala:248` / `WorkspaceContextProtocol.scala:221` put
   `Vector[ConnectorSummary]` into the model's workspace context — that lives under
   `services/workspace` and is exactly the "direction 1" surface the AC demands be enumerated. It
   must be in scope of the enumeration test (it is safe today — `jsonFormat4`, allow-listed
   projection — which is precisely the fact the change-detector should pin).

6. **Decision 4b (the "runtime absence test") is vacuous by construction and cannot fail.** It
   asserts the credential is absent from "the actual `AssistantProposalExtraction`/conversation-turn
   payload" — but Decision 1 deliberately mounts the form on a *separate route* that, by design,
   never writes to assistant state at all. A test asserting absence from a payload the flow never
   touches passes for reasons unrelated to the guard. Either delete 4b as non-evidence, or
   respecify it against the carriers this design actually has: the `navigate(..., {state:{proposal}})`
   `location.state` blob (`ProposalHandoff.tsx`'s pattern), the serialized Redux store snapshot, and
   the set of outbound request bodies (asserting the credential appears in the `POST /api/connectors`
   body and in **no other** captured request). Whichever is chosen, task 3.4 must also require a
   **demonstrated-red** step for it, exactly as task 3.3 does for 4a — otherwise the AC's
   "its failure mode is tested" is met for the lint only, not for the runtime backstop.

7. **`ProposalHandoff`'s `location.state` is an unexamined carrier.** Decision 3 says the resolved
   `connectorId` is spliced into "the reviewer's local copy of the proposal only", which is right —
   but the design never states what happens to that local copy on navigation/refresh, and
   `ProposalHandoff.tsx` already round-trips proposals through router state. Add one sentence to
   Decision 3 stating that the credential value is held only in component `useState` for the
   lifetime of the submit and is never written to router state, `sessionStorage`, or Redux — and
   make that an assertion in the 4b test per CR-6.

### Non-blocking notes

- The `dashboard`-kind "vacuously satisfied" argument (proposal.md + Decision 3) is correct and
  well-flagged; task 2.3's "cite the schema fact, don't silently skip it" is the right instruction.
- Decision 4a's own admitted false-negative (credential threaded through an untyped bag under a
  different name) is honestly stated. With CR-6 applied, 4b becomes the genuine backstop it claims
  to be; without it, that gap is uncovered.
- Environmental note, not a blocker for this gate: this worktree's `scripts/concertino/` is a
  stale subset (no `next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`). I used the
  main checkout's copies. Worth refreshing before the final gate.
