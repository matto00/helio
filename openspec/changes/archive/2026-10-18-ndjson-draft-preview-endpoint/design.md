## Context

See proposal.md (Why). Ground truth (main at 4429d46fd; confirmed again by design gate round 1):
- `InProcessExecutionBackend.execute` always loads each root's source (`:28-60`); `InProcessPipelineEngine.executeTree`
  (`:360`) takes supplied root frames. Its `loop` (`:458-475`) fails the whole walk on the first step error, and its `rows`
  are the trunk terminal of the steps it is given (`:487-494`).
- Only Join/Union/Lookup (`findByIdInternal` + `loadSource`), UpsertSource (`checkTarget`, `UpsertSourceStep.scala:47-52`) and
  the two AI steps touch `ctx.dataSourceRepo`/`loadSource`/`aiClient`; ConvertFormat and ChunkByTokenCount are pure.
- General limiter: `pathPrefix("api") > requireCsrfHeader > rateLimit() > confineScopedToken > concat(...)`
  (`ApiRoutes.scala:806-850`); `rateLimitConfig` is a private `fromEnv()` val (`:297`).
- Prod heap ~768 MB (1Gi, `MaxRAMPercentage=75`), `--concurrency=80`; `CsvUploadGate` bounds buffered-body concurrency.
- Owner rulings 2026-10-18: C1 `owner-or-editor`, C2 `never-read-sources`. Standing C3: every proof is failable.

## Goals / Non-Goals

**Goals:** stateless, streaming, side-effect-free evaluation of draft configs over client frames; a budget separate from the
page's general bucket; bounded memory; a client that paces itself. **Non-Goals:** UI wiring (HEL-1631); AI preview (ruling F);
any source read (C2); cross-instance limiting.

## Decisions

**D1 Wire contract.** `POST /api/pipelines/:id/draft-preview`, JSON body (`draft-preview-request.schema.json`):
`{roots: [{id, rows, listFrame?}], steps: [{id, kind, enabled, parentStepId: string|null, rootId?, position, config}],
lanes?: {stepId: {rows, listFrame?}}, sources?: {dataSourceId: {rows, complete}}, rowsStepId?}`. Cells use the lossless
encoding (`$int`, `$long`, `$double`). A parentless step names its input frame by `rootId` (required when parentless, must
be in `roots`), so sibling branches with different upstream frames go in **one** request (native multi-root `executeTree`,
`rootIdOfStep` from the request); a root id is a synthetic client label, never a stored root. `400` for: a `lanes` key equal to
a request step id, a `rowsStepId` not in the request, a dangling `rootId`/`parentStepId`, a duplicate id. Response `200 application/x-ndjson`, chunked, one object per line
(`draft-preview-line.schema.json`, `oneOf` on `type`):
- `step`: `{type, step, count, schema: [{name, type: int|long|double|string|boolean|null|mixed}]}` (first-seen column order);
- `unavailable`: `{type, step, reason}`, reason one of `aiStep`, `downstreamOfAiStep`, `sourceNotSupplied`, `laneNotSupplied`,
  `downstreamOfUnavailable`, `downstreamOfError`;
- `error`: `{type, step, message}`;
- exactly one final `rows`: `{type, step, available, rows, count, truncated}`; `step` is `rowsStepId` resolved over the
  **full** request (see the default below); `available: false` (with `rows: []`, `count: 0`) when that
  step is unavailable or errored; otherwise rows from `nodeOutcomes(StepKey(rowsStepId))`, never `TreeWalkResult.rows`, capped
  at 1,000 (`truncated`); response cells use the same lossless encoding. **Default `rowsStepId`**: the trunk terminal of
  `roots[0]` over the full request (follow the parentless step of `roots[0]` with the lowest position, then each node's
  lowest-position child); if `roots[0]` has no step, `step: null` and the root frame itself. A disabled `rowsStepId` is
  `available: false` when any ancestor is unavailable or errored, else carries its pass-through frame. `rootId` on a step
  with a parent is `400`;
- or a final `{type: "failed", message: "Draft preview failed"}` on an internal failure after the 200 is committed.
Order: planner `unavailable` lines first; then, in evaluation order, `step` or `error` lines, each `error` line immediately
followed by `downstreamOfError` lines for the subtree it pruned; then `rows`. **Disabled steps of any kind** (AI, a join with an
unsupplied source, anything) are transparent exactly as in the engine: never evaluated, no line, never marked unavailable, and
their frame passes through to children. Mechanism: before planning, every disabled step is **swapped for a disabled identity
step with the same id and parent** (as D2 does for `upsertsource`), so no disabled step keeps a lane reference or a config the
engine's lane check (`:403-415`) could trip on; the dependents closure walks through disabled steps (a disabled step below an
unavailable seed is dropped from the walk silently, with its enabled descendants marked), and seeds are enabled steps only.

**D2 Evaluation seam.** `DraftPreviewService` builds steps through `PipelineStepRepository.domainOf` (public, pure); an unknown
kind or undecodable config is `400` naming the step, before streaming. Each `upsertsource` step is **replaced by an identity
step with the same id** before the walk (it gets a normal `step` line; no target read, no sink). Additive, defaulted engine
parameters on `executeTree`, so no existing caller changes:
- `contextTransform: PipelineExecutionContext => PipelineExecutionContext` applied to the engine-built context (keeps the
  live `resolveLane` closure);
- `externalLanes: Map[String, Seq[Row]]` seeding both `nodeOutcomes` and `evaluatedIds` and accepted by the lane check;
- `onNodeFrame: (NodeKey, Seq[Row]) => Unit` after every node (before the node's parent frame is released, so a hook sees the true peak);
- (cycle 3, C6) `PipelineExecutionContext.maxLiveCells: Option[Long]`, set only by the draft context: it switches the walk to leaf-first order
  and fails a node whose output, with the retained frames, passes the budget as that step's `error`;
- `onNodeError: Option[(PipelineStep, Throwable) => Unit]`: when set, a failure of **that node's own `evalNode` Future only**
  is recorded, its descendants and transitive lane-dependents are pruned from `remaining` (reported back), and the walk
  continues; `None` keeps today's fail-fast behaviour. An exception thrown by `onNodeFrame` or `shouldContinue` is never routed
  through it and always fails the walk;
- `shouldContinue: () => Boolean` (default `true`) checked before each node starts; `false` fails the walk with
  `DraftPreviewCancelled`.
The context gains `resolveSecondarySource: Option[String => Future[Seq[Row]]]` (default `None` = today's `findByIdInternal` +
`loadSource` via a method fallback); Join/Union/Lookup call that method. The draft transform sets it to answer from supplied
`complete` frames, and replaces `loadSource`, `aiClient` and `dataSourceRepo` with refusing stand-ins.

**D3 Never read a source; never call AI (C2, F).** A pure planner marks unavailable before the walk the *seeds*: AI kinds,
a step whose source secondary is absent or `complete: false`, a step whose lane is neither in the request nor in `lanes`. It
then takes **one closure over both child and lane edges** from every seed (the same `dependentsClosure` function
`onNodeError` uses to prune), giving `downstreamOfAiStep` below an AI seed and `downstreamOfUnavailable` below any other seed,
so no walked step ever references a removed node (the engine's lane check, `InProcessPipelineEngine.scala:404-406`, never
fires). Only the remainder is walked. Proof is independent of the draft context (C3): the spec passes the engine a **spying**
`DataSourceRepository` and a counting AI client, persists primary and secondary sources whose rows differ from the supplied
frames (content markers), and covers a join secondary supplied `complete: true` (result from supplied rows) and
`complete: false` (`sourceNotSupplied`). Mutations that must turn it red: `resolveSecondarySource` delegating to the default;
the planner not marking `complete: false`; the planner not marking AI kinds.

**D4 Streaming and abort.** `HttpEntity.Chunked.fromData` over a `Source.queue` fed by `onNodeFrame`; downstream cancel
(`watchTermination`, precedent `PipelineRunRegistry.scala:117-119`) sets an `AtomicBoolean` that `shouldContinue` reads, so no
later node starts. The queue buffer is sized at the maximum line count (50 steps + `rows` + `failed`, i.e. 52) and any
`QueueOfferResult` other than `Enqueued` fails the walk (never a silent drop). Granularity is the node boundary. One INFO line per request:
pipeline id, step count, outcome (`completed|aborted-after-N-of-M|failed`), duration; never cell values or the body.
Deterministic proof: a test-only `afterNode` hook on the service (default no-op) holds after node 1 until the cancel flag is set
(timeout 5 s); the bound-server spec uses a draft with a trunk and an **independent sibling branch**, reads line 1, aborts, and
asserts **exactly 1** node evaluated (a step-evaluation spy) and an `aborted` outcome. The outcome is `aborted` **if and only
if the walk's Future failed with `DraftPreviewCancelled`**, never read from the cancel flag. Mutations: remove the
`shouldContinue` check -> red (node 2 is evaluated before its offer fails); route cancellation through `onNodeError` -> red
(the walk completes with pruned nodes instead of failing with `DraftPreviewCancelled`, so the outcome is not `aborted`).

**D5 Limiter, exemption, concurrency.** `draftPreviewRateLimitDirective` (own `InMemoryRateLimiter`), env
`DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW` (default 120; non-numeric or `< 1` falls back with a WARN), window
`RATE_LIMIT_WINDOW_SECONDS`, 429 message `Draft preview rate limit exceeded` (distinct from the general `Rate limit exceeded`).
`RateLimitDirective.rateLimit` gains `exempt: RequestContext => Boolean = _ => false`; the general call passes
`DraftPreviewRoutes.isDraftPreviewRequest`: method `POST` and the shared `PathMatcher` (`"pipelines" / PipelineIdSegment /
"draft-preview"` then path end) matched against the path **after** the `/api` prefix, the same value the route mounts. GET,
trailing slash or an extra segment is not exempt. The route sits inside `authenticate` (CSRF and `confineScopedToken` still
wrap it). Known property: an exempt request refused before the draft limiter (401, scoped-token 403, CSRF 403) is counted by
no limiter; its cost equals the general directive's own key lookup. Then a **two-stage in-flight gate** (cycle 2): *before* the body is read a request takes a per-principal slot (2) and a **reading**
slot (`4 x DRAFT_PREVIEW_MAX_IN_FLIGHT` bodies of at most 4 MiB); *after* the bounded read, before decoding, it takes one of the
`DRAFT_PREVIEW_MAX_IN_FLIGHT` **running** slots (per instance; default set by the D7 measurement, 2). Any refusal is an immediate `429` +
`Retry-After: 1` with message `Draft preview busy` (never a queue), so a client trickling its body holds only reading and
principal slots and cannot starve another principal. The slot is released from the response stream's termination
(`watchTermination`: completion, failure, cancel), and on every pre-stream exit (4xx, 413, strict-read timeout). `ApiRoutes` takes injectable `rateLimitConfig` and `draftPreviewConfig` (defaults `fromEnv()`).
The run guard is never called.

**D6 Access (C1).** `findByIdShared(id, Some(user))` under the caller's RLS (`404` when invisible); owner or editor role, else
`403`; after parsing and planning, immediately before the walk, `checkPreviewAccessInternal(id, user, requireEditor = true)`
(`403`/`404`). All before the `200` is committed. Revoke proof: a `PipelineRepository` subclass whose role read revokes the
editor grant right after answering (the `Hel1516GranteeDriftPreviewSpec` pattern); mutation: remove the re-check -> red.

**D7 Caps.** Body 4 MiB (`withSizeLimit` plus a `Content-Length` pre-check; `EntityStreamSizeException` mapped to `413
{"error": "Draft preview body exceeds 4194304 bytes"}`, never 500), read with a 10 s strict timeout. Rows per frame (input, each
lane, each source) <= 10,000: the 1,000-row sample cap bounds what a source contributes, but client steps upstream (unpivot,
splittext, join fan-out) can grow it. The byte cap bounds the **input** only: a join materialises `flatMap` output with no cap
(`JoinStep.scala:75-87`), so 10,000 x 10,000 rows on one key is 10^8 rows in one node. So the draft context also carries
`maxNodeRows = 20,000` (owner ruling `row-budget`, 2026-10-18; an `Option` on the execution context, `None` for runs and the
saved preview, which stay unchanged). Every kind that can emit more rows than its input checks it **before or while
materialising**, failing with a `StepConfigError` "<kind> would produce more than 20,000 rows (draft preview limit)":
`join` computes its output size from the right index up front; `unpivot` checks rows x `valueVars.length` up front;
`splittext`, `chunkbytokencount` and `extractheadings` (`ExtractHeadingsStep.scala:79-85`) count while emitting and stop as
soon as the count passes the bound (each still splits one cell fully before counting, bounded by one cell <= 4 MiB). The
post-node backstop in `executeTree` uses a **distinct** message, "node produced N rows, over the draft preview limit of 20,000",
and treats the node as failed (routed through `onNodeError`). Union is additive (it may briefly hold up to 2 x 20,000 rows
before the backstop) and lookup one-to-one. Early-stop proof is external to the step: the fixture wraps the input rows in a
counting `Seq` and asserts that not every input row was consumed, on fixtures that pass the bound well before the last input
row (e.g. 400 rows x 100 pieces, never "just over"); unpivot counts elements actually read (not `length` calls) and asserts
no input row is read by the up-front check. **Join** reads both inputs fully before merging (`groupBy`, `JoinColumnNaming.resolve`,
`JoinStep.scala:62-67`), so its proof instead makes each right-side row a counting `Map` subclass: every merged pair goes
through `JoinColumnNaming.renameRightRow` (`JoinColumnNaming.scala:52-53`, `row.flatMap`), so a correct up-front refusal
shows **zero** right-row iterations from renaming, while a check moved after the merge shows one per merged pair. Mutation
"move the check after the step's flatMap" -> red for every kind, red log kept. Every other registered kind is checked in the executor's
inventory (task 2.3: one line per kind, multiplying or not, with file:line). At most 8 roots, 8 secondary frames, 50 steps, ids <= 64
characters. Each violation is `413` naming the cap. Memory evidence, fixed shape and method: a 4 MiB body
holding one 10,000-row root (string/int columns padded to fill the byte cap less the secondaries), 8 complete 1,000-row source
secondaries, and 50 enabled frame-producing steps (a lane join at the head producing exactly 20,000 rows, then a chain of
`compute` adding one column each, so every node keeps a full 20,000-row frame in `nodeOutcomes`); in-process, `System.gc()` then `MemoryMXBean` used heap before the request and at the `afterNode`
hold on the last node, 3 runs, report the max delta (and the JVM flags). The in-flight default is
`min(8, floor(192 MB / measured peak))` (192 MB = 25 % of prod heap), recorded with the measurement; the spec follows it.
Arithmetic (owner rulings C5, C6 and C7): prod heap 768 MB (1 GiB x `MaxRAMPercentage` 75); 25 % budget = 192 MB. The per-request bound is
**enforced and measured, not proven for every request the caps allow** (cycles 2 and 3 said "structural" and were wrong twice: a comb, then
cell SIZE). What enforces it: the draft walk finishes a node's leaf children before descending (a ready node that nothing depends on goes
first, ties by `structuralRank`; runs and the saved preview keep `structuralRank`); frames are released once no unevaluated child, lane
dependent or requested rows step needs them (`retainOnly`); and a live-cell budget of 1,800,000 weighted cells fails the node that would pass
it as that step's `error`. **Weighted** (C7): every cell of every retained frame weighs 1, and a text value weighs
`CellWeight.textCells(length)` = `length x 2 bytes / 46 bytes` more, ONCE per distinct String object across all retained frames
(`LiveCellTally`; rows copied from a parent share their text with it). 46 bytes is the measured heap per boxed cell: the select-held shape
(cells only, no text) peaks at 74.5 MB against the 1,800,000 budget, 41 bytes per cell, so 46 is the conservative round figure; 2 bytes a
character is UTF-16, the worst case (the JVM stores Latin-1 text at one byte, so a Latin-1 text is priced at about twice its heap: the
fresh-string chain, priced to the budget, measures 61 MB). **While a text-creating node emits** (C7, extended by C8 to every text-copying kind: `compute`, `stringops`, `splittext`, `extractheadings`, `chunkbytokencount`, `convertformat`, and `cast` to string) it runs under a `StringBudget`:
no text value over `DraftPreviewLimits.MaxStringChars` = 262,144 characters (also checked inside the expression interpreter before a `+` or
`concat` builds its result, so a nested `concat(concat(x, x), concat(x, x))` cannot allocate it), and a running total of the new text the node
creates (2 bytes a character, every text it writes, shared or not) capped at `(budget - cells held when the node started) x 46 bytes`, so
the retained frames plus the node's new text cannot pass the budget while it is still emitting; a breach is that step's `error`
("Draft preview text limit reached ...", distinct from the memory-limit message). Measured maximum over the ten shapes (chain, comb,
lane-held, select-held, fresh-chain, doubling-5, doubling-6, fan-out-text, split-fan-out, headings-fan-out) in `heap-measurement.txt`: 74.5 MB (bound 96 MB), so
floor(192 / 74.5) = 2; reading pool = 4 x 2 = 8 bodies at
<= 4 MiB each = 32 MiB of raw bytes. Response rows capped at 1,000. Decode errors never echo the body. A cell the encoder cannot represent
losslessly (BigDecimal, Float, nested Map/Seq) makes that step an `error` ("value type not previewable"), not a `failed`.

**D8 Client.** `features/pipelines/services/draftPreviewClient.ts`:
- `readDraftPreviewStream(response, handlers)`: fetch + `getReader` + `TextDecoder`, buffered line splitting, each line
  validated by a type guard; an invalid line or non-200 fails the request.
- `createDraftPreviewScheduler({debounceMs: 350, maxWaitMs: 600, floorMs: 600})`: a send fires at the earlier of 350 ms after
  the last change or 600 ms after the first unsent change, but never sooner than 600 ms after the previous send; so a
  continuous drag sends at the floor cadence and the final state is always sent. A new send aborts the in-flight
  `AbortController`; a superseded request's lines are dropped. `credentials: "include"`, CSRF header from
  `services/csrfHeader.ts`. Every request cap (UTF-8 bytes via `TextEncoder`, rows per frame, root/secondary counts, step count,
  id length) is checked before sending and reported as `tooLarge` with the cap named, costing no request. On a `429` (limiter
  or busy gate) the scheduler holds sends until `Retry-After` elapses and reports `rateLimited`, then sends the latest state. Comment notes the h1 reconnect cost (§6.3).
- Drag proof (jest fake timers, an edit every 16 ms for 60 s): sends during the drag in [90, 100], every gap >= 600 ms, the
  final state sent after the drag; count recorded in evidence. Mutation: `maxWaitMs` removed -> red (one send). Floor proof:
  bursts of edits separated by ~360 ms quiet gaps for 60 s, where the debounce alone would fire every ~360-400 ms: every gap
  >= 600 ms and sends <= 100. Mutation: `floorMs: 0` -> red.

**D9 Contract seam.** Schemas in `schemas/pipelines/`; a Scala seam spec validates request fixtures and every emitted line
type against them (`testsupport/JsonSchemaValidation`); a frontend contract test validates the same fixtures and the type
guards (pattern: `SourceSampleSeamSpec` / `sourceSampleWire.contract.test.ts`). Mutation: rename a line field in the encoder.

## Risks / Trade-offs

- [Per-instance limiter and gate; 2 instances double the budget] -> same as every limiter here; documented.
- [A long node cannot be interrupted mid-node] -> frames are bounded; abort stops at the next node boundary.
- [HTTP/2 to browsers assumed (§6.3)] -> on h1 an abort costs a reconnect; correctness unaffected.
- [Engine signature grows] -> every new parameter defaulted to today's behaviour; existing specs unchanged.

## Planner Notes

Self-approved within rulings A/F/C1/C2: D1 line set and reasons (explicit state for (e)); D2 `onNodeError` isolation over a
`notEvaluated` contract (siblings stay previewable); D2 upsertsource identity replacement; D5 shared-matcher exemption (ticket
prefers it over hoisting) and the in-flight gate; D7 caps (4 MiB, 10,000 rows per frame, measured heap). Design gate round 1
(skeptic-design-1.md) CR1-CR5 and round 2 (skeptic-design-2.md) CR1-CR6 plus non-blocking notes addressed here and in
tasks.md group 5; multi-root `roots` replaces the single `input` (round 2 CR5); round 3 (skeptic-design-3.md) CR1-CR3: the
`maxNodeRows` guard, the dependents closure over lane edges, and the `aborted`-iff-cancelled outcome.

### Executor notes (cycle 1): deviations from the planning artifacts, each verified against the live code

- **Error body shape.** D7 says the 413 body is `{"error": "..."}`. The backend's one error type is `ErrorResponse(message)`
  (`api/protocols/ResourceProtocol.scala:9`), so every refusal here, the 413 included, is `{"message": "..."}`. The spec and the
  tests follow the code.
- **`frameGuard` on the execution context** (not in D2's list). D7 requires a cell the wire cannot carry (BigDecimal, Float, a nested
  Map/Seq) to make *that step* an `error`, but `onNodeFrame`/`shouldContinue` failures are by design never isolated. So the context
  gains `frameGuard: Option[Seq[Row] => Option[String]]`, checked by the engine's post-node step next to the `maxNodeRows` backstop and
  routed through `onNodeError` the same way. `None` for runs and the saved preview. No engine value can currently produce such a cell
  (request cells are decoded to the supported classes only), so the route-level proof is the engine seam spec plus
  `DraftPreviewCellsSpec`.
- **`InProcessPipelineEngine.laneDependencyOf` is public** (was `private[engine]`): the planner marks lane dependents with the same
  function the engine walks with, via the shared `InProcessPipelineEngine.dependentsClosure`.
- **`RateLimitDirective`** gained a constructor parameter `exceededMessage` (default `Rate limit exceeded`) for the draft limiter's
  distinct 429 text, and `rateLimit(limit, exempt)`. `ApiRoutes` gained `rateLimitConfig`, `draftPreviewConfig` (D5) and two test seams,
  `draftPreviewAfterNode` and `draftPreviewEngine` (the latter lets a spec put a counting AI client and a step-evaluation spy under
  the real route; production never passes either).
- **In-flight default is 2 (evaluation-1 CR1, owner ruling C5 `accept-2`).** Cycle 1 measured about 306 MB retained by one worst-shape
  request (the engine kept every node's frame), which forced a default of 1 and let one slow upload starve the instance. Cycle 2:
  (a) draft-mode frame release cut the chain's peak to about 82 MB, but that was NOT the worst case: the evaluator's cycle-2 comb (a
  24-step spine with a leaf per spine node, spine at the higher position) kept every spine frame under the old rank order and measured 127 MB, so
  the earlier statements that 82.3 MB was the worst case and that release cannot go lower were false (corrected here, in `DraftPreviewConfig` and
  in CLAUDE.md). Owner ruling C6 `structural-bound` replaced them with (a1) the leaf-first draft walk order and (a2) the live-cell budget
  (see D7 and the paragraph above), sized from `DraftPreviewHeapSpec`: at 2,500,000 cells a select-held shape (nineteen chained 6-column `select`
  frames, each built from scratch, held for late lane lookups) measured 107 MB, at 1,800,000 it measured 83.7 MB (cycle 3's figure, before text was priced; 74.6 MB in cycle 4), and the chain
  (20,000 rows, a column per step) then errors from about its 42nd step (a 20,000-row, 42-column frame next to its parent), a refusal with the
  memory-limit message, not a failure; (b) `DefaultMaxInFlight = max(1, min(8, floor(192 / maxPeak))) = 2`, `maxPeak` the maximum over the shapes,
  with 2 per principal (`DraftPreviewHeapSpec` asserts the maximum is <= 96 MB and the constant equals the formula; reds: budget check removed, old walk order, frame release disabled, default raised); (c) the instance slot is taken only after the bounded body read, with a separate reading pool of
  4 x maxInFlight bodies, so a trickling upload cannot hold a running slot. A third concurrent evaluation, or a request beyond the reading
  pool, gets an immediate `429 Draft preview busy` with `Retry-After: 1` (the scheduler holds and retries the latest state). Not done,
  each a design decision: a byte-weighted gate, a smaller `maxNodeRows` (C4 stays 20,000).
- **Mid-node abort is `aborted` (evaluation-1 CR2).** Once the cancel flag is set the walk stops offering lines (`onFrame`, `onError`, the
  final `rows`), so the engine's `shouldContinue` check ends it with `DraftPreviewCancelled` and the outcome logs `aborted-after-N-of-M`
  at INFO with no WARN. A disconnect that races an offer still logs `failed` (queue closed), which is rare.
- **`listFrame`** is accepted on roots and lanes (the client evaluator's flag) and ignored: the server engine has no such notion.
- **`QueueClosed` is a failure, not a cancel** (superseded in practice by the CR2 entry above for the routine case). D4: only the engine's own `shouldContinue` check produces `DraftPreviewCancelled`, and
  the logged outcome is `aborted` iff that happened. A client that disconnects while a node is still running therefore logs
  `failed` (the offer after that node finds the queue closed); a disconnect between nodes logs `aborted-after-N-of-M`. Both stop the
  walk at the next node boundary.
- **Request decoding is strict**: unknown fields are `400` (the schema says `additionalProperties: false`), a frame/lane/source id over
  64 characters is `413`, and lanes are capped at 8 like roots and sources (D7 was silent on lanes). Errors name a position
  (`roots[0].rows[3]`), never a value.
- **Access check ordering.** The first check is `findByIdShared` (404 for an invisible pipeline), then `checkPreviewAccessInternal(...,
  requireEditor = true)` (403 for a viewer); the second runs after decoding and planning. `DraftPreviewRlsSpec` caught the first draft
  of this starting the role read concurrently with the visibility read (an eager `val`), which let a revoke land between them and
  answer 404 instead of 403.
- **`rows.count`** is the full size of the requested frame; `rows.rows` is its first 1,000.
- **Stand-in kind.** A disabled step and an enabled `upsertsource` become `DraftIdentityStep` (kind `draftidentity`, deliberately not in the
  registry, so the engine's required-config check has nothing to say about a config that is never evaluated).
- **Step-line order (C6).** Step lines follow evaluation order, which in a draft is leaf-first, so for a branching pipeline it can differ from
  the saved preview's `structuralRank` order. The order is deterministic (rank breaks ties) and documented in the spec; a line carries its step
  id, so the client does not depend on it. The measurement hook runs while a node's parent is still retained, so the figures include the
  parent-plus-child transient; they exclude a step's internal working set, which `maxNodeRows` does NOT bound (it bounds rows, not
  bytes: cycles 2-3 said otherwise and were wrong). For `compute` and `stringops` the working set is bounded by the node's text budget
  (cycle 4, below); for every other kind it is bounded only by that kind's own row guard.
- **`heap-measurement.txt` is written only on request.** `DraftPreviewHeapSpec` writes its report to the path in `HELIO_HEAP_EVIDENCE_PATH`,
  after its assertions passed; unset (CI, and any mutated run) writes nothing.

### Executor notes (cycle 4): evaluation-3 CR1, owner ruling C7 `extend-one-cycle-fix-here`

- **Text priced by length** (CR1 a). `LiveCellTally` replaces the per-frame cell sum: cells plus `CellWeight.textCells` once per distinct
  String object across the retained frames, added as a frame lands and removed as it is released (reference counts per String, so a
  column carried through fifty frames is one copy). Counting distinct objects is what keeps the existing shapes' `pad` column (10,000
  texts shared by every joined row) from being priced fifty times; the cost is that a text carried unchanged but a fresh copy per row is
  priced per copy, which is the truth. The chain now reaches 39 steps (was 42) because the 10,000 request texts are priced.
- **A node's text budget** (CR1 b). `PipelineExecutionContext.maxStringChars` (set by `DraftPreviewStandIns`) and a per-node
  `stringBudget` (built by the engine in `nodeContext`, never by a caller): `ComputeStep`/`StringOpsStep` charge every text they write; `ExpressionInterpreter`
  checks the length before `+`/`concat` build. Runs and the saved preview pass no budget (`None`, `Int.MaxValue`), so their output is unchanged
  (`StringBudgetSpec` builds a 400,000-character value with none).
- **Chosen caps, with the arithmetic.** `MaxStringChars` = 262,144 characters = 512 KiB as UTF-16: a 1,000-row sample of ordinary text
  (a cell of tens of thousands of characters at most) is more than 3x under it, and an expression can at most double an operand per
  `concat`, itself checked. The running total is not a constant: it is the budget the request has left, so a node cannot be the one that
  takes the request past 96 MB while it emits. Realistic draft: one frame of 1,000 rows x 50 columns is 50,000 cells; even
  if every cell were a distinct 100-character text (each weighs 1 + 4 = 5) a frame is 250,000 weighted cells, so the parent, the child
  and two held lane frames fit the 1,800,000 budget with room to spare; a step creating 1,000 such texts charges 200 KB of the node's
  text budget, against a headroom of tens of MB. `DraftPreviewHeapSpec` keeps the cells-only realistic draft green at a tenth of
  the budget. Text-heavy chains over 20,000-row join fan-outs refuse at the step that passes the budget, by design.
- **Red against the cycle-3 code, green after** (`red-c7-cycle3-code-heap-768m.log`, `green-c7-heap*.log`): fresh-chain 326 MB and 42 steps -> 61 MB and 6
  steps; doubling-5 383 MB, no error -> 31 MB, a clean refusal; doubling-6 and fan-out-text in a 768 MB JVM `step execution failed` (the
  engine's catch-all swallowed an `OutOfMemoryError`) -> a clean `error` line. Max over eight shapes: 384 MB -> 74.6 MB.
- **What the shapes cannot see.** The heap spec samples at node boundaries, so it cannot see a node's own transient allocation. That is
  why the fan-out-text shape (10,000 rows sharing one 100,000-character text, `concat($pad, $pad)` = 4 GB inside ONE node) asserts the
  text-limit message and runs under a 768 MB heap as well (a boundary sample would read 2.5 MB either way).
- **Residual (cycle 4), closed in cycle 5.** The node text budget covered `compute` and `stringops` only; evaluation-4 measured the
  gap: a join fan-out of one 100,000-character text (10,000 rows share ONE String, so `LiveCellTally` prices it once) followed by
  `splittext` or `extractheadings` (a 479 KB, two-step body) copied the text per row inside one node and, in a 768 MB heap, ended as
  "step execution failed" (a swallowed `OutOfMemoryError`). See "Executor notes (cycle 5)". The base engine's catch-all `Throwable`
  (`InProcessPipelineEngine.evalOneStep`) that turns an `OutOfMemoryError` into "step execution failed" is HEL-1660's scope and untouched.

### Executor notes (cycle 5): evaluation-4 CR1/CR2, owner ruling C8 `extend-one-more-cycle-narrow-fix`

- **Which text-copying kinds are now charged** (draft only: `ctx.stringBudget` is `None` for runs and the saved preview, so every
  charge is `budget.foreach`): `splittext` (each segment), `extractheadings` (each title), `chunkbytokencount` (each decoded chunk),
  `convertformat` (each converted text, and a `csv -> json` result is first checked against the per-value cap from a lower bound of its
  length, before its tree is built), `cast` (each result of a cast TO string from a non-String value; a String cast to string is the
  same object and allocates nothing, so it is not charged), alongside `compute` and `stringops` from cycle 4. A breach is that step's
  `error` with the same "Draft preview text limit reached" message. The charge sits inside the `RowBudget.flatMap` emission, so the
  node stops after at most one input row's output past its headroom (the row's own segments, bounded by that row's text).
- **Kinds that remain uncharged, and why.** `join`/`lookup`/`union`/`select`/`rename`/`filter`/`limit`/`sort`/`dedupe`/`fillnull` share
  the existing String objects (priced once by the tally); `datebucket`, `groupby`, `aggregate`, `window` create
  short derived labels or keys, not a per-row copy of a cell's text (`pivot` was in this list and was wrong: its output column names
  are `<values>_<pivot value>`, a fresh copy of the pivot value's text per group, so evaluation-5 measured it as an unbounded shape and
  cycle 7 charges it, see the cycle 7 notes); `assert` and the AI kinds (refused, never run in a draft) create
  none. This inventory is by reading each step's source (`toString`/`mkString`/`substring`/`replace` call sites), not a proof.
- **The csv -> json bound is a lower bound.** `jsonLengthLowerBound` counts braces, keys, values and quotes/colons/commas but not
  escapes, so an expansion that only escaping pushes over the cap is refused by the post-build charge instead; the overshoot is one
  value, at most a few times its input text (a 4 MiB body bounds the input). A writer-level cap was tried and removed: its only
  observable effect was memory, so no mutation could fail a test for it.
- **Red against `efc559af4`, green after** (`red-c8-cycle4-code-heap-768m.log`, `green-c8-heap-768m.log`): split-fan-out and
  headings-fan-out, 479 KB bodies, 768 MB JVM: `step execution failed` -> an `error` line with the text-limit message. Measured (MB,
  max of 3 runs, 3 GB JVM): chain 71.6, comb 53.7, lane-held 55.9, select-held 74.5, fresh-chain 61.1, doubling-5 30.7, doubling-6 30.7,
  fan-out-text 2.5, split-fan-out 2.5, headings-fan-out 2.5; max 74.5 (768 MB JVM: 74.4), floor(192 / 74.5) = 2.
- **CR2: the headroom subtraction is pinned.** `InProcessPipelineEngineDraftSeamSpec` "the node's text headroom": 100 distinct 100-character
  texts held (600 cells), `maxLiveCells` 605, a `compute concat($t)`: the node must be refused INSIDE by the text limit. Mutation
  `budget - tally.held` -> `budget - 0L` (`red-c8-headroom-ignores-held-MC.log`) lets the node finish its texts and the post-node
  memory check refuse the frame instead, so that spec goes red. A companion case with room (`maxLiveCells` 5000) asserts no error.
- **Mutations re-run** (every one red, logs `red-c8-*.log`): the six cycle-4 reds and evaluation-4's MA/MB, plus a charge-removed and
  a not-wired mutation per new kind; see the evidence README. One mutation from this cycle was a survivor and was resolved by changing
  the code, not the test: the writer-level `csv -> json` cap (above).
- **Left alone, as directed:** the run path and `evalOneStep`'s catch-all `Throwable` (HEL-1660). Evaluation-4's non-blocking notes (a
  charge on an unchanged String result in `compute`; the message wording for a run past 2^31 characters) are recorded, not changed.

### Executor notes (cycle 6): skeptic-final-1, the in-flight permit leak on a reset connection

- **Defect.** `inFlightSlot` keeps the permit when the route completes with a chunked 200; the only later release was the service stream's
  `watchTermination`, which runs only if pekko-http materializes the entity. A client that resets the connection while `service.start`
  is still working gets its response dropped unmaterialized, so the running (or reading) slot and the per-principal slot were never
  returned; two such requests took the whole instance to 429 for every principal.
- **Choice: guard the entity, not the route.** `DraftPreviewRoutes.releasedIfNeverMaterialized` wraps the service's source in
  `Source.lazySource`. Materialization (which is also what starts the walk, because the walk runs in `Source.queue`'s
  `mapMaterializedValue`) does a compare-and-set `Pending -> Materialized` and cancels a scheduled fallback; the fallback
  (`DraftPreviewConfig.materializeGraceMillis`, default 5 s) does `Pending -> Expired` and calls the idempotent `permit.release()`, and
  if the entity is materialized after that the lazy source yields `Source.empty`, so a walk can never run without a slot. A cancel
  before the first element (the lazy inner never created) is released at once by an outer `watchTermination`. The alternative (do not
  count the running slot until materialization) was rejected: it would let an unbounded number of decoded requests exist before
  anything is counted, which is the memory bound C5/C6 exist for.
- **C5 intact.** The slot is still held only from the end of the body read to the end of the stream; a request whose stream is never
  materialized holds its slots for at most the grace period (5 s), not for evaluation. Counts unchanged: 2 per instance, 2 per principal.
- **Regression.** `DraftPreviewResetLeakSpec` (bound server, production counts). The window is deterministic: the fixture's
  `accessCheckHold` latch (a `PipelineRepository` subclass delaying `checkPreviewAccessInternal`) keeps `service.start` pending while
  three complete POSTs are reset (`SO_LINGER 0`), then the latch opens. Afterwards the same principal gets 200 and another principal is
  admitted (404, it has no access; a leaked slot answers 429 before access is looked at). Red with the guard removed (main sources as of
  `dc43a2059`): `429 was not equal to 200` (`red-c9-reset-leak.log`); green with it (`green-c9-reset-leak.log`).
- **Not changed.** The `EntityStreamException` -> 413 mapping (skeptic note; no failing proof written for 400), the run path
  and the catch-all `Throwable` (HEL-1660). (The pivot finding was fixed in cycle 7.)

### Executor notes (cycle 7): skeptic-final-2 CR1 and evaluation-5's pivot finding, owner ruling C9 `extend-final-gate`

- **Merge of origin/main (9a76db1e5).** An ordinary merge commit (`b34af435e`), no rebase. One conflict, in CLAUDE.md: both sides edited
  the `GET /api/data-sources/:id/sample` bullet adjacent to this change's `POST /api/pipelines/:id/draft-preview` bullet; resolved by
  keeping main's HEL-1648 text for the sample route unchanged and this change's draft-preview bullet after it. `ApiRoutes.scala` merged
  automatically (main only widened the `SourceSampleService` constructor). Main added no migration beyond what this branch already had
  (latest is V137); nothing the draft preview relies on changed (`checkPreviewAccessInternal(requireEditor = true)` is untouched, and
  HEL-1648's `callerRole` is confined to the source-sample path). The DraftPreview specs were green on the merged tree before any fix
  (`post-merge-draftpreview.log`, 80 tests).
- **CR1: the slots follow the walk, not the stream.** Defect: a cancel releases the running and per-principal slots at stream
  termination, but the walk stops only at the next node boundary, so a superseded request's slow node kept evaluating (and holding its
  frames) while two more requests were admitted: three evaluations on an instance sized for two. Fix: `DraftPreviewService.start` takes a
  `SlotHooks(onStreamTerminated, onWalkStarted, onWalkEnded)`. `walk` calls `onWalkStarted` first (it runs in `Source.queue`'s
  `mapMaterializedValue`, i.e. only once the lazy source's CAS has won) and `onWalkEnded` after the outcome line is logged, in a
  `finally` (so a request whose walk logged its outcome is the first moment its slot can be taken). `Permit` gains `walkStarted()` and
  `releaseUnlessWalking()`: the stream-termination callbacks (the service's inner one and the route's outer `watchTermination`) call
  `releaseUnlessWalking`, which releases only when no walk ever started; the grace timer's release is unchanged (an expired entity never
  runs a walk); `release()` stays idempotent. The cancel flag is still set at stream termination.
- **Cost of the fix, stated.** A request whose client has gone now holds its slot for the rest of the node in progress (the thing the
  skeptic measured), so a drag over a draft with a slow node meets `429` from the second superseded request on, rather than overlapping.
  That is the documented contract ("a third concurrent evaluation gets an immediate 429", `DRAFT_PREVIEW_MAX_IN_FLIGHT`), and the
  client scheduler already treats a 429 as a retry.
- **Regression.** `DraftPreviewWalkSlotSpec` (bound server, production counts 2/2): request 1 is reset (`SO_LINGER 0`) while its node b
  (delayed 3 s) is mid-evaluation; a second request from the same user is admitted and holds after its first node; a third request from
  that user, and one from another user, get `429` while no outcome line has been logged; afterwards the same user gets 200. Red against
  the main sources of `e2fb7aa72` (`red-c9-walk-slot.log`: `200 was not equal to 429`), green after (`green-c9-walk-slot.log`, run with
  `DraftPreviewResetLeakSpec`, `DraftPreviewAbortSpec`, `DraftPreviewReadingPoolSpec` and `DraftPreviewAdmissionSpec`: 10 tests).
- **Pivot.** `PivotStep.apply(rows, cfg, budget)` (the two-argument overload passes `None`, as every run does) charges each output column
  name `<values>_<pivot value>` against `ctx.stringBudget` as it is built. A breach is that step's text-limit error (per-name cap
  262,144 characters, running total capped at the request's remaining headroom); runs and the saved preview are unchanged.
  `DraftPreviewHeapSpec` adds pivot-fan-out (10,000-row fan-out of one 100,000-character text, then `pivot` with `column = pad`, index
  `side`: 10,000 column names of 100,000 characters, about 1 GB uncharged). In a 768 MB JVM it is `step execution failed` (a swallowed
  OutOfMemoryError) before the fix (`red-c9-pivot-768m.log`) and the text-limit error line after (`green-c9-pivot-768m.log`); the max
  over the eleven shapes is 74.5 MB (pivot-fan-out 2.5), so `DefaultMaxInFlight` stays 2. `StringBudgetSpec` adds the per-kind pivot case.
- **Corrected inventory sentence.** The cycle-5 inventory listed `pivot` (column names) among kinds that create only short derived
  labels. That is true of the other kinds listed, not of pivot, whose column name embeds the whole pivot value; corrected above.
- **Seam note for HEL-1660 (described, not built).** `RowBudget`, `StringBudget` and the `LiveCellTally` are context-free; the only
  draft-preview wording sits in the `StringBudget.tooLong` / `exceeded` messages and the engine's memory-limit message. A `label`
  parameter on those messages would let a second consumer reuse them; nothing in this change depends on it.
- **Left alone, as directed:** the run path, the catch-all `Throwable`, anything for HEL-1660.
