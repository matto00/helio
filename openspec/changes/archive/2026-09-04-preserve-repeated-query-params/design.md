## Context

See proposal.md - Why. Ground truth on `main` at `0f16b85d`:

- `RestApiConfig.queryParams: Map[String, String]` (`domain/model/model.scala:529`).
- `RestApiConnectorDriver.buildResolvedRequest:138-139` composes the query as
  `resolvedQueryParams.foldLeft(Uri(joinUrl(...))) { case (uri, (k, v)) => uri.withQuery(Uri.Query(uri.query().toMap + (k -> v))) }`.
- `injectAuthQueryParam:222` repeats the same `uri.query().toMap + (k -> v)` pattern.
- `RestSourceConnectorMigration.splitUrl:82` returns `queryPairs.toMap`, with a warning log at 131-138.
- `DataSourceProtocol.RestApiConfigPayload.queryParams: Option[Map[String, String]]` (line 157), mapped at 394/410.
- `DataSourceConfigCodec.decodeRest:57` is total by construction (HEL-826) -- it never validates, only decodes.
- Frontend `useRestSourceForm` already holds `KeyValueEntry[]` (ordered, duplicate-capable) and flattens it with
  `toRecord` at line 116 -- the collapse is at the wire boundary, not in the UI state.

## Goals / Non-Goals

**Goals.** One ordered representation end to end; both wire encodings decode; no persisted-row rewrite.

**Non-Goals (design-level).** No change to header representation. No validation added to any decode path. No new
abstraction over Pekko's `Uri.Query` -- it is already an ordered multi-map and is the natural target type.

## Decisions

**D1. Domain type is a named wrapper `QueryParams` over `Seq[(String, String)]`, not a bare `Seq`, not
`Map[String, Seq[String]]`, and not `Uri.Query`.**
A sequence of pairs preserves interleaving (`?a=1&b=2&a=3`), which a multi-map keyed by name does not; the
acceptance criterion says *order*, not *grouping*. `Uri.Query` was rejected as the domain type because it carries
rendering concerns and would put a request-composition type in the persisted config model. (It is *not*
rejected on layering-purity grounds: `model.scala` already imports `spray.json._` and Pekko's
`ContentType`/`ContentTypes`.) Alternative considered: `Vector[(String, String)]` -- same semantics.

The *wrapper* (rather than a bare `Seq[(String, String)]`) is load-bearing for three reasons found at the
design gate. (a) `jsonFormatN` resolves formats by field type, not per field, so a bare `Seq` would need a
loose `implicit JsonFormat[Seq[(String, String)]]` in scope in three separate files
(`DataSourceProtocol`, `DataSourceConfigCodec:20`, `PipelineProposalProtocol:154`) and would risk ambiguity
with spray's own `immSeqFormat`/`tuple2Format`. (b) A `RootJsonFormat[QueryParams]` declared in
`QueryParams`'s **companion object** is found by implicit resolution with no import anywhere, which keeps the
`PipelineProposalProtocol.scala` edit to exactly the two fenced lines -- no third import line, so no fence
widening is needed. (c) It gives the dual-read decoder one obvious home.

**D2. Wire is a JSON array of `{"name": ..., "value": ...}` objects; the legacy JSON object still decodes;
anything else still fails loud.**
`QueryParams`'s companion `RootJsonFormat` reads `JsArray` (new) or `JsObject` (legacy) and always *writes*
the array. The legacy `JsObject` branch takes entries in **key-sorted order**, not document order: spray-json's
parser builds a `JsObject`'s `fields` into a `TreeMap` (`spray/json/JsonParser.scala:100`), so
`fields.toVector` is already key-sorted by the time `QueryParams.read` sees it -- there is no document-order
information left to recover at that point. This is NOT a regression: a legacy row is map-shaped precisely
because it has no duplicate keys (a `Map` can't have stored one), and the PRE-CHANGE composition read that same
`Map` through a hash-based `foldLeft`/`.toMap`, whose iteration order was equally arbitrary (not
document-order-preserving either). Pinned by a decode test using a fixture whose document order differs from
alphabetical (`{"z":"1","a":"2"}` decodes to `Vector("a" -> "2", "z" -> "1")`, not `Vector("z" -> "1", "a" -> "2")`).
Any **other** JSON shape -- a string, a number, an array of
non-objects, an entry missing `name`/`value` -- SHALL throw `DeserializationException`, which
`DataSourceConfigCodec.decodeRest:64-68` already catches and maps to
`Left("malformed: could not decode rest_api config")`. This is what decode-is-total means here: `decodeRest`
returns an `Either` and never throws to its caller. It emphatically does **not** mean swallowing a malformed
value to empty -- doing so would fetch with no query params and no signal, which is this ticket's own defect
class reintroduced by its fix. Alternative considered: keep writing the object shape and only
read arrays -- rejected, because then a source authored with duplicates would round-trip lossily through
create-then-read, which is the defect in a different costume. Alternative considered: a sibling field
(`queryParamsOrdered`) -- rejected during planning escalation; it leaves the collapsing field live.

**D3. Dual-read, no migration.** Persisted rows keep their JSON-object `queryParams` until the source is next
written, at which point it is re-encoded as an array. No Flyway migration exists or is permitted for this run,
and none is needed: `data_sources.config` is JSONB read through `decodeRest`, so shape tolerance is a decoder
concern. Rollback is therefore trivial -- an array-shaped row written by this change would fail to decode on an
older binary, so the rollback window is "before any source is re-saved", which is stated in the PR.

**D4. Composition builds `Uri.Query` once, from the endpoint's own query plus the config's pairs, in order.**
Replaces the per-param `toMap` fold. The old fold did NOT drop an endpoint-carried query string outright --
its distinct pairs survived `uri.query().toMap` -- but that `Map` conversion silently REORDERED them (hash-based
iteration, not insertion order) and COLLAPSED any duplicate key within them to its last value; a second,
previously untracked defect at the same site, distinct from the config-side collapse this ticket's ACs name.
Pekko's `Uri.Query` is an ordered multi-map, so `Uri.Query((existingPairs ++ configPairs): _*)` preserves both
the endpoint's pairs (in their original order, duplicates included) and the config's pairs, concatenated.
`injectAuthQueryParam` appends the auth pair rather than rebuilding through `toMap`.

**D4a. The auth query parameter still wins a name collision.** Today's `uri.query().toMap + (name -> value)`
silently gave auth-overwrites-source semantics -- the query-side twin of the explicit auth-header-always-wins
rule at `RestApiConnectorDriver.scala:150-156`. A naive append would change that, letting a source configured
with `?api_key=attacker` produce `api_key=attacker&api_key=<real credential>`, which many servers resolve to
the first occurrence. So `injectAuthQueryParam` SHALL first drop every existing pair whose name equals
`apiKeyName`, then append the auth pair. Preserving that behavior is not optional: relaxing a credential
precedence rule as a side effect of a representation change would be a security regression.

**D5. Templating resolves per occurrence.** `resolveMapValues` becomes an ordered traversal over pairs, so
`?tag={{a}}&tag={{b}}` resolves both. Failure semantics are unchanged: the first unresolved variable is a
`Left` before any request is built. Keys are not templated (they are not today either).

**D6. Frontend stops collapsing at the boundary.** `useRestSourceForm.toRecord(queryParams)` becomes an ordered
array mapping; `KeyValueListField` already models duplicates in state, so no UI change is needed. This is in
scope because it is the same collapse in the same data path, one function call away; it is not REST form
*parity* (HEL-827's scope). Headers keep using `toRecord`.

**D6a. `SourceService`'s bare-`url` create path stops discarding the query string.**
`SourceService.scala:113` destructures `splitUrl` as `(baseUrl, endpoint, _, _)` and the `RestApiConfig` it
builds at 126-134 sets no `queryParams` at all, so a source created as `url = "https://api/x?tag=a&tag=b"`
issues *neither* value -- a fourth collapse point, and the one that most directly defeats acceptance
criterion 1 as worded ("a source authored with `?tag=a&tag=b`"). The pairs from `splitUrl` are passed
through, concatenated with any `request.config.queryParams`. Noted but explicitly **not** fixed here: the same
constructor also drops `request.config.parameters`, a separate HEL-823 templating defect that has nothing to
do with query-param representation -- it gets a spinoff ticket, not silent absorption.

**D7. The migration's duplicate-key warning is deleted, not kept.** `splitUrl` returns all pairs, so the
`hasDuplicateKeys` flag and its `logger.warn` describe a condition that can no longer occur. Leaving a warning
that can never fire is worse than removing it. The PR calls out that this warning previously existed.

## Risks / Trade-offs

- [An array-shaped row is unreadable by an older binary] → Rollback window is documented; no row is rewritten by
  deploy alone, only by a subsequent save of that source.
- [`PipelineProposalProtocol` collides with a parallel run] → Fence exemption granted for exactly its two
  `queryParams` lines; merge order is HEL-914 first, then rebase. If that field's type has changed underneath,
  escalate rather than guess.
- [A test that only asserts the fetch returned 200 proves nothing] → Every acceptance test asserts the query
  string *the server actually received*, via a real bound HTTP server, including its order.
- [Ordered-but-reordered is a subtler form of the same bug] → Order is asserted explicitly, with a fixture whose
  correct order differs from both alphabetical and insertion-into-a-map order.

## Migration Plan

No Flyway migration. Deploy is a plain binary swap; dual-read makes it forward- and backward-compatible for
unmodified rows. Rollback: revert the binary before any REST source is re-saved.

## Planner Notes

- Self-approved: including the frontend `toRecord` change (D6), on the grounds above.
- Self-approved: deleting the migration warning (D7).
- Escalated and answered before planning: the `PipelineProposalProtocol.scala` fence exemption.
