## Context

`POST /api/connectors` (`backend/src/main/scala/com/helio/api/routes/sources/ConnectorEntityRoutes.scala:48`)
already accepts a credential-less create: `ConnectorEntityService.create` refuses an empty `credential`
only when `authType != "none"` (HEL-822 CR6). `ConnectorAuthShape`
(`backend/src/main/scala/com/helio/domain/connectors/ConnectorAuthShape.scala`) defines the stored
non-secret config: `authType`, optional `apiKeyName`/`apiKeyPlacement`, optional `defaultHeaders`, and a
server-owned `implicit`. HEL-879's `checkCreateTimeEgress` runs on this path before anything is persisted.

On the MCP side, `helio-mcp/src/tools/read.ts` registers `list_connector_types` (→
`HelioApi.listConnectors()`, `GET /api/connector-types`) and `list_connectors` (→
`listConnectorInstances()`, `GET /api/connectors`). `write.ts` registers `create_rest_data_source` with
`createRestDataSourceSchema` from `tools/restDataSourceSchema.ts`, which is `.strict()` and carries five
always-rejecting `rejectCredentialField` entries. Both files use a local `jsonResult`/`guarded` pair
returning a `CallToolResult` whose `content` is an array of text blocks.

## Goals / Non-Goals

**Goals:**
- An MCP-only client reaches a working REST source from zero Connectors with no out-of-band HTTP call.
- No credential can enter the MCP surface, under any key — HEL-828's guarantee strictly preserved.
- A credentialed host yields an actionable, path-naming refusal rather than a validation error.

**Non-Goals:**
- Connector update/delete/rotate from MCP; the HEL-829-analogue pending-connector handoff; any backend
  change; any change to `create_rest_data_source`'s accepted inputs (only its error text changes).

## Decisions

**Decision 1 — `create_connector` creates credential-less Connectors only, and sends a literal empty
credential.** The tool posts `{name, kind, baseUrl, config: {authType: "none"}, credential: ""}`. The
`credential` field is a hardcoded `""` at the call site in `helioApi.ts` — it is never a parameter, never
defaulted from input, and no code path can populate it. This is what makes "no secret passes through a
model context" a structural property rather than a validation rule.

**Decision 2 — `authType` is an *input*, so the credentialed case has somewhere to land.** The schema
accepts `authType: z.enum(["none", "bearer", "api_key"]).optional()` (default `"none"`). Anything other
than `"none"` is refused **in the handler, before any HTTP call**, with prose naming the in-app
`/connectors` page (`frontend/src/app/AppRoutes.tsx:92`). Rejecting it at the Zod layer instead would
produce a generic enum error — exactly the "bare validation error" the ticket rules out. Refusing in the
handler also guarantees the no-half-created-state scenario: the refusal returns before `helioApi` is
touched.

**Decision 3 — the credential denylist is extracted and shared, not duplicated.** `rejectCredentialField`
moves from `restDataSourceSchema.ts` into a new `tools/credentialDenylist.ts`, re-exported by both
schemas. The current message is
`"<field> is not accepted by create_rest_data_source — credentials live on the referenced Connector,
never on this call. Pass connectorId instead."` — **two** things vary across the two call sites, not one
(skeptic-design-1 note (a)): the **tool name** and the **correct alternative**. The extracted helper
therefore takes both as parameters, `rejectCredentialField(field, {toolName, alternative})`, so
`create_rest_data_source`'s message is byte-identical to today's *by construction* rather than by
accident, and `create_connector` names the `/connectors` out-of-band path instead. A copy would drift;
this is the same extraction precedent `restDataSourceSchema.ts` itself cites.

**Decision 4 — no `defaultHeaders` input on `create_connector`.** `ConnectorAuthShape` supports it, but a
free-form header map is a credential-shaped channel (`Authorization: Bearer …`). To be precise about what
this buys (skeptic-design-1 note (b)): `create_rest_data_source` already accepts a per-source
`headers: z.record(z.string(), z.string())`, so such a value can already traverse this surface today,
pre-dating this ticket. Omitting `defaultHeaders` therefore **does not widen that existing channel** — it
is a tightening relative to what `ConnectorAuthShape` would allow, not a claim that the surface is
airtight. Closing the pre-existing per-source `headers` channel is out of scope here and is noted as a
separate concern in Risks below. The unauthenticated case this ticket exists to unblock needs no header
input at all, so omission costs nothing.

**Decision 4b — the credentialed dead end is signposted on the UNDECLARED path too.** Decision 2 only
fires when an agent self-declares `authType`. The realistic path (skeptic-design-1 CR4) is an agent that
omits `authType`, takes the `"none"` default against a credentialed host, creates a useless Connector,
and then hits a bare 401 with no next step. Two additions close this: (i) `create_connector`'s **success**
result carries a constant `note` field stating that if the host in fact requires authentication its
requests will fail with 401/403 and a human must create a credentialed Connector at `/connectors` —
deterministic, no inference required; (ii) `create_rest_data_source` appends that same `/connectors`
pointer to its returned `fetchError` when the backend's message indicates a 401/403. (ii) is best-effort string matching over a
message the backend forwards unmodified (`ConnectorDriver.scala:106-109`); (i) is load-bearing and must
not depend on (ii).

**Decision 5 — discoverability is added as an extra text block, not a wire-shape change.**
`list_connectors` keeps returning the bare `ConnectorSummary[]` JSON; when it is empty, the handler
appends a **second** text content block naming `create_connector`. Wrapping the array in an envelope
would break the existing spec scenario ("the result is an empty list") and every consumer of the shape.
For `create_rest_data_source`, `connectorId`'s Zod validator gains a custom message naming both
`list_connectors` and `create_connector`; no field is added or removed.

**Decision 6 — the backend's refusal is surfaced verbatim.** `create_connector` uses the same `guarded`
wrapper as its siblings, so a `HelioApiError` from `POST /api/connectors` (bad `baseUrl`, egress-guard
refusal from HEL-879, bad kind) reaches the agent with the backend's own message and status. No message
is re-authored client-side, so the guard's reasoning is not paraphrased into something less accurate.

**Decision 7 — the pending-connector handoff is DEFERRED, and the follow-up is filed.** The ticket's AC
permits this explicitly ("if it is deferred, record that decision and file the follow-up"). A pending
Connector row needs a backend state model, a completion URL, an expiry, and a UI — a design ticket in its
own right, not a tool addition. What ships here is the actionable refusal of Decision 2 plus Decision
4b's undeclared-path signposting. The follow-up ticket is filed as an explicit, checkable task
(tasks.md 5.1), not as an intention — its HEL-id is recorded back into this Decision, so an unfiled
follow-up leaves a visibly incomplete task and an empty slot here.

**Follow-up ticket id: HEL-955** — "Pending-connector handoff: let an MCP agent start a credentialed
Connector that a human completes out-of-band" (filed at task 5.1, parent epic HEL-857).

**Decision 8 — acceptance is proved by a scripted e2e against a FRESH USER, not by tag-based teardown.**
Connectors carry no `tag` column and `WorkspaceTeardownService`/`Repository` never touch them, so
`teardown_resources` cannot reclaim one, and there is deliberately no `delete_connector` tool — a
tag-based script would orphan a row per run AND destroy its own zero-Connector precondition on run 2
(skeptic-design-1 CR1). The actual mechanism: a new `helio-mcp/e2e/connector-authoring.ts` whose **setup phase**, explicitly
outside the measured build, provisions a throwaway user — `POST /api/auth/register` with a
run-unique email (`RegisterRequest` is `{email, password, displayName?}`, no invite code —
`AuthProtocol.scala:8`), then `POST /api/tokens` with the returned session cookie to mint a PAT. That
user's Connector list is genuinely empty by construction, so `list_connectors` (empty + hint) is a real
precondition that stays true on every run, forever, with no cross-run interference in the shared dev
Postgres. The **measured phase** then spawns the MCP server under that PAT and runs `list_connectors` →
`create_connector` → `create_rest_data_source` → pipeline/Output through MCP tool calls only. A
**teardown phase**, again outside the measured build, deletes the created Connector by id via
`DELETE /api/connectors/:id` (`ConnectorEntityRoutes.scala:86`).

Exactly what teardown reclaims (skeptic-design-2 note (d)): the script ATTEMPTS to delete the
Connector; the data source, pipeline, Output, throwaway user and its PAT are **not** reclaimed.
Corrected against a real run (executor, first live measurement of task 4.8): the Connector
delete predictably 409s with `ConnectorHasDependents`, because the data source created against
it is deliberately never reclaimed -- so in practice the Connector is left behind too, alongside
everything else. This corrects this Decision's original claim ("the Connector is deleted"), not
a new gap: the script logs the failed delete as a non-fatal warning rather than failing the run
over it, and the isolation property below is unaffected either way. Accepted, not overlooked —
all created resources are partitioned under a disposable per-run user, so none can affect a
later run or a human's workspace. The claim is "nothing leaks across runs", not "nothing is left
behind".

**The measured phase requires real public-internet egress, and this is stated rather than assumed**
(skeptic-design-2 CR1). HEL-879's `checkCreateTimeEgress` → `ContentSourceSupport.isBlockedAddress`
(`services/sources/ContentSourceSupport.scala:90-96`) rejects loopback, link-local, site-local, any-local,
multicast and `fc00::/7`, so a **local stub HTTP server cannot be the target** — the Connector could not be
created against it at all. The measured phase therefore targets a concrete public unauthenticated host:
`baseUrl = https://api.sleeper.app`, `endpoint = /v1/state/nfl` (small JSON object, no credential, the same
API family as the HEL-857 rebuild that produced this ticket). `e2e/sleeper-rebuild.ts:8-20` refuses to assume this egress
and uses static sources instead; this script cannot, because a credential-less REST Connector against a
reachable host is the literal thing AC1/AC5 require it to prove. The dependency is made loud: the script **preflights** reachability of
that host and, when it is unreachable, **exits non-zero with a diagnosable message naming the host and the
egress requirement**. It never downgrades to a static source, never skips, and never reports success — an
absent network makes the AC5 measurement *unavailable*, which is a failed run, not a passed one.

The "no out-of-band HTTP call" assertion (AC5) has a stated, checkable mechanism (skeptic-design-1 note
(c)): the measured phase reaches the backend **only** through the spawned MCP child process over stdio —
the script holds no HTTP client and no PAT-bearing fetch in that phase — while the setup/teardown phases
that do issue HTTP are separated into their own functions that run before and after the measurement
window and are excluded from it by construction, not by assertion about the script's own source.

## Risks / Trade-offs

- **Widening the "forbidden" requirement is a security-relevant edit.** Mitigated by scoping the change to
  secrets rather than to Connector existence, keeping `.strict()` + the denylist on the new tool, and
  hardcoding `credential: ""` at the call site. The existing denylist test must pass unmodified — if it
  needs editing, that is a signal the guarantee moved, not that the test was stale.
- **An agent could point `create_connector` at an internal host.** Not a new exposure: HEL-879's
  create-time egress guard runs server-side on this exact path and is unchanged.
- **The pre-existing per-source `headers` channel on `create_rest_data_source` can carry an
  `Authorization` value.** Out of scope for this ticket (it predates it and closing it would change a
  shipped tool's accepted inputs), but stated plainly here rather than left implied by Decision 4, so it
  is not mistaken for something this change introduces or something already solved.
- **`authType: "api_key"`/`"bearer"` accepted-then-refused could read as a half-built feature.** The
  refusal text states plainly that the human completes it at `/connectors`, so the dead end is signposted
  rather than silent — which is the ticket's actual complaint.

## Planner Notes

Self-approved: reusing `mcp-data-source-tools` rather than introducing a new capability (the tool is a
data-source-authoring tool and the modified requirement already lives there); deferring the
pending-connector handoff per the AC's explicit allowance; omitting `defaultHeaders` (Decision 4) as a
tightening, not a scope cut.
