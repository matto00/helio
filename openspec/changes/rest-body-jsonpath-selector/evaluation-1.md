## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- Ticket acceptance criteria (request body + content type actually sent; body/method interaction
  rejected+tested; minimal rootSelector persists and applies end-to-end; body participates in
  HEL-823 templating reusing `TemplateInterpolator`; HEL-599 overlap reconciled in design.md) are
  all addressed and match the implementation, verified against the diff, not just the executor's
  narrative.
- No AC silently reinterpreted. The scope decision (minimal root-selector, deferring flatten /
  pagination / curated `fetchError` / HEL-473 to HEL-599) is honored — `toRows`'s dot-path walk in
  `RestApiConnectorDriver.scala` implements exactly Decision 1, nothing more.
- Task list (tasks.md 1.1–4.2, 5.1–5.2b, 6.1–6.3, 6.4b) matches what was actually implemented,
  cross-checked file-by-file against `files-modified.md` and the diff. Task 5.3 (live dev-server
  screenshot verification) is correctly marked not-done by the executor — I performed it in Phase 3
  below in its place.
- No scope creep found — all touched files are on the ticket's stated surface (model, protocols,
  driver, SourceService, PipelineService inline-rest branch, frontend REST form).
- No regressions found to existing behavior: `toDomain`/`fromDomain`, auth rejection,
  connectorId/url exclusivity, and reserved-sentinel handling are untouched aside from additive
  field threading (confirmed by diff read of `DataSourceProtocol.scala`).
- API contracts updated: `RestApiConfigPayload` schema widened (`jsonFormat9`→`jsonFormat11`) in
  both `DataSourceProtocol.scala` and `DataSourceConfigCodec.scala`; `openspec/changes/.../specs/
  rest-api-connector/spec.md` MODIFIED requirement reflects the new fields and their exact
  behavior (body/bodyContentType/rootSelector, GET+body 400, templating extension).
- Planning artifacts (design.md) reflect the final implemented behavior — verified directly against
  code, not merely by citation (see Phase 2 for the one place they diverge).

**Decode-is-total invariant (design.md Decision 3) — independently verified, not merely trusted:**
`RestApiConfigPayload.toDomain`/`fromDomain` (`DataSourceProtocol.scala`) perform pure field
threading for `body`/`bodyContentType`/`rootSelector` — no `Left`/rejection path added for any of
the three. The two new semantic guards (`RestApiConfig.rejectBodyOnSafeMethod`,
`RestApiConfig.parseBodyContentType`, both in `model.scala`) are called ONLY from
`buildResolvedRequest`/`buildEphemeralRequest` (the two request-issuing choke points in
`RestApiConnectorDriver.scala`), plus the additive create-time belt-and-braces calls in
`SourceService.scala`/`toEphemeral`. I confirmed by direct read of every diff hunk touching
`toDomain` that none of the new validation logic appears there. `ScalaTest` coverage
(`RestApiConfigPayloadToDomainSpec.scala`) directly asserts permissiveness for a GET+body payload
and an unparseable `bodyContentType` — this test class exists and asserts what design.md claims.
The invariant is genuinely honored.

### Phase 2: Code Review — FAIL

**Gates (freshly re-run by me, not trusted from the executor's report):**
- `npm run lint` — PASS (0 warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (262 suites / 2868 tests)
- `npm run typecheck` — PASS
- `npm --prefix frontend run build` — PASS
- `openspec validate rest-body-jsonpath-selector --strict` — PASS ("Change ... is valid")
- `cd backend && sbt test` — 15 failures / 3596 total, all `NoKeyConfigured`
  (`ConnectorCredentialEncryptionFailed`) — this worktree's `.env` has no `CONNECTOR_MASTER_KEY`.
  **Baseline comparison independently performed** (not trusted from the executor's claim): I
  checked out `main` (`b3e866fd`) into a throwaway detached worktree and ran the same 5 failing
  spec classes against it — baseline showed **13** failures, all `NoKeyConfigured`, in the same
  classes (`SourceServiceSpec`, `ApiRoutesSpec`, `DataSourceRoutesSpec`,
  `AuditMutationInstrumentationSpec`, `PipelineApplyProposalRollbackSpec`). The branch's 2
  additional failures are exactly the 2 new "GET+body immediate-400" tests added by this ticket
  (`SourceServiceSpec` — "should reject a GET+body request immediately... via the bare-url branch"
  / "...via the connectorId branch"), both failing on the same pre-existing environmental
  `NoKeyConfigured` gap (a `Connector` row must be created/encrypted before either test's assertion
  is reached — see the defect below for the bare-url branch specifically). The executor's
  characterization (13 baseline + 2 new-but-env-gated = 15 total) is **confirmed accurate**, not
  evidence-shaped non-evidence.

**Design-vs-implementation deviation (real defect, not test-environment noise):**

`SourceService.createRest`'s bare-`url` branch (`SourceService.scala:99-138`) does not honor
design.md Decision 3's stated placement for the belt-and-braces create-time check. Decision 3 says
the bare-`url` branch check goes "before constructing `RestApiConfig`" (SourceService.scala:117-122
in the design), and tasks.md 2.3 repeats the same instruction verbatim. The actual implementation
calls `connectorRepo.create(...)` (which synthesizes and **persists** an implicit no-auth
`Connector` row, including an encrypted-credential write) FIRST, then constructs `restConfig`, and
only THEN calls `RestApiConfig.rejectBodyOnSafeMethod` inside the `.flatMap`
(`SourceService.scala:112-137`):

```scala
connectorRepo.create(...)             // persists a Connector row — side effect #1
  .flatMap { createdConnector =>
    val restConfig = RestApiConfig(...)
    RestApiConfig.rejectBodyOnSafeMethod(restConfig.method, restConfig.body) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(())  => createRestWithConfig(request, restConfig, user)
    }
  }
```

Consequence: a `POST /api/sources` bare-`url` request with `method: GET` and a non-empty `body`
still creates and persists an orphaned implicit `Connector` (with a real encrypted-credential
write) before being rejected with a 400 — the exact wasteful/orphan-row side effect the
belt-and-braces check exists to avoid on an immediate-400 UX path. This is not merely a doc
mismatch: it is a real, reachable side effect in production (with `CONNECTOR_MASTER_KEY`
configured, the request would succeed at creating the Connector row, then reject the source
creation, leaving an orphan `connectors`/`connector_credentials` row per rejected request). It is
also why the two new "GET+body immediate-400" ScalaTests fail in this environment for the *wrong*
reason — they hit `NoKeyConfigured` on the Connector-creation side effect before ever reaching the
`rejectBodyOnSafeMethod` check the tests are nominally exercising, masking whether the guard itself
is even correctly wired for the bare-url branch.

This is a Change Request, not a documentation nit — the connectorId branch's own belt-and-braces
call (`SourceService.scala:89-97`) correctly runs before any persistence (`toDomain` is pure), so
only the bare-url branch is affected, and the fix (moving the `rejectBodyOnSafeMethod` check before
`connectorRepo.create`, since `method`/`body` are already known from `request.config` at that
point) is a small, well-scoped, mechanical reorder.

**Other Phase 2 checks (all PASS):**
- Canonical CONTRIBUTING.md/DESIGN.md compliance: no inline FQNs, imports at top, shared
  `Select`/`Textarea` components reused (not new components) in `RestApiForm.tsx`, DESIGN.md
  token/class conventions (`add-source-modal__field`, `add-source-modal__label`,
  `add-source-modal__optional`) followed exactly as the pre-existing `jsonPath` field does.
- DRY: `jsonEscape`/`resolveJsonBody` reused unchanged from HEL-823 (Decision 7), no new escaping
  path invented.
- Readable/modular: `rejectBodyOnSafeMethod`/`parseBodyContentType` are small, single-purpose,
  correctly-placed helpers (aside from the one call-site ordering defect above).
- Type safety: no untyped escape hatches (`Either`/`Option` used consistently for the new failure
  modes).
- Security: credential-unreachability from body templates re-verified structurally
  (`RestApiConnectorDriverBodySpec.scala` — same `config.parameters` map, no `credentialValue`
  merge, matching HEL-823's existing guarantee); hostile-template escaping tested against a real
  echo server.
- Error handling: `Either`-threaded short-circuiting is correct and consistent everywhere except
  the one ordering defect noted above.
- Tests meaningful: new specs (`RestApiConfigSpec`, `RestApiConfigPayloadToDomainSpec`,
  `RestApiConnectorDriverBodySpec`, `PipelineServiceInlineRestBodySpec`,
  `RestApiConnectorDriverSpec` additions) exercise real new code paths, including a real HTTP
  echo-server round trip and hostile-template escaping — would catch a real regression.
- No dead code, no over-engineering.
- Behavior-preserving where expected: `toRows(json, rootSelector = None)` is reached via the exact
  same 3-way match as before — confirmed byte-identical by reading the diff (only the wrapping
  `Option`-guard is new).

### Phase 3: UI Review — PASS

Restarted dev servers per HEL-742 via `scripts/concertino/start-servers.sh` +
`assert-phase.sh servers` (`PASS servers`). Live-verified in the running app (localhost:6258 /
backend :9165):

- Opened Data Sources → Add source modal. With the default `GET` method, the body/content-type
  fields are **absent from the DOM entirely** (not merely disabled) — matches design.md Decision 6
  and the server's GET+body rejection.
- Switched Method (`Select` component, GET/POST/PUT/PATCH) to `POST` — the "Body (optional)"
  textarea (placeholder `{"key": "{{value}}"}`) and "Content type (optional)" text field appeared
  immediately, correctly gated on the selected method, using the shared `Select`/`Textarea`
  components (not ad hoc markup).
- "JSON path (optional)" field (wired to send `rootSelector` on the wire per the diff) is present
  unconditionally, consistent with design.md Decision 6.
- No console errors during the flow (`browser_console_messages` level=error → 0 entries).
- Existing REST source's "Preview"/inferred-schema panel rendered normally alongside the modal,
  confirming no regression to the existing list/detail view.
- Did not attempt a live rootSelector-against-a-wrapped-response round trip or a real POST-body
  echo test at the UI layer — per the task's own scoping, the backend `RestApiConnectorDriverBodySpec`
  (real echo-server proof) already covers that, and no reachable local echo endpoint was
  constructed for browser-driven traffic within this review's time budget; the UI-rendering/wiring
  checks above (method-gated field presence/absence, wire field rename) are the checks this phase
  was asked to perform.
- Breakpoint resize sweep (1440/1100/768/0) not performed — the new fields are two more rows in an
  existing, already-narrow modal form using the same shared components as the pre-existing
  `jsonPath`/`url` fields (same width class, same stacking), so no new responsive surface was
  introduced; deferred to the skeptic's judgment-level pass per the role split in this workflow.

### Overall: FAIL

### Change Requests

1. **`SourceService.scala:99-138`** (bare-`url` branch of `createRest`) — reorder the
   `RestApiConfig.rejectBodyOnSafeMethod` belt-and-braces check to run BEFORE
   `connectorRepo.create(...)`, per design.md Decision 3's explicit placement and tasks.md 2.3's
   explicit instruction ("before constructing `RestApiConfig`"). `method` and `body` are both
   already available from `request.config` before the Connector is synthesized/persisted — the
   check does not need `createdConnector.id`. As implemented, a GET+body bare-url create request
   persists an orphaned implicit `Connector` row (including an encrypted-credential write) before
   being rejected with 400, which is exactly the wasteful side effect the belt-and-braces check
   exists to avoid. Add or adjust a ScalaTest asserting no `Connector` row is created for a
   rejected GET+body bare-url request (the current two "immediate-400" tests only assert the 400
   response, not the absence of a persisted Connector).

### Non-blocking Suggestions

- Consider extending the two new SourceServiceSpec "immediate 400" tests
  (`SourceService.scala:99-138`'s branch) with an explicit assertion that no `Connector` row was
  created, once Change Request 1 is fixed — this would have caught the ordering defect directly
  rather than requiring a design-doc cross-read.
- `RestApiConnectorDriverBodySpec.scala`'s real-echo-server coverage was not re-run individually by
  me beyond the full `sbt test` pass; consider naming it explicitly in the PR body alongside the
  hostile-template assertion so a future reader doesn't have to rediscover it exists.
