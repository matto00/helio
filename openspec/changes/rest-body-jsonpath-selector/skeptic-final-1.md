## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold, independent verification of HEL-826 at HEAD `004fded8`. Every conclusion below is
derived from the files/diff/live app/test output I read myself; the executor and evaluator
reports were treated as claims.

### What I verified (with evidence)

**1. Decode-is-total invariant — HOLDS in current code (re-derived, not read from design.md).**
Read `RestApiConfigPayload.toDomain` in full (`DataSourceProtocol.scala:338-368`). It performs
exactly three rejections, all pre-existing: `p.auth.isDefined`; `connectorId`/`url`
exclusivity + presence; empty/reserved-sentinel `connectorId`. `body`, `bodyContentType`, and
`rootSelector` are passed straight through with zero semantic checks. Confirmed by grep that
`rejectBodyOnSafeMethod`/`parseBodyContentType` appear only at:
- `RestApiConnectorDriver.buildResolvedRequest` (both, first in the `for`-comprehension, before
  any templating/URI/entity work);
- `RestApiConnectorDriver.buildEphemeralRequest` (both, before the `HttpRequest` is built);
- `SourceService.createRest` connectorId branch, bare-`url` branch, and `toEphemeral`
  (`rejectBodyOnSafeMethod` only — explicitly non-authoritative belt-and-braces).
No call from `toDomain`/`decodeRest`. `RestApiConfigPayloadToDomainSpec` asserts this directly
(GET+body and unparseable `bodyContentType` both decode `Right`) and passes.

One deliberate, harmless gap noted: `fetchEphemeral`'s `fetchOverride` (test-fixture) branch
calls `rejectBodyOnSafeMethod` but not `parseBodyContentType`. That branch is test-only and
never issues a real request; not a defect.

**2. Persist-then-validate ordering — no remaining instance.** Read both branches of
`SourceService.createRest` at HEAD:
- bare-`url` branch: `rejectBodyOnSafeMethod(request.config.method.getOrElse("GET"),
  request.config.body)` is the first statement inside the `else`, and `connectorRepo.create`
  is reachable only from its `Right(())` arm. The cycle-1 orphan is genuinely closed.
- `connectorId` branch: the check runs on the `toDomain` result and `createRestWithConfig`
  (the only DataSource insert) is called only in the `Right(())` arm. No equivalent hazard.
- `toEphemeral` (infer/test) and `PipelineService`'s inline bare-`url` branch: neither
  persists anything; the guard is upstream of the fetch either way.
- No other write path touched by this ticket. Sweep 2's seven construction sites re-derived by
  grep and confirmed accurate (`RestSourceConnectorMigration`, `DataSourceRepository` sentinel,
  and the `fetchOverride` adapter all genuinely carry no body).
Regression test asserts `connectorRepo.findAll(user).size` unchanged after the rejected
bare-url create — real assertion, and it passes.

**3. Injection surface is real, not asserted.** `RestApiConnectorDriverBodySpec` stands up an
embedded Postgres, a real `ConnectorRepository`/`ConnectorCredentialRepository` with a real
master key, and a **real Pekko HTTP echo server on a real port** that returns the received
Content-Type and raw body. The hostile-template test sends
`{"q": "{{userInput}}"}` with `userInput = "she said \"hi\"\nline2 \\ backslash é "` (double
quote, newline, backslash, non-ASCII) and asserts the **echoed** body `.parseJson` re-parses and
`fields("q")` equals the original string — i.e. verified after a genuine wire round-trip and
re-parse, not at the interpolator unit level. Credential-unreachability test is real: a
Connector with a bearer credential `super-secret-token` is created, and `{{apiKey}}`/
`{{credential}}`/`{{secret}}` bodies each assert an exact
`Left("Unresolved template variable: <name>")`. All 10 tests in this spec **passed** in my run
(sbttest.log:1632-1645).

**4. rootSelector is a strict HEL-599 subset, unset is byte-identical.** Read `toRows` at
`RestApiConnectorDriver.scala:238`. `None` → `Some(json)` → the pre-change 3-way match verbatim;
no other behavior change on that path. `Some(path)` is dot-split `JsObject`-field walk only —
no flatten, no array indices, no wildcards, no pagination, no `fetchError` envelope, no
HEL-473 facade touch (grep confirms none of those symbols appear in the diff). Miss/non-object
mid-walk → `Vector.empty` + warn log. All eight `toRows` tests pass. All four production
`toRows` call sites now thread the selector (`inferSchema`, `fetch(maxRows)` — which is what
`InProcessPipelineEngine` uses for real runs — `inferSchemaEphemeral`, `previewRest`), so the
persisted end-to-end path is genuinely covered, not just preview.

**5. Live frontend (dev 6258 / backend 9165 healthy via `assert-phase.sh servers`).**
- GET selected: `Method` select renders; `[aria-label="Body"]` and `[aria-label="Content type"]`
  return **0 DOM nodes** — absent, not disabled. Screenshot
  `.playwright-mcp/hel826-get.png`.
- POST/PATCH selected: mono `Textarea` body editor + content-type `TextField` render with the
  form's existing spacing/label rhythm. Screenshots `.playwright-mcp/hel826-post-dark.png`,
  `.playwright-mcp/hel826-patch-light.png`.
- Wire check (captured by wrapping `XMLHttpRequest.send`, real submit):
  POST → `{"url":"...","method":"POST","rootSelector":"data.items","body":"{\"a\":1}"}`.
  GET → `{"url":"...","method":"GET","rootSelector":"data.items"}` — `body` correctly omitted
  even though the textarea still held a value. `jsonPath` no longer appears on the wire.
- Light/dark parity checked by toggling `data-theme`; dropdown, textarea, and error text all
  render correctly in both. No app-originated console errors (the one 403 in the log is from my
  own CSRF-less probe fetch).
- Design-standard judgment: uses the shared `Select`/`Textarea`/`TextField` primitives with the
  existing `add-source-modal__field`/`__label`/`__optional` classes — no one-off styling, no
  hardcoded values. `label htmlFor` pointing at a `Select` that takes `ariaLabel` rather than
  `id` is the established codebase-wide pattern (~20 sibling call sites), not a new divergence.
- Screenshots written under `.playwright-mcp/` (gitignored). One screenshot initially landed at
  repo root due to the MCP path default; I moved it and confirmed `ls /…/helio/*.png` is empty.

**6. Both inherited-defect decisions are accurate.**
- Query duplicate-key collapse: still present and untouched —
  `RestSourceConnectorMigration.scala:88` (`queryPairs.toMap`) and `buildResolvedRequest`'s
  `Uri.Query(uri.query().toMap + (k -> v))` both unchanged in the diff. Correctly deferred.
- Auth-header collision: `git show main:…/RestApiConnectorDriver.scala | grep authHeaderNames`
  returns lines 143/145 — the case-insensitive dedupe **is already on main**, so the ticket text
  is stale and design.md's contradiction of it is correct. Not touched by this change.

**7. `sbt test` re-run by me, failures accounted for by name.**
`3596 run / 3582 succeeded / 14 failed`, matching the reported count. The 14 are:
- `NoKeyConfigured` verbatim (7): two `AuditMutationInstrumentationSpec` refresh-row tests, four
  `DataSourceRoutesSpec` DataType create/refresh/version tests, and the new
  `SourceServiceSpec` "…via the connectorId branch" test (which fails in its **fixture setup**
  `connectorRepo.create`, not in the code path under test).
- `500 Internal Server Error` (7): four `PipelineApplyProposalRollbackSpec` inline-`rest_api`
  tests, two `ApiRoutesSpec` `POST /api/sources` tests, one `DataSourceRoutesSpec` override test
  — all REST-source-creation routes, i.e. the route-level surfacing of the same encryption
  failure.
I did **not** accept "same class" on inspection. `backend/.env` in this worktree has no
`CONNECTOR_MASTER_KEY`. I re-ran all five failing spec classes with
`CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` set: **328 succeeded, 0 failed**. That
conclusively proves all 14 are the missing-local-key environmental gap (CI supplies the key per
CLAUDE.md), and that the new connectorId-branch test genuinely passes in a complete environment.
- `npm run typecheck` — clean. `npm run lint` — clean (0 warnings).

### Acceptance-criteria trace

| AC | Evidence |
|---|---|
| Body carried + actually sent, demonstrated against a real echoing endpoint | `RestApiConnectorDriverBodySpec` "attaches the resolved body with the expected content-type" + the hostile-template echo test, both against a real bound HTTP server; passing |
| Body+method interaction defined and tested | `rejectBodyOnSafeMethod` (GET/HEAD, case-insensitive) at both choke points; `RestApiConfigSpec` (6 cases) + 2 driver-level "rejected before any request is issued" tests; passing |
| jsonPath resolved via a minimal root selector, persists and applies end to end | `rootSelector` on payload/domain/ephemeral, `jsonFormat11`, threaded to all four `toRows` sites incl. the pipeline-run `fetch(maxRows)`; live wire capture shows the form sending `rootSelector` |
| Body participates in HEL-823 templating with correct escaping | `resolveJsonBody`/`jsonEscape` reused unchanged (no second templating path added — grep confirms one call site); escaping verified post-wire-round-trip |
| HEL-599 overlap reconciled, deferrals enumerated | design.md Context + Decision 1 + Non-Goals; verified against code that none of the deferred capabilities were built |

### Verdict: CONFIRM

### Non-blocking notes

- The form label still reads "JSON path" while the wire field is `rootSelector`. A deliberate
  design.md decision, but HEL-599 may want to rename it to match the domain vocabulary.
- design.md Decision 6 says the content type would be a select; the implementation uses a free-
  text `TextField` (arguably better, since `ContentType.parse` accepts arbitrary values). Purely
  a doc/impl wording drift.
- `SourceServiceSpec`'s connectorId-branch test asserts the `BadRequest` but not the absence of a
  persisted `DataSource` row (the bare-url twin does assert its no-orphan invariant). The
  ordering is correct by inspection; adding the symmetric row-count assertion would make the
  guarantee test-enforced on both branches.
- `openspec/changes/rest-body-jsonpath-selector/evaluation-2.md` is currently untracked — it
  should be committed with the change.
