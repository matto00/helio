## Context

See proposal.md (Why). Current state, verified on 77f46a5df:

- `PipelineRunExecutor.executeRunSuccess` (~:315) builds `jsRows` (every terminal row as a `JsObject`), reuses it for the
  trunk snapshot write (`PipelineRunSucceededWrites.scala:109`), and returns `RunResultResponse(jsRows, ...)` (:344).
- `PipelineRunSubmitRoutes` completes with `StatusCodes.OK -> result` through `ServiceResponse.run`; Pekko
  `SprayJsonSupport` (mixed in via `ResourceProtocol`) renders the whole value with the compact printer into one
  `String`, then one strict `ByteString`. Both hold every row's text at once (UTF-16 for non-Latin-1 text, then UTF-8).
- The same `RunResultResponse` is embedded whole in `PipelineProposalApplyResponse.run` (201 from
  `POST /api/pipelines/apply-proposal`) and nested again in `CombinedProposalApplyResponse.pipeline` (201 from
  `POST /api/proposals/apply`). First-run, hooks, draft save, scheduler and auto-run drop the rows; previews cap at 10.
- `RunPathHeapSpec` samples until `submit` returns, so nothing measures the render.
- Consumers (survey, spot-checked): the frontend reads only `rows.length` (`SpineRunStatus.tsx:29-35`, fallback when
  SSE is late); helio-mcp `run_pipeline` reads `rowCount` and drops `rows`; helio-mcp `apply_*_proposal` tools pass
  the body to the agent verbatim; helio-news ignores the result. No JSON schema describes this response.
- Precedent for chunked JSON-ish bodies: `DraftPreviewRoutes.scala:127` (`HttpEntity.Chunked.fromData`).

## Goals / Non-Goals

Goals: the render stays inside the 192 MB share on both reproducers (real and dry), proven red-first; the wire body is
unchanged. Non-goals: see proposal.md. No `RunLimits` change, no new limit.

## Decisions

**D1. Stream the existing body; do not cap rows.** A row cap changes what clients receive (MCP apply tools, the
spec's "all rows") and needs an owner ruling (driver constraint; HEL-1660 rulings do not cover it). Streaming keeps
every field and byte, so consumers are unchanged by construction. Alternative "price the render against the run
budget and fail the run" was rejected: it would fail runs that succeed today for a cost that streaming removes.
The cap stays a follow-up candidate (it would also cut bytes on the wire).

**D2. A streaming compact printer, byte-identical to spray's `CompactPrinter`.** Walk the response `JsValue`:
objects and arrays emit their punctuation and recurse; every key and every scalar is rendered with spray's own
`CompactPrinter` (so escaping, numbers and surrogate handling are spray's, not a re-implementation). Output is
buffered into pieces of about 64 KiB, flushed only at value boundaries; one value larger than that (a long string,
or a row made of one) becomes its own piece. The largest piece is therefore bounded by the widest single value, which
for run rows is already capped by `RunLimits.MaxRowRenderChars` / `MaxStringChars`. Pieces are produced lazily by an
iterator pulled by `Source.fromIterator`, so at most one piece is alive beyond the response tree.

**D3. Wiring: an explicit marshaller at three routes.** A `ToEntityMarshaller` built on D2 producing
`HttpEntity.Chunked(ContentTypes.application/json, ...)`, passed explicitly (not an ambient implicit that could lose
to `SprayJsonSupport`) at the success path of `PipelineRunSubmitRoutes`, `PipelineProposalRoutes` (apply) and
`CombinedProposalRoutes` (apply). Status codes (200 / 201), headers other than length/transfer-encoding, and every
error path stay as they are. Errors are decided before the entity starts, so no error can occur mid-stream other
than a dropped connection.

**D4. Measurement (Iron Law: red first).** Extend `RunPathHeapSpec` (opt-in, forked `-Xmx768m`, SerialGC,
`taskset -c 0`, as HEL-1679 certified; one probe at a time, >= 2 repeats) so each measured run continues past
`submit`: marshal the response with the marshaller the route uses and drain the entity's bytes while the background
sampler runs, sampling once more after each pulled piece. Red: on unchanged code (default spray marshalling, still the
route's behavior), `fewrows-utf16-200` and `rowwidth-at-limit`, real and dry, must exceed 192 MB on at least one shape.
**If neither exceeds 192 MB red-first, stop and escalate (premise drift); do not build the fix.** Green: every shape
the spec measures stays at or under 192 MB with the streaming marshaller, and the existing HEL-1660/1679 shapes and
assertions stay green. The spec's shape-level assertion (max over all shapes <= 192 MB) now includes the render.

**D5. Guards, each mutation-checked (a mutation must turn it red; record the red output):**
- G1 printer equivalence: streamed bytes == `CompactPrinter` bytes, over the `JsonTextLengthSpec` adversarial values
  plus nested objects/arrays, empty containers, a value larger than one piece. Mutation: drop the comma between
  array elements, or render one escape differently.
- G2 route: `POST /api/pipelines/:id/run` (real and dry) and both apply endpoints return a `HttpEntity.Chunked` body
  whose concatenated bytes equal the compact rendering of the expected response and parse back to the same
  `RunResultResponse`, with no piece larger than the bound in D2 on a many-row fixture. Mutation: wire a route back to
  `StatusCodes.OK -> result` (default marshaller).
- G3 heap: D4's spec, using the SAME marshaller definition the routes use (one shared value), so a revert of that
  definition turns it red on the reproducers. Per-piece sampling may be thinned (every Nth piece plus the background
  sampler) if disclosed in the evidence.

## Risks / Trade-offs

- [Some client needs `Content-Length`] → axios (frontend), the helio-mcp HTTP client and Python `httpx` handle
  chunked bodies; the e2e suite and MCP handler tests run against the real route before Delivery.
- [The response tree (`jsRows`) stays alive until the last piece] → unchanged from today; for real runs it is inside
  the post-walk price, which dry runs do not check (`PipelineRunExecutor.scala:259`); D4 measures both end to end.
- [A slow client keeps `jsRows` alive longer] → same as today (the strict body was held until sent); not widened.

## Migration Plan

None. Rollback is a revert; no data or schema change.

## Planner Notes

- Self-approved: streaming over capping (D1) because it is contract-preserving; the cap is deferred to the owner.
- Self-approved: covering the two apply endpoints, since they embed the same unbounded `run` value.
- The live spec text (`pipeline-run-execution` "all of that root's source rows") stays true; no delta needed there.
