## 1. Domain model

- [x] 1.1 Add `bodyContentType: Option[String] = None` and `rootSelector: Option[String] = None` to
      `RestApiConfig` (`backend/src/main/scala/com/helio/domain/model/model.scala`); verify `sbt
      compile` succeeds.
- [x] 1.2 Add `body`/`bodyContentType`/`rootSelector` to `EphemeralRestConfig` (design.md Decision 4 —
      `rootSelector` is required here too, not just `body`/`bodyContentType`, since `AddSourceModal`'s
      preview/test affordances run exclusively through this ephemeral path); verify `sbt compile`
      succeeds.
- [x] 1.3 Add `RestApiConfig.rejectBodyOnSafeMethod(method: String, body: Option[String]): Either[String,
      Unit]` helper (Decision 3) and a unit test covering GET+body, HEAD+body, POST+body (accepted),
      GET+no-body (accepted). Add a second helper,
      `RestApiConfig.parseBodyContentType(bodyContentType: Option[String]): Either[String, ContentType]`
      (defaults to `application/json` when `None`, else `ContentType.parse`), with a unit test covering
      unset (defaults), a valid explicit type, and an unparseable string (`Left`). Per design.md's
      decode-is-total invariant (Sweep 3), THIS is the one and only place `bodyContentType` is parsed —
      called from 3.2/3.3, never from `toDomain`.

## 2. Wire payload + validation

- [x] 2.1 Add `bodyContentType`/`rootSelector` to `RestApiConfigPayload`
      (`backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala`); thread
      through `toDomain`/`fromDomain`; verify `sbt compile` and existing `DataSourceProtocol`-related
      tests still pass.
- [x] 2.2 Add ScalaTests against `RestApiConfigPayload.toDomain` proving it stays PERMISSIVE for
      EVERY validation this ticket introduces: a GET+body payload decodes successfully, AND a payload
      with an unparseable `bodyContentType` string decodes successfully too (design.md Decision 3 sweep
      — `toDomain` is shared with `DataSourceConfigCodec.decodeRest`'s read path, so NEITHER new
      validation may live there; both live at the request-building choke points instead — see 3.2/3.3).
      Also assert the PRE-EXISTING `toDomain` validations (`auth` rejection, connectorId/url
      exclusivity, reserved-sentinel rejection) are unchanged by this ticket — regression coverage for
      design.md's Sweep 1 classification.
- [x] 2.3 In `SourceService.createRest`, add a belt-and-braces `rejectBodyOnSafeMethod` call
      (design.md Decision 3's additive UX note) in the `connectorId` branch (`SourceService.scala:89`,
      after `toDomain` succeeds) and the bare-`url` branch (`SourceService.scala:117-122`, before
      constructing `RestApiConfig`, which also needs `body`/`bodyContentType`/`rootSelector` forwarded
      from the payload the same way `method`/`headers` already forward — Decision 5). Add a ScalaTest
      covering an immediate 400 on create for a GET+body request via either branch.
- [x] 2.3b Change `SourceService.toEphemeral`'s signature from `RestApiConfigPayload =>
      EphemeralRestConfig` to `RestApiConfigPayload => Either[String, EphemeralRestConfig]`: forward
      `body`/`bodyContentType`/`rootSelector` (task 1.2 must already carry `rootSelector` on
      `EphemeralRestConfig` for this to compile). This is now optional-but-recommended belt-and-braces
      (the structural guard in 3.3 is what actually prevents the body from being sent) — if implemented,
      update both call sites (`inferRest`'s `(None, Some(_))` branch, `SourceService.scala:~182`, and
      `testRest`'s equivalent branch, `~210`) to short-circuit on `Left` exactly like their existing
      `(Some(_), None)` branches already do for a `Left` from `toDomain`.
- [x] 2.3c In `PipelineService`'s inline `rest_api` dry-analyze path
      (`PipelineService.scala:~368`, the `(None, Some(url))` branch building `EphemeralRestConfig`
      directly), forward `body`/`bodyContentType`/`rootSelector` from `payload` the same way
      `method`/`headers` already forward, so an inline pipeline-proposal POST+body source doesn't
      silently drop its body during dry-analyze (a data-completeness gap, distinct from the GET+body
      safety guard, which 3.3's structural check already covers for this call site regardless of
      whether this forwarding task is done). Add a ScalaTest covering an inline pipeline-proposal
      `rest_api` source with a body inferring correctly.
- [x] 2.4 Update spray-json formats in `backend/src/main/scala/com/helio/api/JsonProtocols.scala` for the
      new fields; verify `sbt compile`.

## 3. Request building

- [x] 3.1 In `RestApiConnectorDriver.resolveTemplatedRequestParts`, add body resolution via
      `TemplateInterpolator.resolveJsonBody(config.body, config.parameters)`, short-circuiting on
      `Left` exactly like the existing endpoint/query/header resolution; extend the method's return
      tuple accordingly and update its one call site in `buildResolvedRequest`.
- [x] 3.2 In `buildResolvedRequest`, call `rejectBodyOnSafeMethod(config.method, config.body)` AND
      `parseBodyContentType(config.bodyContentType)` FIRST — before any templating/URI/entity work —
      short-circuiting to `Left` on GET/HEAD+body OR an unparseable `bodyContentType` (design.md
      Decision 3 sweep: these are the STRUCTURAL safety guards — the create-time belt-and-braces calls
      in 2.3 are additive UX only, and cover only `rejectBodyOnSafeMethod`, not content-type parsing).
      Then, when both checks pass and `config.body.isDefined`, attach the resolved body as
      `HttpEntity(parsedContentType, body)` via `.withEntity(...)`. Verify with unit tests: GET+body is
      rejected before any `HttpRequest` is built (no network call attempted); an unparseable
      `bodyContentType` is likewise rejected before any request is built; a POST-with-body config's
      built `HttpRequest` carries the expected entity/content-type; a GET/no-body config's built request
      carries no entity.
- [x] 3.3 In `buildEphemeralRequest`, apply the identical structural guards —
      `rejectBodyOnSafeMethod(config.method, config.body)` AND `parseBodyContentType(config.bodyContentType)`
      first, then attach body identically (no templating call, per Decision 4). Note
      `buildEphemeralRequest` currently returns a bare `HttpRequest` (not an `Either`) — this task also
      changes its signature to `Either[String, HttpRequest]`, and updates its two DIRECT callers
      (`fetchEphemeral`, `testConnectionEphemeral`, both in `RestApiConnectorDriver.scala`) to
      short-circuit on `Left` before issuing any request; `inferSchemaEphemeral` inherits the guard
      transitively (it calls `fetchEphemeral`, never `buildEphemeralRequest` directly), so needs no
      separate change. Verify with unit tests mirroring 3.2's.
- [x] 3.4 Add an integration-style ScalaTest (or extend an existing REST-connector test using a local
      stub HTTP server / WireMock-equivalent already used elsewhere in the suite) that issues a real
      POST with a body and asserts the receiving endpoint saw the exact expected payload — the
      acceptance criterion's "demonstrated against a real endpoint that echoes the payload" bullet.
      Include a hostile-template case: `{{userInput}}` containing `"`, `\`, `\n`, control characters,
      and unicode, asserting the received body re-parses as valid JSON with the original value intact.
- [x] 3.5 Add a ScalaTest proving the Connector credential is unreachable from a body template
      (`{{apiKey}}`/`{{credential}}`/`{{secret}}` with no matching `parameters` entry fails loud,
      mirroring HEL-823's existing endpoint/header coverage) — design.md Decision 7.

## 4. Response shaping (rootSelector)

- [x] 4.1 Change `RestApiConnectorDriver.toRows` to accept `rootSelector: Option[String]`, implementing
      the dot-path walk + zero-rows-on-miss behavior from design.md Decision 1 / the spec's "Minimal
      response root-selector" requirement; thread the new parameter through every ACTUAL `toRows` call
      site (design-gate cycle 1 REFUTE correction — `fetch(config, resolveContext)` itself returns raw
      `JsValue` and does not call `toRows`; the real call sites are:
      `RestApiConnectorDriver.inferSchema` (~line 284), `RestApiConnectorDriver.fetch(config, maxRows,
      resolveContext)` (~line 289), `RestApiConnectorDriver.inferSchemaEphemeral` (~line 324), and
      `SourceService.previewRest` (~line 312, calls `connector.toRows(json)` directly — must also pass
      `source.config.rootSelector`)).
- [x] 4.2 Add ScalaTests: unset selector byte-identical to pre-change `toRows` (run the existing
      `toRows` test cases unmodified through the new signature with `rootSelector = None`), nested
      single-level selector, nested two-level selector, missing-path-yields-zero-rows-plus-log.

## 5. Frontend

- [x] 5.1 Extend `RestApiConfigBody` (`frontend/src/features/sources/services/dataSourceService.ts`)
      with `body`/`bodyContentType`; rename the wire field the `jsonPath` UI value is sent as to
      `rootSelector` (keep the TS prop name `jsonPath` in `RestApiForm`'s own local state if simpler,
      but the payload key sent to the backend must be `rootSelector` to match 2.1). The known sites this
      touches (non-blocking design-gate note, enumerated so the executor doesn't have to re-derive it):
      `RestApiConfigBody.jsonPath` → `rootSelector` field rename, and every `buildConfig()`/payload
      object literal that currently spreads `...(jsonPath.trim() ? { jsonPath: jsonPath.trim() } : {})`
      — `RestApiForm.tsx:24` and `AddSourceModal.tsx:120`/`:151` — updated to spread `{ rootSelector:
      ... }` instead. Verify `npm run typecheck`.
- [x] 5.2a Add a method `<select>` (GET/POST/PUT/PATCH) to `RestApiForm.tsx`, replacing the hardcoded
      `method: "GET"` in `RestApiForm.buildConfig()` AND in `AddSourceModal.tsx`'s own two
      config-building call sites (currently `:119` and `:150`) — design-gate cycle 1 REFUTE finding:
      without this control, a body editor gated on "only for POST/PUT/PATCH" can never render. Verify
      `npm run typecheck`.
- [x] 5.2b Add a body textarea + content-type select to `RestApiForm.tsx`, rendered (not merely
      `disabled`) only when the method selected in 5.2a is POST/PUT/PATCH — the field must not be
      present in the DOM at all for GET/HEAD, matching the server rejecting a GET+body outright rather
      than accepting-then-ignoring a filled-but-disabled field; wire into `AddSourceModal.tsx`'s
      existing state plumbing alongside `jsonPath`. Follow DESIGN.md tokens/spacing for the new field.
      Verify `npm run lint` and `npm run typecheck`.
- [ ] 5.3 Live-verify in the running dev app (restart dev server first per HEL-742): create a REST
      source with a POST body against a real echo endpoint (e.g. httpbin-style local stub or an
      existing test fixture endpoint used elsewhere in this repo's Playwright suite), and a source
      with a `rootSelector` against a wrapped JSON response; confirm rows appear as expected. Screenshot
      to the scratchpad (never repo root).

## 6. Cleanup / verification

- [x] 6.1 Run `sbt test` (backend) and confirm the ~13 pre-existing `NoKeyConfigured` failures (no
      `CONNECTOR_MASTER_KEY` in local `.env`) are the ONLY failures, or confirm 0 failures if the key is
      configured in this worktree's `.env` — do not let this mask a real new failure.
      NOTE: Do not touch `CONNECTOR_MASTER_KEY`/`.env` — the run environment must already provide it or the
      13 known failures apply; nothing here should be "fixed" by adding a key. Never `gh pr merge --auto`.
- [x] 6.2 Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check` (frontend); fix
      all issues before committing.
- [x] 6.3 `openspec validate --change rest-body-jsonpath-selector --strict` exits 0.
- [x] 6.4b If the cycle-6 confirming skeptic round (design gate, taken outside the exhausted
      5-round `SKEPTIC_DESIGN_ROUNDS` budget per coordinator approval) still finds another instance of
      the decode-is-total defect class, apply the fix and proceed to Execution regardless (do not spend
      a further round) — but record the residual finding explicitly in the PR body as a flagged triage
      item for the coordinator, per the coordinator's explicit instruction.
- [ ] 6.4 In the PR body, explicitly note: (a) the deferred `splitUrl`/query-merge duplicate-key
      collapsing finding (design.md Decision "splitUrl... confirmed still present... deferred"), (b)
      that the auth-header-collision defect cited in the ticket is already fixed on `main` (no action
      taken), (c) the spray-json silent-unknown-field-drop general hazard (design.md Decision 8) as a
      triage finding, not scope addressed here.
