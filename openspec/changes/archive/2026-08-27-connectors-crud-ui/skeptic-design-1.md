## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/connectors/connector-management/spec.md`, `specs/connectors-page-ui/spec.md`.
- **HEL-822 cycle-2 fix A — `implicit` server-owned on POST and PATCH: CONFIRMED present.**
  `backend/src/main/scala/com/helio/services/sources/ConnectorEntityService.scala` —
  `withServerOwnedImplicit(config, implicitFlag)` is the single funnel; `create` passes
  `implicitFlag = false`, `update` passes the EXISTING row's parsed
  `ConnectorAuthShape.parse(existing.config).implicit`, and both strip any client-supplied
  `implicit` key (`config.fields - "implicit" + (...)`).
- **HEL-822 cycle-2 fix B — no-auth Connector creation: CONFIRMED present.** Same file, `create`:
  `else if (cred.isEmpty && authType != "none")` → BadRequest, i.e. an empty credential is
  accepted when `config.authType == "none"`.
- **`ConnectorRepository.scala`** read in full: `create` is the two-step
  (credentialRepo.create → connectors insert) + compensation pattern; `update` explicitly
  "Never touches `credential_id` -- rotation is a distinct, not-yet-built operation"; `delete`
  gates on the injected `dependentCount` and deletes the credential row. No `updateCredentialId`
  exists today (consistent with tasks 1.2 adding it).
- **`ConnectorCredentialRepository.scala`** read in full: `create` (encrypt-then-insert, fails
  closed on `MasterKeyError`), `get`, `list`, `decryptForUse`, `delete`, `rewrapAllBelow` — the
  primitives design.md Decision 1 claims to reuse do exist with the claimed semantics.
- `ConnectorEntityRoutes.scala` + `ConnectorEntityProtocol.scala`: no rotation route/type today;
  PATCH rejects credential-ish fields with 400; `ConnectorMeta` structurally cannot carry a secret.
- Wiring sites of the service: `grep -rn "new ConnectorEntityService"` →
  `backend/src/main/scala/com/helio/api/ApiRoutes.scala:449` and
  `backend/src/test/scala/com/helio/api/routes/sources/ConnectorEntityRoutesSpec.scala:92`.
  Current constructor is `(connectorRepo, dependentCount)` — **no `credentialRepo` parameter**.
- Dependents data: `DataSourceRepository.countRestSourcesReferencing(connectorId)` exists
  (`DataSourceRepository.scala:223`) and is injected into the service **only** as the delete guard.
  No route, service method, or response field exposes a dependent count or list to a client.
- Connection-test ground truth: `SourceService.testRest` (lines 198-214) accepts
  `RestApiConfigPayload` with **exactly one of `connectorId` or `url`**, and **rejects any
  `auth` field outright** ("auth is not accepted on a REST source — auth lives on the referenced
  Connector"). `frontend/src/features/sources/ui/TestConnectionAffordance.tsx` exists.
- Touch-target sweep: `e2e/hel813-mobile-touch-target-floor.spec.ts` currently ends at
  `surface 6: panel-list zoom/add controls` — design.md Decision 5's "surface 7" numbering is correct.

### Verdict: REFUTE

The rotation escalation decision itself is sound and grounded — the primitives design.md Decision 1
relies on genuinely exist, and both HEL-822 cycle-2 claims check out against the tree. Three
specific defects block: one acceptance criterion with no coverage anywhere, one design claim that
contradicts the actual code layering (and a missing wiring task that follows from it), and one
under-specified AC that the current backend contract would silently break.

### Change Requests

1. **AC 4's "dependent sources are visible from the Connector" is uncovered by any task, spec
   requirement, or backend path.** The ticket is explicit: "Show which sources depend on a
   Connector — this is what makes deletion safe and *is the main reason the page earns its place
   over a modal*." The plan only surfaces dependents *reactively*, on a blocked delete
   (`tasks.md` 3.7, `specs/connectors-page-ui/spec.md` "Deletion surfaces dependents clearly"),
   and even that is hedged: 3.7 says "fetch/display the dependent count or list **if the backend
   response carries it**". Ground truth: it does not. `ConnectorEntityService.delete` returns
   `ServiceError.Conflict("ConnectorHasDependents: this Connector is still referenced by a
   dependent resource")` — a fixed string with no count and no ids — and no read path exposes
   `countRestSourcesReferencing`. Required: decide and specify a dependents read path (e.g.
   include a dependent count on `ConnectorMeta`/list, or a `GET /api/connectors/:id/dependents`),
   add the corresponding backend tasks + a `connector-management` spec scenario, add a UI task +
   `connectors-page-ui` requirement for showing dependents on the row/detail proactively (not
   only on a 409), and remove the "if the backend response carries it" conditional from 3.7.

2. **design.md Decision 1 places rotation in `ConnectorEntityService` on a stated rationale that
   is factually wrong about the current code, and tasks.md omits the wiring that placement
   requires.** Decision 1 says rotation "mirror[s] `create`'s existing pattern" and has the
   service "call `credentialRepo.create` then `connectorRepo.updateCredentialId`", with
   "best-effort delete ... mirroring `create`'s own existing compensation pattern". But that
   pattern does not live in the service — it lives in `ConnectorRepository.create`
   (`ConnectorRepository.scala`, the `credentialRepo.create(...).flatMap { ... }.recoverWith`
   block). `ConnectorEntityService` today has **no** `ConnectorCredentialRepository` dependency at
   all, and its own scaladoc states it "Never calls `ConnectorCredentialRepository.decryptForUse`";
   `ConnectorRepository`'s scaladoc states that repository is where the "actual encrypted-secret
   lifecycle" is delegated. Required: either (a) move rotation's two-step-plus-compensation
   orchestration into `ConnectorRepository.rotateCredential(...)` — the placement that actually
   mirrors `create` — leaving `ConnectorEntityService.rotateCredential` as thin
   validation + `findByIdOwned` ACL dispatch like every other method there; or (b) keep it in the
   service but correct Decision 1's rationale and add explicit tasks for the new
   `credentialRepo` constructor parameter **and** both call sites that must be updated
   (`ApiRoutes.scala:449` and `ConnectorEntityRoutesSpec.scala:92`), plus a justification for
   diverging from the documented repository-owns-the-credential-lifecycle boundary. Also update
   `ConnectorRepository.update`'s "rotation is a distinct, not-yet-built operation" comment as
   part of whichever option is chosen.

3. **Connection-test invocation shape is unspecified and the obvious reading is now a 400.**
   `tasks.md` 3.8 and the `connectors-page-ui` "Connection-test reuses the existing affordance"
   requirement say only "reuse `TestConnectionAffordance`/`POST /api/sources/test` ... for testing
   a Connector's configuration". Per `SourceService.testRest`, the endpoint requires **exactly one
   of `connectorId` or `url`** and **rejects any `auth` field** — so testing a *saved* Connector
   must post `{ type: "rest_api", config: { connectorId } }` (server-side resolution via
   `ConnectorResolveContext.Owned`), and the intuitive "send the base URL + the auth the user just
   typed" call fails with 400. This matters doubly because the saved credential is unreadable
   client-side, so there is no client-side fallback. Required: state the exact payload in
   design.md/tasks 3.8, and specify whether test is offered in the create form *before* the
   Connector exists (where no `connectorId` exists yet — either drop it there or specify the
   `url`-only ephemeral path and its no-auth limitation).

### Non-blocking notes

- Decision 2 (implicit Connectors visible + badged) is well-argued and consistent with
  `ConnectorAuthShape.parse(...).implicit` being the real, server-owned flag — no objection.
- Rotation's ordering (mint new → repoint `credential_id` → best-effort delete old) is correct
  with respect to the `connectors.credential_id` reference; the orphaned-row risk is genuinely
  identical to `create`'s already-accepted gap, not a new one.
- Task 1.3's "validates non-empty new credential" leaves rotation of an `authType: "none"`
  Connector (whose stored credential is legitimately empty) unaddressed. Minor — worth one
  sentence, but not blocking.
