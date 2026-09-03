## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 change requests, checked against ground truth (not against the artifacts' own prose):**

- **CR1 (false teardown claim; non-repeatable AC5 precondition) — FIXED in substance.** The tag claim is
  gone; Decision 8 now names a fresh-throwaway-user mechanism. I verified every load-bearing fact of that
  mechanism myself:
  - `RegisterRequest(email: String, password: String, displayName: Option[String])` —
    `backend/src/main/scala/com/helio/api/protocols/auth/AuthProtocol.scala:8`. No invite-code field.
    The cited line number is exact.
  - **Registration is gated nowhere else.** `AuthRoutes.scala:39` `path("register")` is mounted in the
    *public* branch (`ApiRoutes.scala:641` `pathPrefix("auth") { concat(auth.routes, ...) }`, outside
    `authenticate`). `AuthService.register` (`AuthService.scala:93-122`) checks only
    `RequestValidation.validateRegisterRequest` → duplicate-email → insert; there is **no** invite-code,
    beta-access, or allowlist gate on the path (`InviteCodeRepository`/`BetaAccessService` are wired in
    `ApiRoutes` but not consumed by `register`). `validateRegisterRequest`
    (`api/http/RequestValidation.scala:10-18`) enforces only non-blank email/password, email format, and
    minimum password length. Tier defaults to `free` unless the email matches `HELIO_OWNER_EMAILS`.
  - `POST /api/tokens` exists and is reachable with the register response's session cookie:
    `ApiTokenRoutes.scala` `pathPrefix("tokens") { post { entity(as[CreateApiTokenRequest]) ... } }`,
    mounted at `ApiRoutes.scala:763` inside the `authenticate` branch (session **or** PAT).
    `CreateApiTokenRequest(name, expiresInDays, scopedPipelineIds)` — `ApiTokenProtocol.scala:17`.
  - **The zero-Connector precondition is genuinely repeatable.** Connector reads are owner-scoped:
    `ConnectorEntityService.findAll(user)` → `connectorRepo.findAll(user)`
    (`ConnectorEntityService.scala:39-42`), and `DemoData` seeds no connectors at all
    (`grep -n "onnector" backend/src/main/scala/com/helio/app/DemoData.scala` → zero matches; seeding is
    startup-global via `Main.scala:149`, not per-user). A brand-new user therefore sees an empty
    `list_connectors` on **every** run, forever — CR1's "satisfiable at most once" defect is really gone.
  - `DELETE /api/connectors/:id` exists — `ConnectorEntityRoutes.scala:86` is the `delete {` inside
    `path(ConnectorIdSegment)`. The cited line is exact.
- **CR2 (follow-up filing had no task) — FIXED.** `tasks.md` 5.1 exists as a real task, and `design.md`
  Decision 7 carries an explicit empty placeholder ("**Follow-up ticket id: _(filed at task 5.1; recorded
  here)_**"), so an unfiled follow-up leaves two visible holes rather than an unmet intention.
- **CR3 (spec mandated the input Decision 4 forbids) — FIXED.** `specs/mcp-data-source-tools/spec.md`'s
  ADDED `create_connector` requirement now reads "It SHALL NOT accept request-shaping configuration of any
  kind — in particular no `defaultHeaders` … per-source `headers` on `create_rest_data_source` is the
  intended channel". The offending "optional non-secret request-shaping configuration" clause is gone. Spec
  and Decision 4 now agree.
- **CR4 (AC3 unmet on the undeclared `authType` path) — FIXED, and the mechanism is implementable.**
  Decision 4b, tasks 2.3b/2.3c/4.5b, and two new spec scenarios are present. 4b(i) (constant `note` on
  success) is deterministic and correctly identified as the load-bearing half. I checked 4b(ii) is not
  vacuous: `RestApiConnectorDriver.scala:316-318` returns `Left(s"HTTP $code: $body")` for any non-2xx, so a
  401/403 really does reach the client as a status-bearing string, and `ConnectorDriver.scala`'s
  fetch-error-envelope scaladoc confirms `err` is "forwarded unmodified — the helper never re-wraps,
  re-prefixes, or re-derives" it. So a `fetchError` of `HTTP 401: …` is a real, matchable string, and task
  4.5b is a testable assertion rather than a hopeful one.
- **Non-blocking notes (a)/(b)/(c) — addressed honestly, not by softening.**
  (a) Decision 3 now names **both** axes and specifies `rejectCredentialField(field, {toolName, alternative})`;
  I confirmed the current message really does vary on both (`restDataSourceSchema.ts:31-39` interpolates
  `${field}` and hardcodes both `create_rest_data_source` and `Pass connectorId instead.`).
  (b) Decision 4 now states plainly that `create_rest_data_source` already accepts
  `headers: z.record(...)`, that omission "does not widen that existing channel", and adds a Risks bullet
  saying so — the overclaim is retracted rather than reworded. Confirmed against
  `restDataSourceSchema.ts` (`.strict()` at line 64, five `rejectCredentialField` entries at 54-58).
  (c) Decision 8's AC5 mechanism is now structural (setup/teardown HTTP isolated to their own functions
  outside a measured phase that holds no HTTP client) rather than a self-assertion.

**Other facts re-derived independently:** `ConnectorEntityService.create` permits an empty credential only
when `authType == "none"` (`:64-65`), `checkCreateTimeEgress` runs before any write (`:71-182`),
`CreateConnectorRequest(name, kind, baseUrl, config: Option[JsValue], credential: String)`
(`ConnectorEntityProtocol.scala:56-62` — so Decision 1's literal `credential: ""` is wire-valid),
`read.ts:160/175` registers `list_connector_types`→`listConnectors()` and `list_connectors`→
`listConnectorInstances()`, and the root `jest.config.cjs` really does collect `helio-mcp/src/**` tests
(so tasks 4.1-4.6 land in a running harness).

### Verdict: REFUTE

The four round-1 change requests are all genuinely fixed, and the fresh-user mechanism holds up against the
real routes — I could not break it. What I *could* break is the new Decision 8's other half: the measured
phase depends on an external precondition the plan never names, and defines no success signal, so AC5 can be
"passed" by a run that produces a broken source.

### Change Requests

1. **The AC5 e2e's measured phase requires public-internet egress to an unauthenticated REST host, and the
   plan names neither the host nor what happens without one.** `create_connector`'s `baseUrl` goes through
   `checkCreateTimeEgress` → `ContentSourceSupport.isBlockedAddress`
   (`services/sources/ContentSourceSupport.scala:91-97`), which rejects loopback, link-local, site-local,
   any-local, multicast, and `fc00::/7`. A local stub HTTP server is therefore **not** a usable target — the
   Connector cannot be created against it at all. The measured phase must hit a real public host. This is
   the exact assumption the existing harness explicitly refuses to make: `e2e/sleeper-rebuild.ts:8-20`'s
   HONESTY NOTE says it does not re-fetch the live Sleeper API because that "needs a live Sleeper league
   id/season and **network egress this harness does not assume it has**", and drives the whole script from
   static inline sources instead. Decision 8 and task 4.7 inherit that constraint without acknowledging it.
   Name the concrete unauthenticated host the measured phase targets (e.g. a specific Sleeper public
   endpoint), state that the run requires outbound network access, and state what the script does when that
   access is absent — fail loudly with a diagnosable message, not silently downgrade into a run that still
   reports success.

2. **Task 4.7/4.8 define no pass criterion, so "builds a working REST source" is unfalsifiable.** AC5's
   literal wording is "a scripted MCP session against a clean workspace **builds a working REST source end
   to end**". A `create_rest_data_source` call that fails its initial fetch still **succeeds at the HTTP
   level** and returns `inferredSchema: null` + `fetchError` (`ConnectorDriver.scala` fetch-error envelope;
   `helioApi.ts:434` maps `fetchError: raw.fetchError ?? null`) — i.e. the current task text is satisfied by
   a run that produced a source that does not work. Task 4.8 likewise says only "record its transcript",
   with no assertion. Give 4.7 explicit assertions the script fails on: `inferredSchema` non-null and
   `fetchError === null` on the created source, and a non-empty Output rows/materialization check at the end
   of the pipeline leg — so "working" is a checked property rather than a transcript a reader interprets.

### Non-blocking notes

- (d) **Decision 8's "so nothing is orphaned" is still slightly untrue, though harmlessly so now.** Teardown
  deletes the Connector, but the measured phase also creates a data source, a pipeline, and an Output (task
  4.7), plus the throwaway user row and its PAT — none of which are reclaimed. Unlike CR1's version this does
  not break repeatability (everything is partitioned under a disposable user), so it is not blocking. Either
  tag the taggable resources and call `teardown_resources` the way `sleeper-rebuild.ts` does, or state
  plainly that per-run rows under a disposable user are accepted rather than claiming nothing is orphaned.
- (e) `tasks.md` lists 4.5b after 4.6 and files 5.1 under a "### Tests" heading though it is a
  ticket-filing task. Cosmetic.
