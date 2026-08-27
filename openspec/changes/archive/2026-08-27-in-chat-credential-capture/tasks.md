## 1. Backend — proposal schema + prompting

- [x] 1.1 Add `NewConnectorDraft` + `ProposalRestApiConfig` case classes (new types, in
      `PipelineProposalProtocol.scala`) — do NOT touch `RestApiConfigPayload`,
      `CreateSourceRequest`, `SourceService`, `DataSourceConfigCodec`, or `AssistantToolExecutor`.
      Change `PipelineProposalSource.restConfig`'s type from `Option[RestApiConfigPayload]` to
      `Option[ProposalRestApiConfig]`. Add spray-json formatters for the two new types.
- [x] 1.2 `PipelineProposalService`: add `validateRestConfig` (exactly one of
      `connectorId`/`url`/`newConnector` — `url` is KEPT, not dropped: the legacy path still works
      end-to-end via `SourceService.createRest`'s implicit-Connector synthesis), wired into
      `validateStructure`. Add the small adapter that converts a resolved `ProposalRestApiConfig`
      (either `connectorId` set, or the unchanged `url` legacy branch — never `newConnector`, which
      is guaranteed resolved by the frontend before `apply` is called) into a
      `RestApiConfigPayload(connectorId=..., url=..., ...)` inside `resolveRestSource`, mapping all
      shared fields (`connectorId`/`url`/`endpoint`/`method`/`queryParams`/`headers`/`body`/
      `bodyContentType`/`rootSelector`/`parameters`) — this is the only change to `apply`'s existing
      code path. Confirm `apply` re-runs `validateStructure` (as it already does today) so a request
      that still carries `newConnector` is rejected before reaching `resolveRestSource`.
- [x] 1.3 `AssistantProposalToolSchemas`: document the `newConnector` branch — when to use it
      (no suitable existing Connector after `list_connectors`), that `retrievalInstructions` must
      describe where to find the key and must never contain a key value.
- [x] 1.4 Backend tests: round-trip JSON for `ProposalRestApiConfig`/`NewConnectorDraft`,
      `validateRestConfig` accepting exactly one of `connectorId`/`url`/`newConnector` and
      rejecting any combination of two or all-zero, `resolveRestSource`'s adapter producing the
      same `RestApiConfigPayload` shape `apply` produced before this change for BOTH the
      `connectorId`-only case AND the legacy `url`-only case (regression-proof the
      untouched-apply-path claim for both existing branches, not just one).

## 2. Frontend — detection + inline setup UI

- [x] 2.1 `InlineConnectorSetup.tsx` (new, shared — `frontend/src/features/connectors/ui/` or a
      new `proposalReview` co-location, single component reused by all three review pages): props
      = the unresolved reference (draft or dangling id) + `onResolved(connectorId)`. Renders
      retrieval instructions, the "agents never see this key" statement, `ConnectorCredentialField`
      (`mode="create"`), name/baseUrl fields, submit button dispatching `createConnector` directly.
- [x] 2.2 Detection helper (pure function, unit-tested): given a `PipelineProposal`/
      `CombinedProposal` and the current connector list, return the list of unresolved REST-step
      connector references. Reads the wire-real `proposal.source.config` (a loose
      `Record<string, unknown>` client-side — NOT a `restConfig` field, which doesn't exist on the
      TS type), narrowing it into a local `ProposalRestApiConfigClient` shape with a runtime shape
      check (degrades to "no unresolved reference" on a malformed/absent field, never throws).
      Excludes a step whose `config.url` is set (legacy path, unchanged, no inline-setup UI).
      No-op for `DashboardProposal` (no such field exists on that type).
- [x] 2.3 Wire into `PipelineProposalReview.tsx`, `CombinedProposalReview.tsx` (pipeline half
      only), and confirm `ProposalReview.tsx` (dashboard) needs no wiring (cite the schema fact
      from design.md Decision 3, don't silently skip it).
- [x] 2.4 "Apply proposal" button disabled while any unresolved reference remains; local proposal
      copy is patched (draft/dangling id → real `connectorId`) on each successful creation.
- [x] 2.5 DESIGN.md pass: shared `FormField`/section primitives, all four canonical breakpoints
      (430/768/1100/1440), 44px touch targets (HEL-813 sweep).

## 3. Mechanical enforcement (the AC's hard requirement)

- [x] 3.1 `scripts/check-no-credential-in-agent-surface.mjs`: import-graph + text-pattern walk
      over `frontend/src/features/assistant/**`, failing on any transitive import of the
      credential-carrying types/components or a `credential`-named property. Run standalone first
      against the pre-existing tree to confirm zero false positives (design.md Gate-Chain
      Checklist "first run").
- [x] 3.2 Wire `check:no-credential-leak` into `package.json` `scripts` AND as its own new,
      separate line in `.husky/pre-commit` (a sibling to `check:scala-quality`'s line — NOT
      composed into the `lint` script, which stays `eslint . --max-warnings=0` unchanged). Confirm
      via `npx husky install` / a real commit attempt in this worktree that it actually fires
      (HEL-768: Husky's `npm test` is silently vacuous inside a worktree — verify this specific
      new line, not just trust the wiring).
- [x] 3.3 **Demonstrated red**: temporarily thread a violating reference into
      `proposalExtraction.ts`, run the check, capture the failing output as evidence (redact
      nothing sensitive — this fixture uses no real credential), then revert before committing.
- [x] 3.4 Frontend runtime test (4b, respecified): full flow (render → fill
      `ConnectorCredentialField` with a known non-real test value → submit) — assert the value is
      absent from the review route's `location.state` blob before/after, absent from a
      post-submission Redux store snapshot, and present in the `POST /api/connectors` request body
      and no other captured outbound request. **Demonstrated red**: temporarily have
      `InlineConnectorSetup` also write the value into router state or a second Redux
      dispatch, confirm this test fails, capture the failure, then revert.
- [x] 3.5 Backend enumeration test (4c, corrected roots + two-mechanism split — round 2):
      (a) token-grep change-detector over `backend/src/main/scala/com/helio/ai/` and
      `backend/src/main/scala/com/helio/services/assistant/` (assert both currently match ZERO
      files for `credential`) and `helio-mcp/src/` (assert every match is one of the seven actual
      files: `types.ts`, `helioApi.ts`, `tools/read.ts`, `context.ts`, `tools/write.ts`,
      `tools/restDataSourceSchema.ts`, `tools/restDataSourceSchema.test.ts` — NOT the earlier
      five-file list, which missed the two `restDataSourceSchema*` files); (b) a separate
      structural test pinning `ConnectorSummary`'s `jsonFormat4` field set directly (not a token
      grep, since `services/workspace` never contains the literal word "credential" — a token grep
      there would be vacuously green forever) AND asserting a serialized `WorkspaceContext` payload
      for a workspace with a credentialed Connector contains none of that credential's bytes.
      Also add an explicit regression test exercising `helio-mcp`'s existing `rejectCredentialField`
      refinement if `restDataSourceSchema.test.ts` doesn't already cover the rejection case by
      name.

## 4. Verification

- [x] 4.1 `sbt test` (account for the known ~13-14 environmentally-failing specs when
      `CONNECTOR_MASTER_KEY` is unset in `backend/.env` — confirm the exact count, don't wave it
      through).
- [x] 4.2 `npm test`, `npm run lint`, `npm run typecheck`.
- [x] 4.3 Live verification: restart dev servers fresh (HEL-742 stale-Vite-cache precedent), drive
      a real pipeline proposal end-to-end through chat → review → inline connector setup → apply,
      with a **fake, clearly-non-real** API key value, confirming: no reveal after entry, proposal
      applies once resolved, and the credential is genuinely absent from the browser's network
      tab's non-`/api/connectors` requests and from any visible conversation/log surface.
- [x] 4.4 Screenshots to the scratchpad only, never the repo root.
