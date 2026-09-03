## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Every Context claim in design.md, checked against the real files:**

- `ConnectorEntityRoutes.scala:48` is the `post {` for `POST /api/connectors` — `grep -n "post {"` returns
  `48:            post {`, `49: entity(as[CreateConnectorRequest])`. **Accurate.**
- `ConnectorEntityService.create` permits an empty credential only when `authType == "none"` —
  `ConnectorEntityService.scala:64-65`: `else if (cred.isEmpty && authType != "none") … BadRequest("credential is required")`.
  **Accurate**, including the HEL-822 CR6 attribution in the source comment.
- `ConnectorAuthShape` fields: `authType`, `apiKeyName`, `apiKeyPlacement`, `defaultHeaders`, server-owned
  `` `implicit` `` — matches the case class verbatim. **Accurate.**
- HEL-879's `checkCreateTimeEgress` runs before persistence — `ConnectorEntityService.scala:72`, after the
  empty-check, before `DataSourceKind.parseKind` and any write. **Accurate.**
- `read.ts` registers `list_connector_types` → `api.listConnectors()` (line 160) and `list_connectors` →
  `api.listConnectorInstances()` (line 175); local `jsonResult`/`guarded` at lines 18/23. **Accurate**
  (including the counter-intuitive `listConnectors()`/`listConnectorInstances()` naming inversion).
- `restDataSourceSchema.ts` is `.strict()` with exactly five `rejectCredentialField` entries
  (`auth`/`apiKey`/`token`/`password`/`credential`). **Accurate.**
- `frontend/src/app/AppRoutes.tsx:92` is `<Route path="/connectors" element={<ConnectorsPage />} />`.
  **Accurate.**

**Adversarial probes requested:**

- *Decision 1 (`credential: ""` hardcoded at the call site).* Sound. The backend genuinely accepts it only
  under `authType == "none"`, so the tool cannot create a credential-bearing Connector even if the handler
  guard were bypassed — the property is enforced twice, once structurally client-side and once server-side.
  Confirmed, no objection.
- *Decision 3 (shared denylist).* The extraction is safe in principle and task 4.1 correctly makes the
  pre-existing test the regression guard. One imprecision, non-blocking — see note (a).
- *Decision 4 (omit `defaultHeaders`).* Confirmed as a tightening, not a weakening. See note (b) for the
  overclaim in its rationale.
- *`teardown_resources` coverage of Connectors.* `grep -n "onnector"` against
  `WorkspaceTeardownRepository.scala` and `WorkspaceTeardownService.scala` returns **zero matches**;
  `grep -n "tag"` against `domain/connectors/*.scala` returns **zero matches**. Connectors are neither
  taggable nor reclaimable. `write.ts` registers no `delete_connector` (only `delete_pipeline_schedule`,
  `delete_dashboard`, `delete_data_source`, `delete_panel`, `delete_pipeline`, `delete_pipeline_step`).
  `DELETE /api/connectors/:id` exists backend-side (`ConnectorEntityRoutes.scala:86`) but has no MCP tool.
- *e2e harness shape.* `helio-mcp/e2e/sleeper-rebuild.ts:179-181` runs against a long-lived
  `HELIO_API_BASE_URL` + `HELIO_PAT` account, not a fresh tenant.

### Verdict: REFUTE

The security narrowing itself is sound and I do not object to it — Decisions 1/2/6 preserve "no secret
passes through a model context" as a structural property, and the backend agrees independently. The
refutations below are about the plan's *acceptance evidence* and two literal-AC gaps.

### Change Requests

1. **Decision 8's teardown claim is false, and it makes the AC-5 measurement non-repeatable.**
   design.md:78-79 states "Resources are tagged for `teardown_resources` reclamation, so repeated runs do
   not orphan rows in the shared dev Postgres." Connectors carry no tag column
   (`domain/connectors/*.scala`, zero `tag` matches) and `WorkspaceTeardownService`/`WorkspaceTeardownRepository`
   never touch connectors (zero `onnector` matches). There is also no `delete_connector` MCP tool and
   adding one is an explicit non-goal. Consequences, both real: (i) every e2e run permanently orphans a
   Connector row in the shared dev DB — the exact hazard Decision 8 claims to have handled; (ii) task
   4.7's `list_connectors` **empty + hint** assertion is satisfiable at most once, because run 1's own
   Connector makes run 2's list non-empty. The acceptance script destroys its own precondition.
   Revise Decision 8 and task 4.7 to state the *actual* mechanism for reaching a zero-Connector workspace
   and for reclaiming the created Connector (e.g. a dedicated fresh e2e user + PAT, or an explicit
   out-of-band `DELETE /api/connectors/:id` in a teardown phase that is clearly outside the measured
   build), and delete the untrue tagging claim.

2. **AC3's filing half is committed to in prose only, with no task and no acceptance signal.**
   AC3 permits deferral only "if it is deferred, record that decision **and** file the follow-up".
   Decision 7 records the decision (satisfying the first half) and asserts "The follow-up ticket is filed
   during Delivery and its identifier recorded in the run summary" — but tasks.md sections 1–4 contain no
   task for filing it. Nothing in the plan fails if it is never filed. Add an explicit task (e.g. `5.1
   File the pending-connector-handoff follow-up ticket; record its HEL-id in design.md Decision 7`) so the
   deferral names a real, checkable task rather than an intention.

3. **The spec's ADDED requirement mandates the input Decision 4 exists to forbid.**
   `specs/mcp-data-source-tools/spec.md:115-116`: "The tool SHALL accept `name`, `baseUrl`, an optional
   `kind` … and **optional non-secret request-shaping configuration**." Decision 4 and task 2.2 deliberately
   ship *no* request-shaping input at all (the only remaining optional input, `authType`, is not
   request-shaping). The spec is the durable artifact; as written it directs a future implementer to add
   precisely the free-form header/config map Decision 4 identifies as a credential-shaped hole. Strike that
   clause, or replace it with wording that states the tool accepts no request-shaping configuration and that
   per-source `headers` on `create_rest_data_source` is the intended channel.

4. **AC3 is unmet on the path an agent will actually take.** Decision 2's actionable refusal fires only when
   the agent *self-declares* `authType: "bearer"|"api_key"`. Given a tool description that says it creates
   unauthenticated Connectors only (task 2.4), the realistic behavior is that an agent omits `authType`,
   takes the `"none"` default, successfully creates a useless Connector against a credentialed host, and
   then hits a bare 401 in `create_rest_data_source`'s initial fetch — surfaced as a `fetchError` string
   that names no out-of-band path. AC3's literal wording is "For a host that does need a credential, the
   agent gets an actionable next step naming the out-of-band path — not a bare validation error," and that
   path yields exactly the bare error. Extend the plan (a decision + a task + a test) so the
   credentialed-host dead end is signposted on the *undeclared* path too — e.g. `create_connector`'s
   success result, or `create_rest_data_source`'s 401/403 `fetchError` handling, naming `/connectors`.

### Non-blocking notes

- (a) **Decision 3's parameterization is described as one-axis but is two.** design.md:46-47 says the message
   is "parameterized so `create_rest_data_source` keeps naming `connectorId` verbatim", and task 2.1 says
   "a parameterized 'correct alternative' message". The current text is
   `"<field> is not accepted by create_rest_data_source — … Pass connectorId instead."` — the **tool name**
   varies too, not just the alternative. State both parameters so "byte-identical" is achievable as
   specified rather than by accident.
- (b) **Decision 4 slightly overclaims.** It calls a free-form header map something "that would silently
   defeat Decision 1's structural guarantee", while the very next sentence notes `create_rest_data_source`
   already accepts a per-source `headers: z.record(z.string(), z.string())`. An `Authorization: Bearer …`
   can therefore already traverse this surface today, pre-dating this ticket. Omitting `defaultHeaders` is
   still correct and is not a regression — but the rationale should say "does not widen the existing
   per-source `headers` channel" rather than implying the guarantee is currently airtight.
- (c) **AC5's "no out-of-band HTTP call" assertion has no stated mechanism.** A script asserting about its
   own source is not evidence. Naming the mechanism (e.g. the script imports no HTTP client and reaches the
   backend only through the spawned MCP process) would make the claim checkable.
