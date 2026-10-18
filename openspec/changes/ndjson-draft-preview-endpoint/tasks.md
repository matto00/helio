## Standing Constraints

- [C1] Access: owner-or-editor only (viewer 403); HEL-1516 checkPreviewAccessInternal(requireEditor=true) before every evaluation (owner ruling 2026-10-18)
- [C2] never-read-sources: the endpoint never reads any data source (primary or secondary); it evaluates only client-supplied frames; a step whose secondary frame is not supplied/complete gets a per-step unavailable line with a reason (owner ruling 2026-10-18)
- [C4] row-budget: draft-only maxNodeRows=20,000; join/unpivot check up front, splittext/chunkbytokencount/extractheadings while emitting, post-node backstop; runs and saved preview unchanged (owner ruling 2026-10-18)
- [C3] Every group-5 proof must be failable: each names a mutation that reaches the code under test and is shown red (red log in evidence); a counter living inside the code under test is never proof
- [C5] in-flight: accept-2 per instance (owner ruling 2026-10-18, escalation HEL-1630-1792295999711-528bb8); the instance slot is held only during evaluation, 2 per principal; heap-bound spec asserts the measured formula yields >= 2
- [C6] structural-bound (owner ruling 2026-10-18, HEL-1630-1792302936622-e05911): draft walk finishes leaf children before going deeper; draft-only live-cell budget so one request stays <= 96 MB, a node exceeding it is that step error line; heap spec asserts the max over worst shapes (chain, comb, lane-held); keeps C5 accept-2 as a guarantee
- [C7] extend-one-cycle-fix-here (owner 2026-10-18, HEL-1630-1792308276010-f2cff5): one extra execution cycle (4); draft-only length-weighted String cells in the live budget + while-emitting byte cap on strings a draft compute/stringops creates (over-cap = step error); fresh-string and doubling shapes in the heap spec max, red before/green after
- [C8] extend-one-more-cycle-narrow-fix (owner 2026-10-18, HEL-1630-1792312960462-410af6): cycle 5 only; charge ctx.stringBudget per emitted segment/chunk in splittext/extractheadings/chunkbytokencount and per convertformat/cast-to-string result (draft only); two probe shapes in heap spec red-then-green in 768 MB JVM; failing proof for the request-remaining cap (mutation MC)
- [C9] extend-final-gate (owner 2026-10-18, HEL-1630-1792323321028-00a6f2): one narrow executor pass: release running+per-principal slots on walk Future completion (stream-termination/grace releases only for never-started walks), pivot colName keys charged to ctx.stringBudget in drafts; each failing-first; merge origin/main; then one more cold final-gate round; full e2e under lock before Delivery

### Backend

## 1. Contract

- [x] 1.1 Add `schemas/pipelines/draft-preview-request.schema.json` and `draft-preview-line.schema.json` (design D1, D7 caps); verify the schema-drift check passes
- [x] 1.2 Request/line protocol types with lossless cell decode/encode (source-sample codec; unencodable cell -> step error); verify a round-trip unit test

## 2. Engine seam

- [x] 2.1 Add defaulted `contextTransform`, `externalLanes` (seeds nodeOutcomes + evaluatedIds), `onNodeFrame`, `onNodeError` (own evalNode Future only; prune subtree + lane-dependents, continue), `shouldContinue` to `executeTree` (D2); verify existing engine specs pass unchanged
- [x] 2.2 Add `resolveSecondarySource: Option[...]` with method fallback and `maxNodeRows: Option[Int]` to the context; Join/Union/Lookup call it; executeTree post-node cap; verify existing specs pass
- [x] 2.3 Row budget (C4): up-front size check for join (from the right index) and unpivot (rows x valueVars.length); emit-time counting stop for splittext, chunkbytokencount, extractheadings; distinct backstop message, all only when `maxNodeRows` is set; inventory of all 27 kinds (multiplying or not, file:line) in evidence; verify unit specs per kind

## 3. Service and route

- [x] 3.1 `DraftPreviewPlanner`: pure unavailable-marking for every D1 reason over enabled steps only (disabled AI/join transparent), one dependents closure over child + lane edges shared with onNodeError (unit cases: a lane on a sourceNotSupplied join; AI -> disabled -> enabled; a disabled join whose lane is not supplied), disabled-identity swap, rowsStepId resolution over the full draft, request 400s (D1); verify a unit spec per reason incl. disabled cases
- [x] 3.2 `DraftPreviewService`: `domainOf` decode (400 per step), lanes-collision 400, caps (413), access (D6), upsertsource identity replacement, draft context transform with refusing stand-ins, queue streaming + cancel flag + test-only `afterNode` hook (D4), rows from `nodeOutcomes`; verify service spec
- [x] 3.3 `DraftPreviewRoutes`: shared `PathMatcher`, `withSizeLimit` + 413 mapping, own limiter, in-flight gate (8/instance, 2/principal), chunked `application/x-ndjson`; verify route spec
- [x] 3.4 `RateLimitDirective.rateLimit(exempt: RequestContext => Boolean)`; general wrap passes `isDraftPreviewRequest` (matcher on the post-`/api` path); `DraftPreviewConfig.fromEnv`; injectable `rateLimitConfig`/`draftPreviewConfig` on `ApiRoutes`; mount inside `authenticate`; verify compile + route specs
- [x] 3.5 One INFO outcome line per request (no cells, no body); document `DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW`, `DRAFT_PREVIEW_MAX_IN_FLIGHT` and the endpoint in `CLAUDE.md`

### Frontend

## 4. Client

- [x] 4.1 `features/pipelines/services/draftPreviewClient.ts` stream reader with type guards (D8); verify unit tests incl. a chunk-split line and an invalid line
- [x] 4.2 `createDraftPreviewScheduler` (350 debounce, 600 maxWait, 600 floor, final-state send, single-flight abort, CSRF, credentials, all cap pre-checks -> `tooLarge`); verify unit tests

### Tests

## 5. Proofs (C3: each red under its named mutation; red and green logs in .concertino/runs/HEL-1630/evidence/)

- [x] 5.1 Line order + never-read: spying DataSourceRepository and content-marked persisted primary/secondary; join secondary complete:true and complete:false; mutations: resolveSecondarySource -> default, planner ignores complete:false
- [x] 5.2 Zero AI calls via counting AI client passed to the engine; trunk terminal below an AI step -> rows available:false; mutation: planner does not mark AI kinds
- [x] 5.3 Error isolation: failing step in one branch, sibling branch still evaluated, downstreamOfError lines; mutation: onNodeError unset -> red
- [x] 5.4 Limiter: 121st -> 429 with the draft message; general bucket untouched (injected low general limit) and near-miss paths counted; mutation: remove exemption / widen matcher -> red
- [x] 5.5 Auth: scoped hook PAT refused, POST without CSRF refused, unauthenticated 401; mutation: mount outside confineScopedToken/requireCsrfHeader -> red
- [x] 5.6 RLS on `TwoUserRlsApiFixture`: owner/editor 200, viewer 403, stranger 404, grant revoked inside overridden role read -> 403; mutation: remove the re-check -> red
- [x] 5.7 Side effects: upsertsource draft (ExistingSource and NewSource targets) leaves pipeline_runs, rate window, last_run, snapshots, data_sources unchanged; mutation: drop the identity swap and apply the sink's pending writes (NewSource) -> red
- [x] 5.8 Caps + logs: 5 MiB -> 413 JSON, 10,001-row frame, 9 secondaries, 51 steps -> 413, rows truncated at 1,000, in-flight gate 429, 150 x 150 one-key join (22,500 rows) -> error line with the pre-check message (mutation: remove the join pre-check -> post-node message -> red), just-over-the-limit cases for join, unpivot, splittext, chunkbytokencount, extractheadings asserting the exact guard message and an external proof of the early stop (counting input Seq on 400x100-style fixtures; unpivot element reads; join via counting right-row Maps through renameRightRow) (mutations: remove the check -> backstop message -> red; move it after the flatMap -> red), a node over maxNodeRows via the backstop -> error; sentinel cell absent from captured logs; mutation: log the body -> red
- [x] 5.9 Abort on a bound server with the afterNode hold, draft with an independent sibling branch: read line 1, abort, exactly 1 node evaluated (spy), outcome `aborted` iff DraftPreviewCancelled; mutations: remove shouldContinue check; route cancel through onNodeError -> red
- [x] 5.10 Heap: D7's fixed shape and method, 3 runs, max delta recorded with JVM flags; set the in-flight default to min(8, floor(192 MB / peak)) and the spec to match
- [x] 5.11 Seam: Scala spec validates fixtures + every line type against schemas; frontend contract test on the same fixtures and guards; mutation: rename a line field -> red
- [x] 5.12 Drag (edit every 16 ms, 60 s): sends in [90,100], gaps >= 600 ms, final state sent (mutation: maxWait removed); bursts (40 ms of edits every 16 ms, then 360 ms quiet, for 60 s): gaps >= 600 ms (mutation: floorMs 0); 429 Retry-After honoured; record counts
- [x] 5.13 Full gates: `sbt testFull` (flock), frontend lint/format/typecheck/test/build

## 6. Cycle 2 (evaluation-1; owner ruling C5)

- [x] 6.1 Draft-mode frame release (`retainOnly`); re-measure D7's shape (the chain, about 82 MB; NOT the worst shape, see 7.1); `DefaultMaxInFlight` = 2 (accept-2), 2 per principal; heap spec asserts the formula (red: default raised, release disabled)
- [x] 6.2 Two-stage gate: reading pool + instance slot after the bounded read; specs: second principal admitted, superseded + next admitted, third evaluation 429, reading-pool 429, trickling body does not starve (red: gate removed, pool bound removed, slot before read, default raised)
- [x] 6.3 Mid-node abort logs `aborted` at INFO with no WARN (red: cancelled check removed)

## 7. Cycle 3 (evaluation-2; owner ruling C6 `structural-bound`)

- [x] 7.1 Draft walk finishes leaf children first; draft-only live-cell budget (`PipelineExecutionContext.maxLiveCells`, `DraftPreviewLimits.MaxLiveCells` = 1,800,000), a node over it is that step's `error` (distinct memory-limit message), dependents pruned
- [x] 7.2 `DraftPreviewHeapSpec` measures chain, comb, lane-held and select-held at every node boundary, asserts max <= 96 MB and `DefaultMaxInFlight` == formula == 2; budget-trip spec; realistic-draft spec (red: budget check removed, old walk order, frame release disabled)
- [x] 7.3 The heap spec writes its report only to `HELIO_HEAP_EVIDENCE_PATH`, after the assertions; `heap-measurement.txt` regenerated
- [x] 7.4 `busy(ctx)` indented; the false "82.3 MB worst case / release cannot go lower" statements corrected (design.md, `DraftPreviewConfig`, CLAUDE.md); spec requirement added

## 8. Cycle 4 (evaluation-3 CR1; owner ruling C7 `extend-one-cycle-fix-here`)

- [x] 8.1 Text priced by length: `LiveCellTally` (cells plus `CellWeight.textCells` once per distinct String across retained frames) replaces the per-frame cell sum; budget stays 1,800,000
- [x] 8.2 Draft-only text budget while a `compute`/`stringops` node emits: `DraftPreviewLimits.MaxStringChars` = 262,144 per value (also checked inside the expression interpreter before `+`/`concat` build), plus a per-node running total capped at the request's remaining headroom; a breach is that step's `error` ("Draft preview text limit ..."); runs and the saved preview pass no budget
- [x] 8.3 `DraftPreviewHeapSpec` adds fresh-chain, doubling-5, doubling-6 and fan-out-text to the max (74.6 MB <= 96, `DefaultMaxInFlight` 2) with their own assertions; `StringBudgetSpec`, `LiveCellTallySpec`, and a walk-order spec pinning "runs keep `structuralRank`"; reds: string weight removed, running byte cap removed, in-expression cap removed, node budget not wired, released frames never removed, leaf-first also for runs; red against the cycle-3 code in a 768 MB JVM
- [x] 8.4 The false "structural" and "`maxNodeRows` bounds a step's working set" statements corrected (design.md, `DraftPreviewConfig`, `DraftPreviewHeapSpec`, CLAUDE.md, spec requirement, evidence README); residual (text-copying kinds other than compute/stringops) recorded in design.md

## 9. Cycle 5 (evaluation-4 CR1/CR2; owner ruling C8 `extend-one-more-cycle-narrow-fix`)

- [x] 9.1 Charge `ctx.stringBudget` for every text `splittext` (segment), `extractheadings` (title), `chunkbytokencount` (chunk), `convertformat` (result; `csv -> json` checked against the per-value cap from a lower bound before its tree is built) and `cast` to string (new String only) emits; draft only (`None` for runs and the saved preview); a breach is that step's text-limit `error`
- [x] 9.2 `DraftPreviewHeapSpec` adds split-fan-out and headings-fan-out (10,000-row fan-out of one 100,000-character text, then `splittext` / `extractheadings`) to the max (74.5 MB <= 96, `DefaultMaxInFlight` 2), each asserting the text-limit message and never "step execution failed"; red against `efc559af4` in a 768 MB JVM, green after
- [x] 9.3 `StringBudgetSpec` per kind (charge and no-budget unchanged); reds: split / extractheadings / chunk / convert / cast charge removed, split / extractheadings not wired, csv -> json pre-check removed
- [x] 9.4 Pin the request-remaining cap: `InProcessPipelineEngineDraftSeamSpec` "the node's text headroom"; red for `budget - tally.held` -> `budget - 0L`
- [x] 9.5 Every cycle-4 mutation re-run and red; design.md D7 and Executor notes (cycle 5), spec scenarios and the evidence README updated; CLAUDE.md, `DraftPreviewConfig`, `DraftPreviewLimits`, `StringBudget` wording follows

## 10. Cycle 6 (skeptic-final-1)

- [x] 10.1 Release the in-flight permit when the response entity is never materialized: lazy-source guard with a materialization CAS and a `materializeGraceMillis` fallback in `DraftPreviewRoutes`; outer `watchTermination` for an early cancel
- [x] 10.2 `DraftPreviewResetLeakSpec`: three POSTs reset while `service.start` is held on a latch, then the same principal gets 200 and another principal is admitted; red without the guard, green with it

## 11. Cycle 7 (skeptic-final-2 CR1, evaluation-5 pivot finding; owner ruling C9 `extend-final-gate`)

- [x] 11.1 Merge origin/main (ordinary merge commit); resolve the CLAUDE.md conflict; DraftPreview specs green on the merged tree before any fix
- [x] 11.2 Hold the running and per-principal slots until the walk's Future has completed and logged (`SlotHooks`, `Permit.walkStarted` / `releaseUnlessWalking`); stream-termination and grace releases only for a walk that never started
- [x] 11.3 `DraftPreviewWalkSlotSpec` (reset mid-node, third request 429 until the walk logs); red on `e2fb7aa72` sources, green after; ResetLeak, Abort, ReadingPool, Admission re-run green
- [x] 11.4 Draft-only charge of `pivot` output column names against `ctx.stringBudget`; `StringBudgetSpec` case; `DraftPreviewHeapSpec` pivot-fan-out shape red-then-green in a 768 MB JVM, max over shapes 74.5 MB, `DefaultMaxInFlight` 2
- [x] 11.5 design.md (cycle-5 inventory sentence corrected, cycle 7 notes), spec scenarios, CLAUDE.md and the evidence README updated
