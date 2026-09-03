## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review. Every fact below was derived from the files/network myself; nothing was
accepted from the prior reports or the orchestrator's brief.

### What I verified (with evidence)

**Round-2 CR1 — measured phase needs public egress; host named; absent-network behavior.**
- `design.md` Decision 8 now names `baseUrl = https://api.sleeper.app`, `endpoint = /v1/state/nfl`,
  states the outbound-network requirement, and explains WHY a local stub is impossible
  (`ContentSourceSupport.isBlockedAddress`).
- Verified that guard independently: `backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala:91-97`
  rejects loopback/link-local/site-local/any-local/multicast/`fc00::/7`. A local stub genuinely
  cannot be the target. The cited constraint is real, not rationalization.
- `tasks.md` 4.7b requires a preflight that exits NON-ZERO with a message naming the host and the
  egress requirement, with an explicit prohibition on downgrading to a static source, skipping, or
  reporting success. Matches CR1's ask literally.

**The named host is genuinely unauthenticated and genuinely usable — checked live, not assumed.**
- `curl -s https://api.sleeper.app/v1/state/nfl` with no credential → `HTTP 200`, 211 bytes,
  body is a bare JSON **object**: `{"week":1,"leg":1,"season":"2026",...}`.
- The orchestrator's specific worry (object, not array) is resolved in the plan's favor:
  `RestApiConnectorDriver.toRowsEither` (`.../domain/connectors/RestApiConnectorDriver.scala:265-269`)
  maps `case obj: JsObject => Vector(obj)` with `rootSelector = None`. A bare object yields exactly
  one row — non-empty, so 4.7c's row-set criterion is reachable. Schema inference runs over that row.
- So AC5's measurement is NOT built on an unusable host.

**Round-2 CR2 — pass criterion.** `tasks.md` 4.7c requires the script to FAIL unless `inferredSchema`
is non-null AND `fetchError` is null AND the Output materializes a non-empty row set, with the reason
stated (a fetch-failed source still returns HTTP success). 4.8 additionally requires confirming in the
transcript that 4.7c's assertions all evaluated. Addressed.

**Round-1 CRs — checked for regression, none found.**
- Fresh-user teardown mechanism (CR1): `POST /api/auth/register` exists
  (`api/routes/auth/AuthRoutes.scala:39`) and `RegisterRequest` is `{email, password, displayName?}`
  with no invite code (`api/protocols/auth/AuthProtocol.scala:8`). `pathPrefix("tokens")` exists
  (`api/routes/auth/ApiTokenRoutes.scala:30`). `DELETE /api/connectors/:id` exists
  (`ConnectorEntityRoutes.scala`, `delete { ServiceResponse.runNoContent(connectorService.delete(...)) }`).
  Connectors have **no** `tag` column (`V93__connectors.sql`), confirming `teardown_resources` cannot
  reclaim one — the premise of Decision 8 holds.
- No registration-time seeding in `AuthService` (grep for `seed|DemoData` → empty), so a fresh user's
  Connector list is empty by construction and the AC4 empty-list precondition is real on every run.
- Tier gating is chat-only (`ApiRoutes.scala:424` note, `chatAccessServiceOpt`); a `free` throwaway user
  is not blocked from connectors/sources/pipelines. The setup phase is viable.
- Denylist extraction (Decision 3 / task 2.1): `restDataSourceSchema.ts:31-59` has exactly the five
  fields and the message design.md quotes; the two-axis parameterization is a correct reading.
- Backend credential-less create (Decision 1): `ConnectorEntityService.create:64` —
  `cred.isEmpty && authType != "none"` is the only rejection, so `authType:"none"` + `credential:""`
  is accepted, and egress-validated before any row is written. HEL-822 CR6 claim is accurate.

**AC traceability (literal wording).** AC1 → tasks 1.2/2.2/2.3 + Decision 1. AC2 → task 4.1's
"existing assertions MUST pass unmodified" + `.strict()` retained on both schemas. AC3 → Decision 7
deferral (explicitly permitted by the AC's own text) + task 5.1's filing-and-record-back. AC4 →
tasks 2.5/2.6 + the two spec scenarios. AC5 → tasks 4.7/4.7b/4.7c/4.8, now with both a host and a
pass criterion. The MCP tools the measured leg needs all exist today (`propose_pipeline`,
`apply_pipeline_proposal`, `add_output`, `run_pipeline`, `get_output_rows` in `helio-mcp/src/tools/`).

**Note (d)** now states plainly what teardown does and does not reclaim rather than re-asserting
"nothing is orphaned" — the correction asked for. **Note (e)** ordering/headings read cleanly.

### Verdict: CONFIRM

Both round-2 CRs are genuinely closed against ground truth, round-1's four have not regressed, and
the one fact the orchestrator flagged as potentially fatal (object-shaped Sleeper response) checks
out in the plan's favor. Nothing new rises to blocking.

### Non-blocking notes

- **Unstated env dependency in the measured phase.** Creating *any* Connector mints a
  `connector_credentials` row — `ConnectorRepository.create:66` → `ConnectorCredentialRepository.create:33`
  → `secretBackend.encrypt(plaintext)`, which fails hard (`ConnectorCredentialEncryptionFailed`) without
  `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID`. There is no empty-plaintext short-circuit, so
  `credential: ""` still goes through encryption. This worktree's `backend/.env` does set it (verified),
  so the run is not blocked — but 4.7b's preflight currently only diagnoses absent egress. Worth having
  it name a missing master key too, since that failure would otherwise surface as an opaque 500 from
  `POST /api/connectors` at the very first measured step.
- **Citation path drift.** Decision 8 cites `AuthProtocol.scala:8`; the actual file is
  `backend/src/main/scala/com/helio/api/protocols/auth/AuthProtocol.scala` (plural `protocols/`).
  Line 8 and the shape are correct.
- **The Sleeper payload is exactly one row.** 4.7c's "non-empty row set" is satisfiable, but with a
  margin of one. If the pipeline leg the script authors adds any filter/aggregate step, it must not
  reduce that single row to zero — otherwise the pass criterion fails for a reason unrelated to the
  capability under test.
