# HEL-844: REST query params silently collapse duplicate keys (?tag=a&tag=b)

## Description

The REST source path represents query parameters as a `Map[String, String]`, so repeated
query keys silently collapse to a single entry. A URL of `?tag=a&tag=b` migrates and
re-issues as `?tag=b` with no error and no warning.

`RestSourceConnectorMigration.splitUrl` uses `uri.query().toMap`, which is one place the
loss occurs. This is the repo's known silent-corruption class (HEL-814, HEL-671): the
request succeeds, the response parses, and the data is simply wrong in a way nothing
surfaces.

The fix replaces the `Map[String, String]` representation with an ordered structure that
preserves duplicates across the whole persisted-config path: parsing an entered URL,
persisted config, `{{name}}` template resolution (HEL-823), and request composition.

Constraint from HEL-826: decode is total; validation lives only at the request-issuing
choke points (`buildResolvedRequest` / `buildEphemeralRequest`). Do not reintroduce
validation into the decode path while changing the representation.

Backward compatibility matters: existing persisted configs use the map shape.

## Widened repro (orchestrator, pre-planning)

The ticket names one collapse point. There are three, and one non-defect:

1. `RestSourceConnectorMigration.splitUrl:82` — `queryPairs.toMap` (the ticket's instance).
2. `RestApiConfig.queryParams` (`model.scala:529`) — `Map[String, String]`, the persisted
   representation; collapses on decode regardless of how it was produced.
3. `RestApiConnectorDriver.buildResolvedRequest:138-139` — a *second, independent* collapse:
   `resolvedQueryParams.foldLeft(...) { case (uri, (k, v)) => uri.withQuery(Uri.Query(uri.query().toMap + (k -> v))) }`.
   This `toMap` does NOT drop any query string already carried on the `endpoint` outright --
   its distinct pairs survive -- but its Map iteration order means those pairs are silently
   REORDERED (hash order, not insertion order), and any duplicate key WITHIN them collapses to
   its last value. The same
   `uri.query().toMap` pattern repeats in `injectAuthQueryParam:222`. Fixing only the
   config representation leaves this collapse live.
4. NOT a defect: the ephemeral path (`buildEphemeralRequest:404`) builds `Uri(config.url)`
   directly and preserves duplicates already. Headers remain `Map[String, String]`; repeated
   request headers are out of scope for this ticket. The request body is an opaque string
   and is unaffected.

## Cross-run constraint (approved escalation)

`PipelineProposalProtocol.scala` is owned by a parallel run (HEL-914). The fence is lifted
for exactly lines 51 and 91 of that file (the coordinator quoted 55 and 95, which are that line pair in HEL-914's tree; on this base they are 51 and 91) (the `queryParams` DTO field and its `cfg -> DTO`
mapping) and nothing else in it. No Flyway migration may be written. No browser work.

## Acceptance criteria

- [ ] A source authored with `?tag=a&tag=b` issues a request carrying BOTH values, in order --
      demonstrated against a real HTTP server, not asserted from the config shape
- [ ] Ordering is preserved, not merely multiplicity
- [ ] `{{name}}` templating still resolves correctly against the new representation, including
      a templated value in a repeated key
- [ ] Existing persisted sources (map-shaped config) continue to fetch identically -- proven on
      real rows, with the migrate-vs-dual-read decision recorded
- [ ] HEL-826's decode-is-total invariant is not violated by the change
- [ ] A red test demonstrates the current collapse before the fix, so the guard is not vacuous
- [ ] The second collapse point in `buildResolvedRequest` (widened repro item 3) is closed,
      including the endpoint-carried query string case
