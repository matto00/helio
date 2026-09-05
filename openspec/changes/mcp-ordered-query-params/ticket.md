# HEL-982: helio-mcp still types REST queryParams as Record<string, string> — repeated query keys unreachable via the agent path

## Description

HEL-844 (merged to main as 9f1d37d2, PR #551) replaced the REST source's `queryParams` representation with an ordered, duplicate-preserving `QueryParams` type end to end, so `?tag=a&tag=b` now issues both values in order instead of silently collapsing to one. That fix is **closed for the UI/API path, and still open for MCP.**

`helio-mcp` continues to type `queryParams` as `Record<string, string>`. A TypeScript `Record<string, string>` cannot express a repeated key at all, so an MCP-authored REST source has no way to declare `?tag=a&tag=b`. What it sends is a JSON object, which the backend's dual-read decoder accepts via its legacy branch — and that branch yields **key-sorted** order, not authored order.

Do not read HEL-844 as having closed the silent-corruption class. It closed it for sources authored through the UI and the REST API. Through the agent path the original defect is still fully reachable: an agent that needs a repeated query key cannot express one, and the ordering it does get is alphabetical rather than what it intended. This is the same silent-wrong-answer shape — the request succeeds, the response parses, the data is wrong — just entering through a different door. **This ticket is what actually closes the defect class.**

## Enumeration (corrected — see premise-validation.md)

The ticket named three sites; the live tree has SIX. Re-enumerate from the tree; do not trust this list either. Prove completeness with a grep that returns zero, not a hand-kept tally.

- `helio-mcp/src/types.ts:323` — `CreatePipelineRootRequest.restConfig.queryParams` (introduced by HEL-914)
- `helio-mcp/src/helioApi.ts:438` — `createRestDataSource` input type
- `helio-mcp/src/helioApi.ts:451` — pass-through into the POST body
- `helio-mcp/src/tools/restDataSourceSchema.ts:50` — `z.record(z.string(), z.string())`
- `helio-mcp/src/tools/pipelinesHandlers.ts:88` — explicit `as Record<string, string> | undefined` cast on the inline-root REST branch
- `helio-mcp/src/tools/write.ts:163/175` — pass-through typed by the zod schema

The READ path is affected too: the declared shape is now actively wrong against the array the backend emits.

## What changes

Bring `helio-mcp`'s REST source surface to the ordered array encoding the backend now emits and accepts:

- Widen every `Record<string, string>` queryParams site to ALSO accept the ordered `{name, value}[]` array encoding (a union — the object encoding must keep working).
- Update the MCP tool schema (zod) so an agent can author a repeated key deliberately, and so the tool description tells it how.
- The backend needs no change — it already dual-reads both encodings and emits the array form. **No Flyway migration is permitted in this change** (parallel runs share one dev Postgres); none is needed.

## Acceptance criteria

- [ ] An MCP-authored REST source with `?tag=a&tag=b` issues a request carrying BOTH values, in order — proven against a real local HTTP server, asserting the query string the server received, not that the call returned 200
- [ ] Authored order is preserved, not merely multiplicity, and not alphabetized
- [ ] Existing MCP callers sending the object encoding continue to work unchanged (the backend's legacy branch still accepts it)
- [ ] A red test demonstrates the current unreachability before the fix, so the guard is not vacuous
- [ ] Every collapse point is fixed, proven by a completeness grep returning zero

## Constraints inherited from HEL-844's post-mortem

1. **Fixture traps.** A 2-entry Scala `Map` is a `Map.Map2` which iterates in insertion order, so a small fixture passes before AND after the fix. `JsObject.apply` stores fields in the same sorted map the parser uses, so a fixture built that way is already alphabetical and cannot distinguish document order from sorted order. The JS analogue is live: a small object literal, and any fixture whose keys happen to be alphabetical, proves nothing. **Use fixtures of 6+ keys in deliberately non-alphabetical order.**
2. **Mutation-prove every ordering assertion red.** An assertion that cannot fail is not a guard.
3. **Confirm ORDER survives, not just multiplicity.** An ordered representation that silently reorders is a subtler version of the same defect.
4. **The proof is what the outgoing request CONTAINED**, not that a call returned 200.

## Out of scope

- No Flyway migration (hard constraint — shared dev Postgres).
- No browser/Playwright work (HEL-968 owns the shared session).
- No changes to the frontend river editor (HEL-968) or preview/engine (HEL-970).
- Header representation is unchanged (HEL-844 non-goal, inherited).
