## 1. Establish the red arm (before any implementation)

- [x] 1.1 Write a backend spec case: create a `sql`-kind Connector, then call
      `SourceService.createRest` (or POST the source route) with that `connectorId`. Assert a
      `400` whose message names both `rest_api` and `sql`.
- [x] 1.2 **Run it against unmodified code and capture the failure output** into the change's
      evidence. Confirm it fails because creation *succeeded*, not because of a fixture or
      compilation error — a red arm that cannot fire for the intended reason is not a red arm.
- [x] 1.3 Write the frontend Jest case asserting the picker's rendered options exclude a
      non-`rest_api` Connector; run it against unmodified `ConnectorSelectField` and capture it
      failing.

## 2. Server-side guarantee — create-time (design.md Decision 2a)

- [x] 2.1 In `SourceService.createRest`, on the `(Some(connectorId), None)` branch, after
      `RestApiConfigPayload.toDomain` succeeds and before `createRestWithConfig`, resolve the
      Connector via `connectorRepo.findByIdOwned(ConnectorId(cid), user)` and reject a
      non-`rest_api` `kind` with `ServiceError.BadRequest` naming both the expected and actual
      kind, and the Connector's name (never its id, baseUrl, or credential).
- [x] 2.2 Fail closed when `connectorRepo == null` (Decision 4): reject rather than skip.
- [x] 2.3 Confirm the two fixtures that exercise the `connectorId` create path
      (`SourceServiceSpec.scala` lines 110/121, `RestConnectorEgressGuardSpec.scala` lines
      261/314) already pass a real `connectorRepo` — measured at design time, so this should be a
      no-op. Do **not** relax the check to accommodate a fixture; escalate rather than fail open.
- [x] 2.4 Confirm the unresolvable-`connectorId` case still returns its existing curated
      "Connector not found" rather than a new kind-mismatch message.
- [x] 2.5 Confirm the bare-`url` branch is untouched: it synthesizes its own `rest_api` Connector
      and must not acquire a new failure mode.
- [x] 2.6 Add a spec case proving the agent/MCP path inherits the guard — `PipelineProposalService`
      / `PipelineService` create REST sources through this same entry point.
- [x] 2.7 Turn 1.1 green. Add the matching-kind sibling case and assert on the **returned
      source's content** (its `connectorId`/config), not merely the status/`Right` — a status
      assertion is not a content assertion (HEL-590).

## 3. Server-side guarantee — fetch-time (design.md Decision 2b)

- [x] 3.1 In `RestApiConnectorDriver.resolveConnector`, reject a resolved Connector whose `kind`
      is not `rest_api` with a curated `Left` naming the mismatch, placed so it short-circuits
      before URI composition and before `decryptForUse`.
- [x] 3.2 Spec: a stored source bound to a `sql`-kind Connector (row written directly, since 2a
      now prevents creating one through the service) fails with the curated error at the
      `resolveConnector` seam. Note `resolveConnector` is a single seam and the ephemeral
      bare-url path (`RestApiConnectorDriver.scala:443`) never resolves a Connector at all — if
      infer/test-connection on the ephemeral shape does not route through `resolveConnector`,
      that is expected; record it rather than manufacturing a fourth call site.
- [x] 3.3 Assert **no outbound request was attempted** and **no credential decryption occurred**.
      The no-decrypt assertion is vacuous unless built to fail: `credentialRepoOpt match { case
      None => Future.successful(Right("")) }` means a fixture with no credential repo never
      decrypts regardless of the guard. Wire a **recording** `ConnectorCredentialRepository` (or
      equivalent call-counting seam) and assert the `decryptForUse` call count is zero.
- [x] 3.3a Demonstrate the two assertions are separate axes with the named mutation: move the
      guard to *after* `decryptForUse` but *before* URI composition. It MUST fail the no-decrypt
      assertion while leaving the no-request assertion green. If both go red together they are one
      axis wearing two labels — report that rather than papering over it.
- [x] 3.4 Confirm a `rest_api` Connector still resolves and fetches exactly as before (regression
      guard for the whole existing REST path).
- [x] 3.5 Assert on the curated error string directly that it does NOT contain the Connector id
      substring, its baseUrl, or credential material — a substring assertion, not an eyeball.

## 4. UI affordance (design.md Decision 5)

- [x] 4.1 Filter `ConnectorSelectField`'s options to `kind === "rest_api"`.
- [x] 4.2 Replace the bare empty control with an explanatory empty state when the filtered list is
      empty, retaining the inline "create new Connector" affordance. Follow `DESIGN.md` /
      `empty-state-cta-pattern`; assert on the explanation **text**, not on option-count alone.
- [x] 4.3 Do **not** build an "already-bound mismatched Connector" warning. The picker is
      create-only (`ConnectorSelectField` ← `RestApiForm.tsx:56` ← `AddSourceModal.tsx:499`;
      `useRestSourceForm.ts:71` initializes `connector` to `null` with no hydration), so that
      state is unreachable — see design.md Decision 5. AC 5 is satisfied by the fetch-time guard
      in section 3, not here.
- [x] 4.4 Turn 1.3 green. Write no focus/visibility assertions in jsdom — they are vacuous there.

## 5. Contract (design.md Decision 7)

- [x] 5.1 Make **no** `schemas/` edit. Verified at design time: no OpenAPI document exists in the
      repo, `schemas/sources/` has no REST-source create-request schema, and the only schema
      carrying `connectorId` is `schemas/pipelines/create-pipeline-request.schema.json` — inside
      the HEL-973-owned pipelines directory. The OpenSpec delta under `specs/rest-api-connector/`
      is the contract record. See design.md Decision 7.
- [x] 5.2 Confirm no migration is added (Decision 6), no `?kind=` parameter is added to
      `GET /api/connectors`, and nothing under `schemas/pipelines/` is touched.

## 6. Verification

- [x] 6.1 `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check` from `frontend/`.
- [x] 6.2 `sbt test` from `backend/`.
- [x] 6.3 Live browser demonstration of AC 1 and AC 3 with both Connector kinds present. If
      `start-servers.sh` reports "already healthy … reusing", verify JVM freshness functionally
      (issue a request only the new code satisfies) or kill and restart the JVM first (CON-155).
- [x] 6.4 Confirm no file owned by concurrent runs HEL-890 or HEL-973 was touched.
- [x] 6.5 Confirm no real credential appears in any diff, fixture, log, or comment.
