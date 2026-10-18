## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `854a52a9ef8225c1d4b34a27abe13d43fb200ca6` (base `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec`, resolved live).
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/.eval-evidence-tmp/eval1-*` (persisted).

### Phase 1: Spec Review — FAIL

Most ACs are met and proven (line order, never-read, zero AI calls, own limiter + exemption, scoped PAT / CSRF refusal,
viewer 403 / editor under NOBYPASSRLS / revoke mid-flight 403, unavailable reasons, schemas + seam on both sides, 413,
no rows in logs, client pacing measured at 98/min). C1, C2, C3, C4 hold in the diff. Two issues:

1. **Spec divergence: per-principal concurrency.** `specs/pipeline-draft-preview-api/spec.md:111` requires "2 per principal
   SHALL be in flight". The shipped default is 1: `DraftPreviewConfig.scala:31` clamps `maxInFlightPerPrincipal` to
   `min(2, maxInFlight)`, and `DraftPreviewConfig.scala:22` sets `maxInFlight = 1`. `CLAUDE.md:71` also still says "at most 2 per
   principal", which is wrong for the default.
2. **Intent mismatch: in-flight default of 1 per instance (the judgment the orchestrator asked for). This is a FAIL.** See
   Phase 2 CR1 for the measured failure.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in `WORKTREE_PATH` at the reviewed commit:
- `sbt testFull` (under flock, nice 19): 9278 run, 0 failed, 0 aborted, 4 canceled (the existing `HELIO_MEASURE`
  measurement specs). All 13 new DraftPreview/RowBudget/engine-seam specs ran. Log: `eval1-sbt-testFull.log`.
- `npm run lint`, `npm run format:check`, `npm run typecheck`: exit 0. `npm test` (2 workers): 730 suites, 9124 tests, all pass.
  `npm --prefix frontend run build`: exit 0.
- `check-schema-drift`, `check:scala-quality`, `check:openspec`, `check:spec-structure`: exit 0.

Mutation spot-checks (C3). Each was applied by a script that refuses an ambiguous match and restores the file byte for byte
(sha256 verified after each run). All four went red for the right reason:
- 5.1 never-read. Dropped the draft context's `dataSourceRepo`/`loadSource` stand-ins **and** `resolveSecondarySource`. The test
  "answer a join from the supplied secondary..." fails with `tag: PERSISTED-SECONDARY` in the rows, so the persisted secondary
  really was read. `eval1-red-5.1-standins-and-resolver-dropped.log`.
- 5.4 exemption. `isDraftPreviewRequest` with the POST check removed. The "near-miss paths" test fails: the GET is no longer
  counted (`200 OK was not equal to 429`). `eval1-red-5.4-method-check-dropped.log`.
- 5.6 RLS re-check. Replaced the second `authorize` with `Right(())`. The revoke-mid-flight test fails: it streams step + rows
  instead of 403. `eval1-red-5.6-recheck-removed.log`.
- 5.9 abort. Engine `shouldContinue` check disabled. The abort test fails with `outcome=failed`, not `aborted-after-1-of-4`.
  `eval1-red-5.9-shouldContinue-removed.log`.

Issues:

**CR1 (blocking): the in-flight gate as shipped makes the endpoint effectively single-user per instance.** `DefaultMaxInFlight = 1`
(`DraftPreviewConfig.scala:22`), and the per-principal cap is clamped to 1 as well (`:31`). The slot is taken **before** the body
is read and is held for the whole strict read of up to 10 s (`DraftPreviewRoutes.scala:61-108`, `ReadTimeout` at `:39`, `toStrict`
at `:84`).

Probe on a bound server with the production default config (`DraftPreviewConfig(120,1,1)`): user A uploads a tiny draft body
in two chunks 3 s apart, and user B (an editor) posts a normal preview 0.8 s later. B gets `429 {"message":"Draft preview busy"}`,
and A finishes 200. Log: `eval1-probe-slow-upload-starvation.log`. The probe spec was a temporary copy of
`DraftPreviewAbortSpec` and has been deleted.

So one client on a slow uplink, or one heavy request, denies every other user on that instance, and with max-instances 2 that
is the whole product. A user also collides with their own superseded request whenever its abort has not been observed yet
(per-principal is 1). The client then backs off for at least 1 s.

This conflicts with ruling A (lowest latency) and with the premise that a continuous drag at ~100/min must work for a
multi-tenant product. The executor was right that the gate cannot make one request cheaper. But the conclusion should have been
to make the request cheaper, not to ship an admission level that serialises the instance.

What the fix must achieve:
- (a) Reduce the worst-shape retained peak in draft mode: release a node's frame from `nodeOutcomes` as soon as no unevaluated
  child, no unevaluated lane dependent, and not `rowsStepId` still needs it. The executor's own candidate is about two frames
  on a chain. Runs and the saved preview must stay unchanged (gate it on the draft context, like `maxNodeRows`).
- (b) Re-measure with D7's fixed shape and method (3 runs, max delta, JVM flags) and set `DefaultMaxInFlight =
  min(8, floor(192 MB / peak))`. The result must be **at least 3**, so per-principal 2 (as the spec says) still leaves room for
  another principal. If the measured peak does not get there, that is an escalation (budget or caps), not a lower default.
- (c) Restore `maxInFlightPerPrincipal = 2` under the new default, and correct `CLAUDE.md:71` if anything changes.
- (d) Proofs:
  - A heap spec asserting the new peak bound. Mutation: frame release disabled, which must go red against the bound.
  - A bound-server spec, under the production default config, where one principal's held or slow request does not refuse a
    second principal's preview. Mutation: default back to 1, which must go red.
  - A test that a single principal's superseded request plus its next request are both admitted.

**CR2 (blocking, a deviation that is not sound as shipped): a client abort mid-node is logged as a WARN `failed`.** Probe: the
second node sleeps 400 ms, the client reads line 1 and disconnects. The log shows `outcome=failed` plus
`WARN draft-preview ... failed with java.lang.IllegalStateException`; only 2 nodes were evaluated, so the stop itself works.
Log: `eval1-probe-mid-node-abort.log`.

Nodes dominate the request's lifetime, so almost every real superseded request in a drag lands here. That makes the D4
outcome line misreport routine aborts as failures, emits a WARN about 100 times a minute per dragging user, and leaves
`aborted-after-N-of-M` essentially unreachable outside the test hook. The executor's reason (keep `aborted` iff
`DraftPreviewCancelled`) is fine, but the implementation can honour it.

Fix: in `onFrame` (`DraftPreviewService.scala:141-146`), skip the offer when `cancelled.get()` is already true, so the walk reaches
the engine's `shouldContinue` check and fails with `DraftPreviewCancelled`. Likewise skip emitting the final `rows` line when
cancelled, and log that case as aborted, not failed. Keep the WARN at `:198` for genuine failures only.

Proof: the mid-node-abort scenario above as a spec asserting `outcome=aborted-after-N-of-M` and no WARN. Mutation: remove the
cancelled check, which must go red.

Deviations in design.md's Executor notes. Each was checked against the code:
- 413 body `{"message": ...}`: sound. `ErrorResponse(message)` is the one error type, and the spec and tests follow it.
- Disconnect mid-node logs `failed`: **not sound in effect**, see CR2.
- `check-schema-drift.mjs` skips `DraftPreviewLine`: sound. It is a `oneOf` with no single case class, it follows the existing
  `DataSourceResponse` precedent, and `DraftPreviewSeamSpec` validates every line type against the schema. The request schema is
  still drift-checked.
- The client contract test excludes a `$long` beyond 2^53: sound. That is the evaluator's pre-existing documented precision gap
  (`value.ts`), and the server seam proves Long fidelity on the same fixture.
- `frameGuard` on the context, public `laneDependencyOf` with a shared `dependentsClosure`, `exceededMessage` on
  `RateLimitDirective`, strict decoding, lanes capped at 8, `listFrame` ignored, the access-check ordering, and the
  `draftidentity` stand-in: sound, minimal and defaulted for existing callers.

Code quality otherwise: imports at the top of each file (`check:scala-quality` passes), typed TS with no `any`, and errors never
echo cells (only exception class names are logged). No [mechanical] violations found.

### Phase 3: UI Review — N/A

No UI is wired by this change (HEL-1631 does that). The frontend diff is a service and its types only.

### Overall: FAIL

### Change Requests
1. **CR1.** Cut the draft-mode retained peak by releasing consumed frames, re-measure with D7's method, and set
   `DefaultMaxInFlight` to the formula result, which must be at least 3. Restore per-principal 2 (`DraftPreviewConfig.scala:22,31`).
   Add the heap-bound spec, the two-principal bound-server spec under the default config, and the self-supersede admission spec,
   each with a red mutation log. Fix `CLAUDE.md:71` to match. If the peak cannot reach that bound, escalate; do not ship a
   default of 1 or 2.
2. **CR2.** `DraftPreviewService.scala:141-146,190-199`: when the cancel flag is set, do not offer lines (the step line and the
   final rows line), so a client abort mid-node ends as `DraftPreviewCancelled` and logs `aborted-after-N-of-M` at INFO with no
   WARN. Add a bound-server spec for the mid-node abort, with a red mutation log.

### Non-blocking Suggestions
- `readDraftPreviewStream` resolves cleanly if a stream ends at a line boundary without a `rows` or `failed` line (for example a
  server crash between lines). Consider rejecting a stream that ends without a terminal line, so (e) never treats a cut-off
  stream as settled.
- The design's "byte-weighted gate" alternative would also remove most of the cost of CR1 for the common small request, but it
  is not required if (a) and (b) are met.
