## Evaluation Report — Cycle 2 (evaluation-2.md)

Scope note: this is a coordinator-approved fold-in scope addition to the same change
(`nl-dashboard-proposal-authoring`), not a re-check of cycle 1 (that PASS stands, `evaluation-1.md`,
PR #327). Commit under review: `0cb43892` "HEL-392 Fold-in: end-to-end test coverage for
mapClaudeError (422/502 mapping)" — test-only, zero `backend/src/main` changes (confirmed via
`git diff 9f9bc2a8..HEAD --stat -- backend/src/main` → empty).

### Phase 1: Spec Review — PASS

Issues: none.

- New fold-in AC (`ticket.md` lines 29-37) is addressed in full: all three `mapClaudeError` branches
  (`GuardrailExceeded`/`ApiError`/`TransportFailure`) are now driven end-to-end through both `author`
  and `authorStreaming`, asserting the resulting `ServiceError`/HTTP-status-equivalent, exactly as the
  AC specifies.
- `tasks.md` section 7 (7.0–7.4) all checked and each item's claimed content matches the actual diff:
  7.0 (new `spec.md` Requirement + 2 Scenarios for the 502 mapping) — present at
  `specs/nl-dashboard-proposal-authoring/spec.md:95-110`, added in this same diff. 7.1 (buffered
  `GuardrailExceeded`) — present. 7.2 (buffered `ApiError`/`TransportFailure`) — present, two separate
  test cases. 7.3 (streaming mirror of 7.1/7.2) — present, three test cases. 7.4 (`sbt test` green) —
  independently re-verified (below).
- The two-round design-gate skeptic history (`skeptic-design-foldin-a-1.md` REFUTE →
  `skeptic-design-foldin-a-2.md` CONFIRM) is a real, substantive resolution, not a rubber stamp: round
  1 correctly caught that the `ApiError`/`TransportFailure` → 502 mapping had zero `spec.md` coverage
  (only a `design.md` D8 Decision) even though `proposal.md`/`ticket.md`'s original fold-in framing
  implied uniform "already-specified" coverage across all three branches; round 2 confirms the
  resulting `spec.md` delta, and the corrected `proposal.md`/`ticket.md` wording, are both now
  accurate per-branch (`GuardrailExceeded` = pre-existing written scenario now exercised;
  `ApiError`/`TransportFailure` = new scenario written as part of this same fold-in). I independently
  re-read `spec.md` in full and confirm the new "Upstream Claude API/transport failures SHALL surface
  as a Bad Gateway response" Requirement + its two Scenarios (buffered + streaming) are present and
  match the shipped test behavior exactly.
- `design.md` is untouched (`git diff 9f9bc2a8..HEAD -- .../design.md` produces no output) — correct,
  D8 already fully specified the mapping; no redundant Decision was needed or added.
- No scope creep: the diff touches exactly one test file plus openspec planning artifacts. No
  production code, no schema, no other test file changed.
- No regressions: full test suite re-run below is green, including every pre-existing suite.
- Planning artifacts (`ticket.md`, `proposal.md`, `tasks.md`, `spec.md`) all reflect the final
  implemented test behavior — no drift found on a fresh read against the diff.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates, freshly re-run (test-only diff, backend-only — no `frontend/**` files changed):**
- `cd backend && sbt "testOnly com.helio.services.DashboardAuthoringServiceSpec"` → 15/15 passed (9
  cycle-1 cases + 6 new fold-in cases), 0 failed.
- `cd backend && sbt test` (full suite) → **2572/2572 passed**, 0 failed, 0 canceled (up from cycle
  1's 2566 — exactly +6, matching the 6 new test cases added).
- `npm run check:schemas` → "schemas in sync... (41 checked)", clean (unchanged from cycle 1 — no
  schema touched this cycle).
- `npm run check:scala-quality` → "clean (87 soft warning(s))" — 0 mechanical violations. Note:
  `DashboardAuthoringServiceSpec.scala` is now 486 lines (up from 363 in cycle 1), which is
  informational-only per `CONTRIBUTING.md` ("File-size warnings... are informational only") — see
  non-blocking suggestion below.
- `npm run format:check` → clean.

**Specific verification points from the review brief:**

1. **`maxInputTokens=1` test genuinely exercises `ClaudeClient`'s own pre-flight `GuardrailExceeded`,
   distinct from the empty-workspace short-circuit** — confirmed correct. The new test calls
   `insertPipelineOutputType(user)` *before* constructing the service (so the workspace is non-empty
   and D6's `assembleGroundedContext` empty-workspace check — `outputTypes.isEmpty` — never fires),
   then builds the service with `newAuthoringService(transport, maxInputTokens = 1)`. Read
   `ClaudeClient.scala` directly: `guardrailReject` computes `ClaudeTokenEstimator.estimate(...)` and
   rejects whenever it exceeds `config.maxInputTokens` — with `maxInputTokens = 1` this fires for any
   real grounding prompt, before `transport.send` is ever called. The test asserts
   `transport.sendInvocations.get() shouldBe 0`, which is only satisfiable if the rejection happened
   inside `ClaudeClient.send` itself (not the D6 short-circuit, which never constructs a `ClaudeRequest`
   or calls `claudeClient.send` at all — a `GuardrailExceeded` from a truly-empty workspace couldn't
   even be produced since D6 returns before that point). This is a genuinely distinct code path from
   the cycle-1 empty-workspace test (which uses a *fresh* user with zero pipeline-output types and the
   *default* `maxInputTokens`). Ran green in my own fresh test execution.

2. **Streaming assertions compare against the buffered path's actual runtime message, not a
   hand-duplicated literal** — confirmed correct, as claimed. Both new streaming-mirror tests
   (`ApiError` and `TransportFailure`) compute `bufferedMessage` by actually invoking `author(...)`
   first and reading `.swap.toOption.get.message` from the real result, then assert
   `events.head.asInstanceOf[AuthoringStreamEvent.Error].message shouldBe bufferedMessage` — a
   dynamic comparison against a live-computed value, not a second hardcoded string literal. The only
   literals duplicated are the *inputs* fed to each path (e.g. `503`/`"upstream unavailable"` for
   `ApiError`, `"Request failed"` for `TransportFailure`) — necessary so both paths are given an
   equivalent failure to map, not the comparison itself.

3. **The commit's account of a self-caught bug (an initial `TransportFailure` streaming test
   comparing against a message that would never match) is accurate** — verified by reading
   `ClaudeClient.send`'s actual catch-all directly: `case Failure(e) => ... Success(Left(ClaudeError.
   TransportFailure("Request failed")))` — this branch discards the real thrown exception entirely and
   *always* substitutes the fixed literal `"Request failed"`, regardless of what
   `transportFailureResponse()` actually throws (`RuntimeException("connection refused")` in this
   test). A first-draft test comparing the buffered result's message against the *original exception's*
   text (e.g. `"connection refused"`) — a reasonable-looking assumption for anyone who hasn't read
   `ClaudeClient.send`'s exact catch-all — would indeed never match, since the buffered path can only
   ever produce `"Request failed"` for a non-`ClaudeApiException` failure. The final test both
   documents this exact subtlety in an inline comment and pins it with an explicit
   `bufferedMessage shouldBe "Request failed"` sanity assertion before the cross-path comparison,
   which is strong evidence the fix is understood and deliberate, not accidental. By contrast, the
   `ApiError` case has no such trap — `ClaudeClient.send`'s `ApiError` branch passes the real
   `status`/`body` through unchanged — and the test correctly uses matching, non-hardcoded-away
   literals for that case instead. This asymmetry (`ApiError` preserves input, `TransportFailure`
   discards it) is exactly the kind of implementation detail a "self-caught bug" account would
   describe, and the shipped code demonstrates correct handling of both cases distinctly.

**Other Phase 2 checks:**
- **CONTRIBUTING.md mechanical compliance**: `check:scala-quality` clean, no inline FQNs in the new
  code (`ClaudeApiException`, `ClaudeError` added to the existing top-of-file `import
  com.helio.ai.{...}` list, not inlined).
- **DRY**: reuses the existing `newAuthoringService`/`cannedResponse`/`FakeClaudeTransport` helpers
  (extended `newAuthoringService` with a defaulted `maxInputTokens` param rather than a parallel
  constructor); `apiErrorResponse`/`transportFailureResponse` are small, single-purpose additions, not
  duplicated logic.
- **No dead code**: no TODO/FIXME left in the diff.
- **No over-engineering**: six focused test cases, no new abstraction introduced beyond what the
  existing spec already used.
- **Behavior-preserving**: N/A in the traditional refactor sense — no production code changed this
  cycle, so there is nothing to regress; the full-suite pass count moving from 2566 to exactly 2572
  (a clean +6) is itself evidence nothing else shifted.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` production files changed
this cycle (only a test file plus change-dir planning artifacts). Same backend-only, no-UI-surface
ticket as cycle 1.

### Overall: PASS

### Non-blocking Suggestions

- `DashboardAuthoringServiceSpec.scala` is now 486 lines (roughly 2x the ~250-line soft budget,
  informational-only per policy). If a future cycle touches this file again, consider splitting the
  error-mapping cases (the 6 cases added this cycle) into a sibling
  `DashboardAuthoringServiceErrorMappingSpec.scala` to keep both files closer to budget — not required
  now.
- Environment note (inherited from cycle 1, still true): this worktree's `scripts/concertino/`
  directory predates several scripts present on `main` (`next-report-number.sh`,
  `persist-evidence.sh`, `emit-event.sh`) — I again ran the main checkout's copies against this
  worktree's change directory to produce/persist this report. Not a code defect; worth a
  `concertino sync`/rebase on this worktree if further cycles are expected.
- A stale top-level `openspec/specs/nl-dashboard-proposal-authoring/spec.md` (created by the
  interim/premature archive commit `ce582288`, now superseded by the un-archived, actively-edited
  change-dir copy under `openspec/changes/nl-dashboard-proposal-authoring/specs/...`) does not yet
  reflect this cycle's new "Bad Gateway" Requirement. This is expected mid-flight state for a
  fold-in-after-archive cycle, not a defect in this diff — the eventual re-archive step will
  regenerate it. Flagging only so the re-archive step isn't skipped.
