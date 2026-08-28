## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived every load-bearing claim from the live tree in this worktree, from scratch.

**Round-1 items that are now genuinely fixed (verified, not just "touched"):**

- **CR-1 / CR-2 — `ProposalRestApiConfig` is genuinely new and `RestApiConfigPayload` is left
  alone.** `PipelineProposalProtocol.scala:26` today is `restConfig: Option[RestApiConfigPayload]`,
  decoded at line 90 by the file's own hand-written reader
  (`config.map(_.convertTo[RestApiConfigPayload])`) inside `pipelineProposalSourceFormat` (line 69,
  doc-commented at 62 as deliberately hand-written). Swapping only that one type is mechanically
  possible and touches none of `CreateSourceRequest` (`DataSourceProtocol.scala:177`),
  `SourceService`, `DataSourceConfigCodec`, or `AssistantToolExecutor`. `RestApiConfigPayload`'s
  `jsonFormat11` (`DataSourceProtocol.scala:405`) stays untouched — correct, and the design's
  "no jsonFormat11→12 anywhere" claim now holds.
- **`resolveRestSource` exists under that exact name** —
  `PipelineProposalService.scala:208`, building `CreateSourceRequest(inlineName(source),
  DataSourceKind.RestApi, cfg, fieldOverrides = None)`. Decision 2's "one small adapter function"
  claim holds: the adapter has to map exactly the 9 fields `ProposalRestApiConfig` shares with
  `RestApiConfigPayload` (`endpoint`/`method`/`queryParams`/`headers`/`body`/`bodyContentType`/
  `rootSelector`/`parameters` + `connectorId`), leaving `url`/`auth` as `None`. Field-by-field
  comparison against `DataSourceProtocol.scala:142-158` confirms the shapes line up.
- **`apply` really does re-run `validateStructure`** — `PipelineProposalService.scala:84`. The
  belt-and-suspenders claim holds.
- **CR-4 — gate wiring is now correct.** `package.json:8` is `"lint": "eslint . --max-warnings=0"`;
  `.husky/pre-commit` runs `npm run check:scala-quality` as its own line (between
  `check:openspec:selftest` and `npm test`). Adding `check:no-credential-leak` as a sibling line is
  exactly the live pattern. Design + task 3.2 + Gate-Chain checklist all now say this consistently.
- **CR-3 — spec-delta wording matches the schema.** `schemas/pipelines/pipeline-proposal.schema.json:35`
  literally states "this schema does not enforce mutual exclusivity". The delta's scenario now says
  `PipelineProposalService.validateStructure` returns a validation error, and Decision 5 explains
  why `check:schemas` is unaffected. Consistent.
- **CR-7 — Decision 3 point 7 carrier statement is present** and matches Decision 1's boundary.
- **CR-6 — 4b is respecified against real carriers** (`location.state`, Redux snapshot, outbound
  request enumeration) with its own demonstrated-red step in task 3.4. Sound as written.
- `ConnectorCredentialField.tsx` still exists at `frontend/src/features/connectors/ui/`; the
  `createConnector` thunk lives at `frontend/src/features/connectors/state/connectorsSlice.ts`
  (design/tasks say bare `connectorsSlice.ts` — harmless, but see notes).

**What I found wrong (fresh grep output, reproduced):**

```
$ grep -rniIl "credential" helio-mcp/src/ | sort
helio-mcp/src/context.ts
helio-mcp/src/helioApi.ts
helio-mcp/src/tools/read.ts
helio-mcp/src/tools/restDataSourceSchema.test.ts
helio-mcp/src/tools/restDataSourceSchema.ts
helio-mcp/src/tools/write.ts
helio-mcp/src/types.ts          -> SEVEN files, not five

$ grep -rniIl "credential" backend/src/main/scala/com/helio/services/workspace/
(no output; exit 1)          -> ZERO files

$ find backend -name WorkspaceContextProtocol.scala
backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala
                             -> NOT under services/workspace
```

```
AssistantProposalToolSchemas.scala:122-125
  "Inline-source branch — the per-kind config payload selected by type: rest_api
   {connectorId, endpoint?, method?, queryParams?, headers?} (connectorId must reference an
   already-created Connector; auth lives on the Connector, never here — a bare 'url' legacy
   shape is dual-supported but resolved ephemerally, never persisting a Connector); ..."

SourceService.scala:99-117   case (None, Some(url)) => ... synthesizes an implicit Connector
                             (only rejected when connectorRepo == null, line 106)
```

```
frontend/src/features/pipelines/types/pipelineProposal.ts:16-21
  export interface PipelineProposalSource { sourceId?; type?; name?; config?: Record<string,unknown> }
PipelineProposalProtocol.scala:77   s.restConfig.foreach(v => fields("config") = v.toJson)
                             -> the WIRE/TS key is `config`, never `restConfig`
```

### Verdict: REFUTE

Decisions 1, 2, 3 and 5 are now sound and I confirm them — the proposal-only-type correction is
real, the adapter claim holds, the gate wiring matches the live tree, and the 4b respecification
turns a vacuous test into a genuine backstop. The remaining objections are all in Decision 4c
(the enumeration test, which reproduces round 1's CR-5 defect at a new file) and in one
unexamined consequence of dropping `url` from the new proposal-only type.

### Change Requests

1. **Decision 4c's helio-mcp allow-list is five files; the real grep returns seven — the test
   would fail red on its first run for the wrong reason.** `grep -rniIl "credential" helio-mcp/src/`
   also matches `helio-mcp/src/tools/restDataSourceSchema.ts` and
   `helio-mcp/src/tools/restDataSourceSchema.test.ts` — the very file design.md 4c cites as
   `rejectCredentialField`'s home. Add both to the allow-list in design.md and task 3.5 (with
   their one-line safety reason: they *reject* credential fields, they don't carry them), or state
   explicitly that the test excludes `*.test.ts` and re-derive the list under that exclusion.

2. **Decision 4c's `services/workspace` root matches zero files for the token `credential`, so
   the "pin `ConnectorSummary`'s safe shape" purpose is not achieved by the mechanism chosen.**
   `grep -rniIl "credential" backend/src/main/scala/com/helio/services/workspace/` returns nothing:
   `WorkspaceContextService.scala` names `ConnectorSummary`, not `credential`. A token-`credential`
   enumeration over that root is vacuously green forever and would *not* fail "the moment that
   stops being true" (a leak via a renamed field, or via `ConnectorSummary` gaining a field, is
   invisible to it). If the intent is a change-detector on the connector→model surface — which the
   AC's "direction 1" does require — specify the mechanism that actually detects it: pin
   `ConnectorSummary`'s formatter arity/field set (`ConnectorEntityProtocol.scala:38`, `jsonFormat4`
   over id/name/kind/host) and/or assert the serialized `WorkspaceContext` payload for a workspace
   with a credentialed Connector contains none of that Connector's credential bytes. State it as
   its own assertion, separate from the token grep.

3. **`WorkspaceContextProtocol.scala` is not under `services/workspace` — it is
   `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala`.**
   design.md 4c and task 3.5 both assert those two files "live" under the `services/workspace`
   root, and then allow-list the protocol file. That is exactly round 1's CR-5 defect (an
   allow-list entry outside its own scan roots) reproduced at a new file. Correct the path in
   both artifacts.

4. **Dropping `url` from `ProposalRestApiConfig` is an unacknowledged capability removal, and the
   model is still prompted to emit it.** design.md's Context says "the bare-`url` legacy path is
   rejected and out of scope" — not true on the proposal path: `resolveRestSource`
   (`PipelineProposalService.scala:208`) hands `cfg` to `SourceService.createRest`, whose
   `case (None, Some(url))` arm (`SourceService.scala:99-117`) *succeeds* by synthesizing an
   implicit Connector (it only fails when `connectorRepo == null`, line 106). Meanwhile
   `AssistantProposalToolSchemas.scala:124` tells the model verbatim that "a bare 'url' legacy
   shape is dual-supported". After this change, a model-emitted `config.url` is silently dropped by
   the new reader and then rejected by `validateRestConfig` as "neither branch present". Either
   (a) keep `url` on `ProposalRestApiConfig` and make the guard exactly-one-of
   `connectorId`/`url`/`newConnector` (proposal.md's own "What Changes" bullet already describes it
   that way — it currently contradicts design.md's `// Deliberately NO url field`), or
   (b) keep the removal and add an explicit task to strike the "bare 'url' legacy shape is
   dual-supported" sentence from `AssistantProposalToolSchemas.scala:122-125` and to state the
   removal as an intentional narrowing in proposal.md's Non-Goals. Task 1.3 currently only *adds*
   `newConnector` prose. Also reconcile proposal.md ("The legacy bare-`url` path is out of scope
   for proposals") with design.md — right now they read as agreeing while describing two different
   type shapes.

5. **The frontend/wire key is `config`, not `restConfig` — Decision 3, task 2.2 and the
   `pipeline-proposal-review-ui` delta all instruct against a field that does not exist
   client-side.** `PipelineProposalProtocol.scala:77` writes `fields("config") = v.toJson`, and
   `frontend/src/features/pipelines/types/pipelineProposal.ts:16-21` types
   `PipelineProposalSource.config?: Record<string, unknown>` (deliberately loose, no per-kind
   discrimination). An executor following "scan every `restConfig.newConnector`" would write
   `proposal.source.restConfig` and get `undefined` with no type error on the loose record.
   Restate the frontend-side detection in wire terms (`source.type === "rest_api"` &&
   `source.config?.newConnector`), and say whether task 2.2's helper narrows that
   `Record<string, unknown>` into a typed shape or reads it defensively — currently unspecified,
   and it is the one place a silent no-op would make the whole feature invisibly dead.

### Non-blocking notes

- `schemas/pipelines/pipeline-proposal.schema.json:54` documents `rest_api -> {url, method?, auth?,
  headers?}` in its `config` description — already stale (no `connectorId`, still advertises
  `auth`), and CR-4 makes it more so. Decision 5's "no task touches the schema" is defensible for
  *validation*, but a one-line description refresh would be cheap and is contract documentation.
- `createConnector` lives in `frontend/src/features/connectors/state/connectorsSlice.ts`; design
  and task 2.1 say `connectorsSlice.ts` without the `state/` segment. Harmless, worth fixing while
  editing.
- Task 3.5's "assert `services/assistant` and `com/helio/ai` currently match zero files" is
  verified correct against the live tree (`com/helio/ai/` contains only the ten `Claude*` files +
  `HttpClaudeTransport.scala`/`README.md`, none matching `credential`). That baseline-pinning
  instinct is right — CR-2 is asking for the same rigor applied to the workspace surface, where the
  grep does not do the job.
- Environmental, unchanged from round 1: this worktree's `scripts/concertino/` lacks
  `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh`; I used the main checkout's copies.
