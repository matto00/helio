## Context

See proposal.md — Why. What shapes the approach:

- `ContentSourceSupport` holds the whole policy: `resolveValidated` (private) does the scheme/host/address checks and
  returns the validated `InetAddress`; `pinnedTransport` (private) turns that into a `ClientTransport` suppressing
  Pekko's second DNS resolution; `fetchUrl` composes both as a bare GET returning raw bytes.
- REST cannot use `fetchUrl`: it sends a configured method, templated headers, a typed body and an injected credential,
  and parses JSON — none of which `fetchUrl` builds. The reusable unit is the validate-and-pin core, not the helper.
- All four REST entry points (`fetch`, `testConnection`, `fetchEphemeral`, `testConnectionEphemeral`) funnel into two
  private methods calling `singleRequest`: `issueAndParse` (279) and `issueTest` (304), both using one shared
  `poolSettings` val with timeouts and no transport.
- The existing seam for this guard is a pair of injected functions, `resolveHost` and `isBlocked`, threaded from
  `ApiRoutes` (105-111) into `DataSourceService`/`PipelineRunService`/`CsvUrlFetch`, defaulting to real DNS + denylist.

## Goals / Non-Goals

**Goals:**
- One policy, one implementation, reached from REST by reuse rather than a parallel copy.
- Guard placement that is structurally exhaustive for the REST path, not a checklist a fifth entry point can miss.
- Preserve every existing REST behavior for allowed destinations: method, headers, auth, body, JSON parsing.

**Non-Goals:**
- See proposal.md — Non-goals. At design level: no change to `ContentSourceSupport`'s denylist, scheme policy or size
  cap, and no change to `fetchUrl`'s signature or behavior for its existing callers.

## Decisions

### Decision 1: Widen the seam by publishing the existing core, rather than making REST call `fetchUrl`

Make `resolveValidated` public as `validateAndResolve` (returning `Either[String, InetAddress]`) and publish a
transport/pool accessor built from `pinnedTransport`. `fetchUrl` then calls the now-public core, so there is still
exactly one implementation and one denylist.

Alternatives rejected: (a) generalising `fetchUrl` to take method/headers/body/auth — it becomes a second REST client
and drags text/pdf/image/csv callers through a wider signature for nothing; (b) calling the existing public
`validateUrl` and then building the connection separately — it returns `Unit`, discarding the resolved address, which is
precisely the DNS-rebinding TOCTOU HEL-215's cycle-3 review fixed. That would be a guard that only appears to work.

### Decision 2: Guard at the two request-issuing choke points, not at the two request-building methods

Apply the guard inside `issueAndParse` and `issueTest`, keyed on `request.uri.toString`, and build per-request pool
settings carrying the pinned transport instead of using the shared `poolSettings` val.

Rationale: the ticket names the two *builders*, but the *issuers* are what every path must pass through. Guarding there
covers the resolved and ephemeral paths with one check and — the load-bearing part — covers any future entry point
automatically, since a request not issued through them is not issued at all. It is also the only site where the final,
post-templating, post-`joinUrl` URI is known: a guard on `baseUrl` alone would miss an `endpoint` escaping the base
(e.g. one beginning `//169.254.169.254/`).

Note the pin must be attached where the connection is made, so a builder-sited guard could not attach it at all without
smuggling the address forward — another reason the issuer is the right site.

**One bypass exists, and it is test-only.** `fetchOverride` (param 1, line 45) short-circuits `fetch` (228) and
`fetchEphemeral` (385) *before* the issuers. It opens no socket — default `None`, and the sole production construction
(`Main.scala:165`) does not set it — so the production claim holds. But it is a test-integrity hazard: it is the
codebase's standard REST fixture (~20 constructions), so an egress test built on it passes while proving nothing. Every
egress test therefore sets `fetchOverride = None` (tasks 4.4, 4.7). Asymmetry to respect in task 4.3: `fetchEphemeral`
consults `fetchOverride`, `testConnectionEphemeral` (408) does not.

### Decision 3: Reject 3xx explicitly on the REST path

Both issuers branch on `response.status.isSuccess()`. In Pekko, `Redirection` extends the same `HttpSuccess` marker as
`Success`, so a 302 is parsed as though it were a 200. `ContentSourceSupport` hit this trap and fixed it in `fetchUrl`
with an explicit range test — `val code = response.status.intValue(); if (code >= 200 && code < 300)` — commented as
"what actually fixes this (not a cosmetic rename of `isSuccess`)". REST adopts that same explicit 2xx-range idiom, not
an `isSuccess && !isRedirection` reformulation, so both issuers and the helper read identically.

`singleRequest` does not follow redirects, so this closes no live redirect-chase; it corrects a real mis-classification
and makes the "redirect not followed" criterion hold by construction and be testable, not by accident of the library.

### Decision 4: Validate `baseUrl` at Connector create/update as a second, non-authoritative guard

`ConnectorEntityService.create`/`update` gain an egress check on `baseUrl`. It needs DNS, and both already return
`Future`, so it costs no signature change.

It is deliberately *not* authoritative: a host resolving publicly at create time can resolve internally later, so only
the fetch-time guard can be. It is worth having because it stops a hostile value where a human or agent still sees the
error, and satisfies the "cannot be stored" criterion. Both are specified; the fetch-time one holds independently.

### Decision 5: Thread the existing `resolveHost`/`isBlocked` seam into the driver and the service

Both take the same two injected functions with the same real defaults, but they have *different* wiring sites —
conflating them was a defect in this design's first round:

- `ConnectorEntityService` is constructed in `ApiRoutes` (line 472), so its seam is wired there alongside the existing
  `dataSourceUrl*` params (lines 104-111).
- `RestApiConnectorDriver` is **not** constructed by `ApiRoutes` — `ApiRoutes` receives a ready-made driver as a
  constructor param (line 73). The only production construction is `Main.scala:165`, which is where the real defaults
  are wired.

So the `ApiRoutes`-level `dataSourceUrlIsBlocked` seam cannot reach the driver. A route-level spec (tasks 4.3/4.4/4.7)
builds its own `new RestApiConnectorDriver(fetchOverride = None, resolveHost = ..., isBlocked = ...)` and hands that to
`ApiRoutes`. Tests admit one known-safe hostname by keying `isBlocked` on the hostname string, never widening a class.

Rejected: a global "allow private addresses in test" flag. It is exactly the weakening this seam was designed to avoid,
and it would make every test that passes prove nothing about production.

### Decision 6: Enumeration of backend outbound-fetch sites

Established by searching `backend/src/main/scala` (not the test tree) for `singleRequest`, `Http(`,
`superPool`/`outgoingConnection`, and the JDK/third-party clients (`openStream`, `openConnection`, `HttpClient`,
`fromURL`, okhttp). The latter return nothing: Pekko HTTP is the backend's only outbound HTTP client.

| Site | Destination | Status |
| --- | --- | --- |
| `ContentSourceSupport.fetchUrl` | caller-supplied | governed (owns the policy) |
| `CsvUrlFetch.fetch` | caller-supplied | governed (delegates to `fetchUrl`) |
| `RestApiConnectorDriver.issueAndParse` | caller-supplied | **unguarded today — fixed here** |
| `RestApiConnectorDriver.issueTest` | caller-supplied | **unguarded today — fixed here** |
| `OAuthRoutes` token exchange | literal `https://oauth2.googleapis.com/token` | exempt: not caller-influenced |
| `OAuthRoutes` profile fetch | literal `https://www.googleapis.com/oauth2/v3/userinfo` | exempt: not caller-influenced |
| `HttpResendEmailSender` | literal `https://api.resend.com/emails` | exempt: not caller-influenced |
| `HttpClaudeTransport` (×3) | literal `https://api.anthropic.com/v1/messages` | exempt: not caller-influenced |
| `HttpServer` | inbound bind, not a fetch | n/a |
| `GcsFileSystem` | Google Cloud SDK, operator-configured bucket | exempt: not caller-influenced |
| `SqlConnectorDriver` | caller-supplied host, JDBC not HTTP | **exposed, out of scope — see Risks** |

The four exempt HTTP sites are hard-coded `Uri` literals with no interpolation — each was read to confirm, not assumed
(`OAuthRoutes.scala:61`/`:83`, `HttpResendEmailSender.scala:77`, `HttpClaudeTransport.scala:135`).

### Decision 7: Stored-data disposition — no migration, refuse at fetch

Existing rows are not scanned, rewritten or deleted; a stored row whose destination is now disallowed simply fails at
fetch with the disallowed-address error. Deletion is irreversible and a row that cannot be fetched is already inert.
The executor states the observed dev-database count in the PR body, and must not touch production (barred this run).

### Decision 8: The fetch-time refusal rides the existing untyped error channel

`RestApiConnectorDriver` returns `Either[String, _]`, and `SourceService` maps a driver `Left` to
`ServiceError.BadGateway` (502) at eight sites (lines 167, 189, 198, 279, 294, 322, 335, 342). So an egress refusal
returned from inside `issueAndParse`/`issueTest` surfaces as a 502 whose message names the disallowed address, not a
400.

The connection-test paths are the one exception, and they are not routed through that mapping at all: `testRest`/
`testSql` convert a driver `Left` into a 200 `TestConnectionResponse(ok = false, error = Some(err))`
(`ConnectionTest.scala:24-25`, `SourceService.scala:229-230`). A refusal there is therefore reported as `ok = false`
with the address named in `error` — which is what task 4.3 and `specs/connection-test-endpoint` require.

That is not ideal — a refused destination is a caller error, and 502 invites a pointless retry. The alternative is a
typed channel (in-repo precedent: `CsvUrlFetchError`, introduced because a bare `Left[String]` leaves "only
message-substring matching to recover the status, which nothing authorises"). But that `Either[String, _]` is fixed by
the shared `ConnectorDriver` trait that `SqlConnectorDriver` also implements, with ~10 consumers destructuring it —
typing it is a refactor of the connector contract, and folding it into a security fix blows this diff exactly as
folding this fix into HEL-862 would have blown that one.

So: accept the 502 for fetch-time refusals, require the message to name the disallowed address (specified), keep the
create/update refusal a true 400 (unaffected), and carry the typed-channel refactor as a follow-up beside the SQL one.
Recorded rather than hidden, because it is the one place the delivered behavior is knowingly weaker than ideal.

## Risks / Trade-offs

- [SQL connector remains an egress hole] → Enumerated openly rather than quietly fixed or dropped. JDBC needs a
  different mechanism (no `ClientTransport`), so folding it in would double this diff and blur the review. Follow-up.
- [Per-request pool settings lose connection reuse] → The pin makes each destination's settings distinct, so pool keys
  differ per address. REST fetches are low-frequency, and `ContentSourceSupport` already took this trade.
- [DNS lookup added to create/update] → One resolution per Connector write, a rare operation.
- [A Connector pointed at a private address stops working] → Intended; that is the vulnerability. See Decision 7.
- [An egress test silently written with a `fetchOverride` driver proves nothing] → Decision 2 states the bypass and
  tasks 4.4/4.7 mandate `fetchOverride = None`; a reviewer seeing a `fetchOverride` in an egress test should treat it
  as a defect.
- [502 misclassifies a caller error] → Accepted and specified (Decision 8), with the typed-channel follow-up named.
- [Tests could pass by weakening the guard] → The hostname-keyed `isBlocked` seam is the mitigation; a test admitting a
  whole address class rather than one hostname is a defect.

## Planner Notes

Self-approved (no escalation): backend-internal, reuses an existing in-repo guard, no new dependency, no schema change,
no broken API contract for allowed destinations. The judgements worth flagging to review are: Decision 2's
departure from the ticket's literal wording (the ticket names the two builders; this design guards the two issuers,
a strict superset in production); Decision 8's acceptance of a 502 for fetch-time refusals rather than refactoring the
connector error contract; and Decision 7 (no migration) plus the SQL deferral as the two scope boundaries.

This document runs to ~173 lines, over the 150-line guideline; every line over came from round-1 change requests, and
deleting skeptic-mandated content to hit a style target would be the wrong trade.

Round-1 design-gate corrections (skeptic-design-1.md): the error-classification contradiction is resolved in Decision 8
and both spec files; the driver wiring site is corrected to `Main.scala:165` in Decision 5; the `fetchOverride` bypass
is documented in Decision 2 and enforced in tasks 4.4/4.7; the `ContentSourceSupport` citation and idiom are corrected
in Decision 3. Decisions 1, 6 and 7 were independently verified by the skeptic and are unchanged. Decision 6's table
scope is `backend/src/main/scala`, not the test tree.
