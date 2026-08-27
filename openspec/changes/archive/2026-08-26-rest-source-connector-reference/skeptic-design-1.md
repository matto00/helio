## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/rest-api-connector/spec.md`, `specs/connectors/connector-management/spec.md`).
- `backend/src/main/scala/com/helio/domain/model/model.scala:492-503` — `RestApiAuth` ADT and
  `RestApiConfig(url, method, auth, headers)` are exactly as the design describes.
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceConfigCodec.scala:37-48` —
  `decodeRest` really does swallow `DeserializationException`/`NoSuchElementException` into
  `RestApiConfig(url = "")`. Decision 6's characterization is accurate.
- `.../persistence/sources/ConnectorRepository.scala:124-141` — `delete(id, user, dependentCount)`
  with the always-zero default; `ConnectorEntityService.scala:18-20,81` takes `dependentCount`
  as a constructor param. The seam is genuinely reachable: supplying a real function at the
  `Main.scala` construction site requires no change to HEL-821 code. **Decision 5 / tasks 3.1-3.4
  are sound.**
- `.../persistence/sources/ConnectorRepository.scala:175-185` — `connectors` columns
  (`base_url`, `config` JSONB, `credential_id UUID NOT NULL`). No new table is added by this
  change, so **Decision 2's "nothing to add to HEL-842's `RlsPolicyGuardSpec` allowlist" is
  correct as assessed** (task 5.1's "state the confirmation explicitly" is the right handling).
- HEL-821 archive `design.md` Decision 1/2 — `connectors.config` is specified as
  "kind-specific **non-secret** extras (e.g. SQL's port/database name, REST's optional default
  headers)"; the secret lives only in `connector_credentials`. There is **no auth-type
  discriminator** defined anywhere on the Connector.
- `.../domain/connectors/RestApiConnectorDriver.scala` — `buildRequest` is synchronous, takes only
  `RestApiConfig`, and `ConnectorDriver[Config]`'s `fetch`/`testConnection`/`inferSchema` carry no
  acting user. Task 2.2 correctly identifies the threading work.
- `.../persistence/sources/DataSourceRepository.scala:25-45` — `rowToDomain` calls `decodeRest`
  in a **synchronous, non-`Either` list-mapping path**.
- `.../protocols/assistant/AssistantProposalToolSchemas.scala:145,177,274-276,305` — the agent
  tool schema hard-codes `rest_api {url, method?, auth?, headers?}` plus decode-pinned examples;
  `AssistantToolExecutor.scala:190-198,234-236` and `PipelineProposalProtocol.scala:26,90` consume
  `RestApiConfigPayload` for **inline** (source-less) rest configs.
- `frontend/src/features/sources/ui/forms/RestApiForm.tsx` + `AddSourceModal.tsx:18,32,112-153,486`
  + `dataSourceService.ts:50-60` — a **live, wired** "Add REST source" UI posts
  `{ url }` to `POST /api/sources`, reachable from `SourcesPage`/`SidebarBody`.
- `ConnectorEntityService.create` (`ConnectorEntityService.scala:~44`) rejects an empty
  credential with `400 "credential is required"`.

### Verdict: REFUTE

The `dependentCount` plan (Decision 5), the HEL-842 assessment (Decision 2), the irreversibility
statement (Decision 8), and the `schemas/` resolution (Decision 9) all hold up. The migration
design and the auth-relocation threading do not.

### Change Requests

1. **Decision 3 contradicts Decision 7 on where the auth *shape* lives — as written, migrated
   api-key sources cannot fetch.** Decision 3 says the Connector's `config` JSONB "carries the
   auth-type discriminator … reusing the existing `RestApiAuthPayload`-shaped JSON". Decision 7's
   migration then synthesizes the Connector with `config = "{}"`. For a legacy
   `ApiKeyAuth(name, value, in)` source, `name` and `in` (header vs. query) are **not** part of
   the credential plaintext and would be discarded — the migrated source would issue a request
   with no api-key header/param at all, silently failing the ticket's primary AC ("every
   pre-existing REST source still fetches successfully after migration"). Bearer is also affected
   (no discriminator ⇒ the driver cannot know whether to emit `Authorization: Bearer` or nothing).
   Resolve: define the exact `connectors.config` auth-shape JSON (fields, and which enum values)
   and have Decision 7's migration write it, not `{}`. The spec delta's own scenarios
   ("the Connector has stored credential auth `{ type: "api_key", name: …, in: "header" }`")
   already assume this — the design must make it real.

2. **Reusing `RestApiAuthPayload` verbatim for `connectors.config` risks writing the plaintext
   secret into an unencrypted column.** `RestApiAuthPayload(type, token, name, value, in)`
   (`DataSourceProtocol.scala:128-134`) contains `token` and `value` — the credential itself.
   HEL-821 Decision 1 specifies `connectors.config` as **non-secret extras only**. Decision 3 must
   state explicitly which fields are stripped before serialization (i.e. a separate
   secret-free shape: `type`, `name`, `in` only), or an implementer will plausibly persist the
   token in plaintext JSONB — defeating HEL-536/821's entire encrypted-at-rest guarantee and the
   ticket's "no credential remains on the source" AC in spirit.

3. **The proposal's stated Impact ("Frontend: untouched … no frontend caller exists yet for
   `rest_api` create in main, so no frontend break to coordinate") is factually false**, and the
   design's Decision-1 "this isn't a product question" reasoning rests on it. `RestApiForm.tsx` is
   live and wired through `AddSourceModal.tsx` (`createRestSource`, url-only config) from
   `SourcesPage`/`SidebarBody`. Under this design the in-app "Add REST source" flow returns 400
   for every user the moment this lands, and the Connectors UI that would replace it is HEL-824/827
   — later tickets. This is a real, user-visible break, not a where-the-credential-lives detail.
   Either (a) plan the minimal frontend change in this ticket, or (b) restate Decision 1 against
   the true facts and escalate the break to the human — but the current reasoning ("the
   end-user-visible outcome is identical either way") cannot stand once the false premise is removed.

4. **The agent/MCP wire surface is treated as out of scope but is compile- and contract-breaking
   here.** `AssistantProposalToolSchemas.scala` advertises `rest_api {url, method?, auth?, headers?}`
   with decode-pinned examples (pinned by `AssistantProposalToolSchemasSpec` through
   `RestApiConfigPayload`), and `AssistantToolExecutor`'s `test_connection` verifies **inline**
   rest configs with no source and no Connector context at all. Deferring to HEL-828 is not an
   option — changing `RestApiConfigPayload` breaks these at compile/test time. Add explicit tasks,
   and decide what `test_connection` on an inline rest config now means (it needs a `connectorId`
   and an acting user, which the current HEL-756 path has neither of).

5. **Decision 6 leaves the highest-traffic call site unspecified: `rowToDomain`.**
   `DataSourceRepository.scala:33` decodes rest config synchronously while mapping every row of
   `findAll`/`findById`. With `decodeRest` returning `Either`, the design must say what a `Left`
   does *there* — dropping the row silently makes a source vanish from the list (the same silent
   class the decision exists to kill), while throwing turns one bad row into a failed
   `GET /api/sources` for the whole account. "Most reject with a clear 5xx/log" is not a decision
   for this site. Name the behavior, and add a task/test for it.

6. **No-auth REST sources become uncreatable, with no plan.** `RestApiAuth.NoAuth` is today's
   default and a public/unauthenticated endpoint is a normal case, but every source must now
   reference a Connector, and `ConnectorEntityService.create` rejects an empty credential with
   `400 "credential is required"`. Decision 7's empty-string credential works only because the
   *migration* bypasses the service and calls `ConnectorRepository.create` directly. Post-migration
   there is no supported path to create a no-auth REST source. Decide this explicitly (relax the
   service validation for no-auth kinds, or state the capability loss) and cover it with a task.

7. **Task 4.5's "real round-trip proof" needs its pre-migration baseline made explicit.** It asserts
   the migrated source "returns the same data as before migration" but never says the pre-migration
   fetch is captured first. Given the dev DB has zero `rest_api` rows (design Context, which I did
   not independently re-verify), the seeded row is the only evidence available — so the task must
   spell out: fetch through the *legacy* path, record the response, migrate, fetch again, compare.
   Also extend 4.5 (or add a sibling) to cover an **api-key-in-query** legacy source, which is the
   case CR1 shows is most likely to migrate into a silently-broken request.

### Non-blocking notes

- `RestApiConnectorDriver.metadata.requiredFields` still declares `url` (with a comment describing
  the old payload). No task updates it; it feeds the HEL-484 connector registry the agent reads.
- Decision 3's `baseUrl + endpoint` "simple concatenation, caller supplies the leading slash" will
  produce `https://host/apiv1/x` or `https://host//x` for the obvious operator mistakes. A
  normalizing join is cheap; at minimum the migration's own URL split must be guaranteed to
  round-trip through it (task 4.1 reuses Pekko's `Uri` parser, which is fine — the risk is
  hand-authored values).
- Decision 4 puts both connector default headers and the auth discriminator in the same
  `connectors.config` blob with no stated key layout; CR1's fix should define the whole object.
