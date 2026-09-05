## Context

Ground truth on `main` at `9f1d37d2` (HEL-844 merged), re-enumerated from the tree rather than
from the ticket (whose three-site list is stale — there are six):

- `helio-mcp/src/tools/restDataSourceSchema.ts:50` — `queryParams: z.record(z.string(), z.string()).optional()`,
  inside a `.strict()` object. **This is the only site with a runtime effect**: zod rejects an
  array outright, so `create_rest_data_source` cannot carry the ordered encoding at all.
- `helio-mcp/src/helioApi.ts:438` — `createRestDataSource` input type `Record<string, string>`;
  line 451 passes it straight into the `POST /api/sources` body with no transformation.
- `helio-mcp/src/tools/write.ts:163/175` — destructure-and-forward; typed transitively by the zod schema.
- `helio-mcp/src/types.ts:323` — `CreatePipelineRootRequest.restConfig.queryParams` (added by HEL-914).
- `helio-mcp/src/tools/pipelinesHandlers.ts:88` — `config.queryParams as Record<string, string> | undefined`
  on the inline `rest_api` root branch.

Backend side needs nothing: `QueryParams`'s companion `RootJsonFormat` (HEL-844 design D2) reads
`JsArray` (new) or `JsObject` (legacy) and always writes the array;
`schemas/pipelines/create-pipeline-request.schema.json:42` already declares the dual-read
`oneOf [object, array, null]`.

**A distinction that decides what "red" means here.** The two authoring paths are broken to
different depths:

- `create_rest_data_source` is **runtime-blocked**. Zod's `z.record(z.string(), z.string())`
  rejects an array, so the agent gets a validation error. Genuinely unreachable.
- `create_pipeline` (inline root) and `add_root` are **type-blocked only**. Their zod schema is
  `config: z.record(z.string(), z.unknown())`, and `as Record<string, string>` is a type
  assertion with no runtime behavior — so an array already flows through to the backend today,
  by accident. The type is a lie, the capability is undocumented and unpinned by any test, and
  nothing stops a future refactor from "fixing" the type by collapsing the value.

This asymmetry MUST be stated honestly in the tests rather than papered over: a red-before test
for the inline path that claims runtime unreachability would be false. See D4.

## Goals / Non-Goals

**Goals.** One named union type across all six sites; the ordered array encoding expressible and
forwarded unmodified in authored order; the object encoding still accepted unchanged; every
ordering assertion mutation-proven; completeness proven by a zero-result grep.

**Non-Goals.** No backend change. No Flyway migration (hard constraint: parallel runs share one
dev Postgres — and none is needed, the encoding is already dual-read). No change to header
representation (HEL-844 non-goal, inherited). No browser work (HEL-968 owns the Playwright
session). No normalization between the two encodings (see D3). No frontend change.

## Decisions

**D1. One exported named union type, not six inline unions.**
Add to `helio-mcp/src/types.ts`:

```ts
export interface QueryParamPair { name: string; value: string }
export type QueryParamsInput = QueryParamPair[] | Record<string, string>;
```

Every one of the six sites references `QueryParamsInput`. The six-site drift this ticket exists
to fix was itself caused by the shape being spelled out inline at each site; repeating that with
a union would just reproduce the defect in a wider costume. A single alias also makes the
completeness grep (D6) meaningful — after the change, `Record<string, string>` must not appear
adjacent to any `queryParams` anywhere in `helio-mcp/src`.

*Alternative considered:* `Array<[string, string]>` tuple pairs. Rejected — the wire encoding the
backend reads is `{name, value}` objects, and a tuple form would need a translation layer whose
only job is to reintroduce a place for the two sides to drift.

**D2. The zod schema is a union with the array branch FIRST.**

```ts
const queryParamPairSchema = z.object({ name: z.string(), value: z.string() }).strict();
queryParams: z.union([z.array(queryParamPairSchema), z.record(z.string(), z.string())]).optional(),
```

Branch order is load-bearing: zod's `union` tries branches in order and returns the first success.
`z.record(z.string(), z.string())` does NOT match an array of objects (values would have to be
strings), so the two branches are in fact disjoint and order is not strictly required for
correctness — but stating the array first keeps the error message an agent sees on a malformed
array pointing at the array branch, which is the shape the description now steers it toward.
`.strict()` on the pair object means `{name, value, extra}` is rejected loudly rather than
silently narrowed — consistent with the surrounding schema's existing loud-rejection posture and
with the spec's malformed-entry scenario.

**D3. Pass through exactly what was authored — never normalize between encodings.**
The MCP server MUST NOT convert object → array, and MUST NOT convert array → object.

- array → object is the defect itself.
- object → array is subtler and also wrong. There is no authored order in a JSON object that
  reached the MCP server as a parsed JS object; converting it to an array would stamp JS's own
  key-enumeration order onto the wire and thereby *assert* an order the caller never expressed,
  converting an honest "unordered, key-sorted by the backend" into a fabricated guarantee. It
  would also change behavior for existing callers, which acceptance criterion 3 forbids.

So the handler chain stays a pure forward. This is what makes criterion 3 hold by construction
rather than by a test that happens to pass.

**D4. Proof: a real local `node:http` server, asserting the request body it received.**
The acceptance criterion is "what the outgoing request CONTAINED, not that a call returned 200."
For `helio-mcp` the outgoing request under test is `POST /api/sources` to the Helio backend, so
the test starts a real `node:http` server on an ephemeral port, points a real `HelioApi`/
`HttpClient` at it (no mock, no stubbed fetch), calls the tool handler, and asserts on the JSON
body the server actually received — specifically `body.config.queryParams`, as an ordered array,
compared with `toEqual` against the full expected sequence.

Chain honesty: this proves hop 1 (MCP → Helio API). Hop 2 (Helio API → target REST host, i.e. the
literal `?tag=a&tag=b` query string) is already proven on `main` by HEL-844's
`RestApiConnectorDriverQueryParamsSpec` and `SourceServiceBareUrlQueryParamsSpec` against a real
server. The tests here therefore assert the *seam*: that what MCP puts on the wire is exactly the
encoding those specs prove the backend carries through. The design deliberately does NOT restate
hop 2 in TypeScript, which could only be a weaker re-assertion of an already-stronger existing proof.

Per D-above, red-before evidence differs by path and must be labelled as such:
- `create_rest_data_source`: a genuine red — the call fails zod validation before the fix. This is
  the vacuity-defeating test acceptance criterion 4 asks for.
- inline root / `add_root`: NOT red before the fix (it passes by accident). Its test is a
  **guard**, not a proof, and MUST be labelled as one in a comment — it pins behavior the type
  system currently contradicts, and is failable by mutating the handler to collapse the value.

**D5. Fixtures: 6+ pairs, deliberately non-alphabetical, with a non-adjacent duplicate.**
HEL-844 shipped two vacuous tests, and both traps have live JS analogues:
- A 2-element fixture is too small to distinguish "preserved" from "coincidentally identical."
- An alphabetically-ordered fixture cannot distinguish document order from sorted order.
- JS-specific trap: integer-like object keys are enumerated in ascending numeric order regardless
  of insertion order, so a fixture with numeric-string names would reorder under any accidental
  object round-trip and mask which order is being observed. Fixture names MUST be non-numeric.

The canonical fixture is therefore something like
`[z→1, tag→a, alpha→2, tag→b, m→3, beta→4]` — six pairs, first name last alphabetically, a
duplicate `tag` whose two occurrences are **non-adjacent** (so a group-then-emit implementation
that preserves multiplicity but destroys interleaving still fails), and no numeric-like name.
The expected value is written out in full, in authored order, so sorting or grouping both fail.

**D6. Completeness is proven by a grep that returns zero, not a tally.**
A task step runs a grep for a `Record<string, string>` (or `z.record(z.string(), z.string())`)
occurring on or adjacent to a `queryParams` declaration across `helio-mcp/src`, and requires
empty output. The command and its empty output are recorded in the task notes. Every enumeration
in this epic has been stale; a hand-kept count is exactly the evidence shape that let this
defect survive HEL-844.

**D7. Tool description is part of the fix.**
A widened type an agent does not know about is not a reachable capability. The
`create_rest_data_source` description gains one sentence stating that `queryParams` accepts either
an object (unique keys) or an ordered `[{name, value}]` array, and that the array form is required
to express a repeated key or to control order. Without this, criterion 1 is satisfiable in theory
and unreachable in practice — which is this ticket's own defect class restated.

## Risks / Trade-offs

- **Two encodings on one field, indefinitely.** Accepted deliberately: collapsing to array-only
  would break existing agent callers, which criterion 3 forbids. The union is the smaller cost.
- **The object encoding's key-sorted backend semantics remain surprising.** Not fixed here and
  not fixable here — the order information is already gone by the time any MCP code sees it
  (HEL-844 D2). Mitigated by D7 telling agents which form to use when order matters.
- **Hop-2 coverage lives in Scala, hop-1 in TypeScript.** A future backend change could in
  principle break the seam without failing either suite. Mitigated by the shared, explicitly
  documented wire encoding and by `create-pipeline-request.schema.json` already pinning it.

## Gate-Chain Implications Checklist

Not applicable — this change touches no file under `.husky/**` and no script any pre-commit hook
invokes. The diff is confined to `helio-mcp/src/**` and `openspec/**`. Answering the five
questions for completeness: it executes nothing at commit time; it inherits no environment; it
writes nothing outside its own test's ephemeral HTTP server; it behaves identically from a linked
worktree and a main checkout; and it has no first-run behavior distinct from any subsequent run.

## Migration Plan

None. No persisted data changes shape, no migration is written (hard constraint), and both wire
encodings continue to decode. Rollback is a straight revert of the `helio-mcp` diff.
