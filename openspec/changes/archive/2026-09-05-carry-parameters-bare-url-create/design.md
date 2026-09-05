## Context

See proposal.md — Why. The relevant current state, verified in the tree:

- `SourceService.scala` bare-`url` branch builds `RestApiConfig(connectorId, endpoint, method, queryParams,
  headers, body, bodyContentType, rootSelector)` by hand. `RestApiConfig.parameters` (model.scala) defaults to
  `Map.empty`, so the omission compiles silently and the caller's map is dropped.
- The sibling `connectorId` branch routes through `RestApiConfigPayload.toDomain`, which does carry `parameters`.
  Only the hand-rolled branch is defective.
- `POST /api/sources` rejects a bare `url` outright (400). The bare-`url` create branch is therefore reachable
  only internally — agent-authored pipeline proposals resolving an inline source. Tests must call
  `SourceService.createRest` directly, exactly as `SourceServiceBareUrlQueryParamsSpec` (HEL-844's guard at this
  same call site) already does.

## Goals / Non-Goals

- Goal: the persisted source carries the supplied `parameters`, proven by what a real HTTP server receives.
- Goal: a guard that is failable — reverting the one-line fix must turn the new test red.
- Non-Goal: any change to `TemplateInterpolator`, the unresolved-variable guard, escaping, or the ephemeral
  infer/test paths. Non-Goal: reopening bare-`url` on the public endpoint.

## Decisions

**D1 — Pass `parameters = request.config.parameters.getOrElse(Map.empty)` in the bare-`url` `RestApiConfig`.**
This mirrors how the branch already handles `headers` (`request.config.headers.getOrElse(Map.empty)`), so the
absent-field idiom is consistent within the same constructor. Alternative considered: route the branch through
`RestApiConfigPayload.toDomain` to eliminate the hand-rolled constructor entirely. Rejected as out of scope —
`toDomain` requires a `connectorId` the branch only obtains after `connectorRepo.create`, and HEL-844 already
established the hand-rolled shape here deliberately (D6a) to splice `splitUrl`'s query pairs. A structural
refactor of this branch is a separate, behavior-preserving ticket, not a rider on a data-loss fix.

**D2 — New spec file, modelled on `SourceServiceBareUrlQueryParamsSpec`, not an added case inside it.**
That spec's fixtures and assertions are query-param-shaped (ordered pairs, repeated keys); templating asserts a
different thing (resolved values in the received query string AND headers). A sibling file keeps each guard's
failure message pointing at one defect. The new spec reuses the same harness shape: `EmbeddedPostgres` + Flyway,
a real bound Pekko HTTP route capturing the received request, create via `SourceService.createRest`, fetch via
`RestApiConnectorDriver` against the SAME persisted Connector/config with no `fetchOverride`.

**D3 — Embedded Postgres, never the shared dev database.** The harness this spec copies already starts its own
`EmbeddedPostgres` and runs Flyway against it, so the concurrent HEL-987/HEL-985 runs and the shared
`flyway_schema_history` are untouched. This change adds no migration; the fix is a constructor argument against
an existing column-free field of the JSON config blob. If implementation ever appears to need a migration, that
is a signal the approach is wrong — escalate rather than write one.

**D4 — Red-first, then mutation-checked.** Order is mandatory and must be evidenced in the executor's report:
(1) write the test against unfixed `SourceService`, run it, capture the failure output — the failure must be the
unresolved-variable guard naming the template variable (or literal `{{...}}` reaching the server), which is the
defect's real signature, not a compile error or a fixture mismatch; (2) apply the one-line fix; (3) re-run, green;
(4) mutation-check by reverting the fix alone, confirming red again with the same signature, then restoring it.
A test that passes at step (1) is worthless here and must be rewritten, not accepted.

**D5 — Assert on the server-received request, not on the persisted config alone.** Asserting the stored
`parameters` map would pass on a fix that stores the map but never resolves it. The persisted-map assertion is
kept as a second, narrower assertion (it localises a failure), but the acceptance-criteria-bearing assertion is
the query string and header values the bound server actually saw.

## Risks / Trade-offs

- [The new spec duplicates ~60 lines of harness setup from the sibling spec] → Accepted deliberately; extracting a
  shared harness would touch a passing HEL-844 guard, and the repo's own convention here is one file per defect.
- [Embedded Postgres startup makes the spec slow] → Accepted; it is the only way to exercise the real persistence
  path, and the sibling spec already pays this cost.
- [A green test that never proved red] → Mitigated by D4's evidenced ordering plus the mutation check, which is
  the specific failure mode this repo has a documented history of.

## Migration Plan

None. No schema change, no data backfill, no wire-contract change. Sources already created through the defective
path keep an empty `parameters` map; they were non-fetching before this change and remain so until re-created —
backfilling them is impossible, since the dropped input was never persisted anywhere to recover.

## Planner Notes

Self-approved: the one-line fix's exact form (D1), the new-file test placement (D2), and treating the existing
`rest-api-connector` templating requirement as MODIFIED rather than adding a new requirement (the create-time
obligation is the missing half of the same contract, not a separate capability). No escalation raised: no new
dependency, no architectural change, no breaking change, and scope is strictly within the ticket.
