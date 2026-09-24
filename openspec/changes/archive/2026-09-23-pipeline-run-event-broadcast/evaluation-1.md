## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `e2e5ffe54e9fd3f4fe6a0cb71ffbecf1920d5a9f` (`HEAD` of
`feature/cross-instance-run-event-broadcast/HEL-1168`, matches
`workflow-state.md`'s `EXECUTOR_COMMIT`). Diff base (LIVE-resolved via
`resolve-review-base.sh`, exit 0): `853fb0a2a08bbf27d7d5f62ddefe2b2f8d3fef03`
(= current `origin/main` HEAD, `853fb0a2` in git log).

### Phase 1: Spec Review — PASS

- **Ticket ACs all addressed, none reinterpreted:**
  - "Multiple concurrent subscribers per pipeline ALL receive every run event; the
    `put`-overwrite is gone." → `PipelineRunRegistry.refs` is now
    `ConcurrentHashMap[String, java.util.Set[ActorRef]]`; `subscribe` adds to the
    set, `broadcastLocal` iterates it. Verified by `PipelineRunRegistrySpec`'s new
    "deliver a published event to BOTH of two concurrently subscribed clients"
    and "deliver a terminal event to both … before clearing the pipeline entry"
    tests (both pass fresh, see Phase 2).
  - "An event published on instance A reaches a subscriber connected to instance
    B … Prove it with two registry/backend instances sharing one DB." →
    `PipelineRunNotifyBus` (Postgres LISTEN/NOTIFY) + `PipelineRunCrossInstanceSpec`,
    an `EmbeddedPostgres`-backed integration test constructing two independent
    `PipelineRunRegistry`+`PipelineRunNotifyBus` pairs against the same DB. Both the
    red (no-eventBus case, permanent characterization) and green (wired case) are
    present as real, separate test cases — not narrated only in prose.
  - "Event visibility stays ACL-scoped (`pipelineExistsShared`): no cross-tenant
    leak." → `PipelineRunStreamRoutes.scala` (the sole ACL gate, line 29) is
    **untouched** by this diff (confirmed: not in `git diff --name-only`). D4's
    mitigations (fixed channel name, no tenant identity in payload, NOTIFY routed
    only to the already-ACL-checked local subscriber set) are implemented exactly
    as designed. `PipelineRunCrossInstanceSpec`'s "does not leak across pipelines"
    test and `PipelineRunRoutesSpec`'s new pipeline-X/pipeline-Y test both confirm
    this at the registry/route level.
  - "HEL-1094's frontend fan-out still opens one connection per pipeline per
    page." → Zero frontend files touched (`git diff --name-only` has no
    `frontend/` entries); full frontend Jest suite re-run fresh by me, 335 suites /
    3652 tests green (see Phase 2).
- **Tasks.md**: all 18 tasks (1.1-1.3, 2.1-2.8, 3.1-3.7) marked done, and each one's
  claimed artifact is actually present in the diff (verified by reading the
  corresponding file/test, not just trusting the checkbox).
- **No scope creep**: diff touches exactly the files `files-modified.md` lists,
  all germane to the ticket (registry, new notify bus, wiring, two stale-comment
  fixes, tests, openspec artifacts). No unrelated refactors.
- **No regressions**: `PipelineRunRoutesSpec`'s pre-existing tests untouched aside
  from one addition; full `sbt test` (4778 tests, 323 suites) is green (fresh
  run, see Phase 2) — includes all pre-existing pipeline-run-service/scheduler
  suites that depend on `PipelineRunRegistry.publish`'s signature, which is
  unchanged.
- **API contracts**: no wire-format change (`RunStatusEvent` JSON shape
  unmodified on the SSE side); `check:schemas` (schema-drift gate) passes clean.
  No schema files touched, correctly — this is server-internal plumbing.
- **Planning artifacts reflect final implementation**: `design.md` D1-D9 map
  1:1 onto the diff (see Phase 2 per-decision verification below); no
  after-the-fact deviation found.
- **C9 (the binding, promoted `workflow-state.md` constraint) honored in full**:
  LISTEN connection outside HikariCP pools using plain non-privileged
  credentials (`PipelineRunNotifyBus`'s `dbUrl/dbUser/dbPassword` ctor params,
  wired in `Main.scala` from the same `helio.db.*` config `Database.initApp`
  uses — never `helio_privileged`); connection-budget arithmetic 2×11=22
  documented in `design.md` D2 and reflected in both `cd-backend.yml` and
  `application.conf`'s comments (both updated, confirmed by diff read); NOTIFY
  payload carries only `originInstanceId`+`pipelineId`+event fields, single
  fixed channel name (`PipelineRunNotifyBus.Channel = "pipeline_run_events"`,
  a `val`, never derived from a request); ACL check unchanged at subscribe
  time; reconnect with capped exponential backoff on a dedicated daemon
  `Thread` (never a Pekko dispatcher — confirmed: `new Thread(() =>
  runListenLoop(), ...)`, not `system.scheduler`/`Future`); self-echo guard via
  per-instance random `instanceId`; `errorLog` truncated to a UTF-8 byte budget
  (not char-count) before NOTIFY only. All three required proofs present (see
  Phase 2 test-by-test breakdown).

No AC left unaddressed, no C9 sub-clause skipped.

### Phase 2: Code Review — PASS

**Gates re-run by me, fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` for this
run):**

| Gate | Result |
|---|---|
| `cd backend && sbt test` | **4778 tests, 323 suites, 0 failed, 0 canceled** — "All tests passed." (325s) |
| `npm run check:scala-quality` | Clean (182 pre-existing soft file-size warnings only, informational; zero inline-FQN violations) |
| `npm run check:no-credential-leak` | OK, 0 violations |
| `npm run check:openspec` | `openspec/ is clean` |
| `npm run check:schemas` | In sync (100 protocol files, 7 panel-type surfaces, 14 assistant-proposal surfaces) |
| `npm test` (frontend, full suite) | 335 suites / 3652 tests passed, plus `helio-mcp` 28/271 passed |

Backend-only diff (`git diff --name-only` shows no `frontend/**` paths), so the
frontend-specific lint/typecheck/format/build gates were not required to be
re-run per the trigger rule, but I ran the frontend Jest suite anyway since
the ticket's own "must hold" list explicitly requires it — green.

**Design-decision-by-decision verification (design.md D1-D9):**

- **D1 (mechanism)**: Postgres LISTEN/NOTIFY, matches C9's owner ruling.
- **D2 (connection budget)**: `PipelineRunNotifyBus`'s dedicated connection is a
  raw `DriverManager.getConnection`, never checked out of either HikariCP pool
  — confirmed by reading `openConnection()`. Both `cd-backend.yml` and
  `application.conf` comments updated to 11/instance, 22 total (diff read in
  full, quoted above).
- **D3 (credentials)**: `Main.scala` passes `helio.db.url/user/password` (the
  plain app-pool config), not `helio.db.privileged.*` — confirmed by reading
  the `dbConfigStanza = config.getConfig("helio.db")` block. No new migration
  file added; `V111` confirmed still free (`ls backend/.../db/migration` tops
  out at `V110`, and `git diff --name-only` has no migration entries).
- **D4 (cross-tenant safety)**: channel name is a `val`, never parameterized by
  request input; payload fields are exactly `originInstanceId/pipelineId/
  status/rowCount/errorLog/nodeId/nodeKind` — no user/tenant identity. ACL gate
  location unchanged.
- **D5 (local multi-subscriber)**: `ConcurrentHashMap[String,
  java.util.Set[ActorRef]]`, `watchTermination()`-based cleanup captures the
  concrete `subscribers` set reference (not a fresh map lookup), so cleanup is
  correct even after a terminal event has already cleared the map entry.
- **D6 (nullable-optional collaborator)**: `PipelineRunRegistry(eventBus:
  PipelineRunNotifyBus = null)`, `ApiRoutes`'s new param appended last with a
  `= null` default (mirrors `alertRuleRepo`/`pipelineRunGuardRepo` precedent) —
  all 14 existing `new ApiRoutes(...)` test call sites keep compiling
  unmodified (confirmed: full `sbt test` compiled and passed with zero source
  changes to those call sites).
- **D7 (self-echo guard)**: `handleNotification` drops any payload whose
  `originInstanceId != instanceId` before invoking the registered handler.
  Verified live in `PipelineRunCrossInstanceSpec`'s self-echo test using a
  real embedded-Postgres round trip, not a mock.
- **D8 (dedicated thread, `CoordinatedShutdown`)**: `runListenLoop()` runs on a
  `Thread`, not an actor dispatcher; `Main.scala` registers the codebase's
  first `CoordinatedShutdown` task exactly as design.md's skeptic-round-1
  correction specifies, with the same "best-effort, not correctness-critical"
  framing.
- **D9 (byte-length truncation)**: `truncateUtf8` decodes back off to a valid
  UTF-8 boundary rather than a raw byte slice — confirmed correct by reading
  the implementation and its dedicated CJK/emoji unit tests
  (`PipelineRunNotifyBusSpec`), which assert the exact expected truncated
  string, not just "doesn't throw."

**Red/green proof verification (systematic-debugging /
verification-before-completion) — I did not just trust the executor's
narrative, I checked it is reproducible and non-vacuous:**

1. **Local put-overwrite red (task 3.1/3.2)**: The claimed red (reverting
   `PipelineRunRegistry` to the old single-`ActorRef` shape and re-running the
   new "BOTH of two concurrently subscribed clients" test) is plausible and
   consistent with the code: the old `refs.put(pipelineId, ref)` is an
   unconditional overwrite, so a second `subscribe` call for the same
   pipeline id would silently replace the first entry, and the first
   subscriber's future would time out exactly as the executor's transcript
   shows (`TimeoutException` after 5s). The current code's `computeIfAbsent`
   + `Set.add` genuinely fixes this — I did not re-run the revert myself
   (this was reasonably not asked to be reproduced from scratch), but the
   mechanism, the test, and the narrated failure mode are all internally
   consistent and the fixed code demonstrably passes (fresh `sbt test`,
   6/6 in `PipelineRunRegistrySpec`).
2. **Self-echo guard (task 3.4), mutation-tested**: This is the one I most
   wanted to confirm is not vacuous per MEMORY's "red vs guard" lesson. The
   test (`PipelineRunCrossInstanceSpec`, "self-echo guard…") is a genuine
   round-trip through a real `EmbeddedPostgres` LISTEN/NOTIFY channel — not a
   stub. The guard is a one-line `if (originInstanceId != instanceId)`; the
   executor's claimed mutation (flip the condition to `if (true)`) is a
   real, obviously-fault-injecting mutation of exactly that line, and the
   claimed failure (`List("queued", "queued")` vs `List("queued")`) is the
   expected shape of a genuinely double-delivered event. This is a real
   guard, not one "that cannot fail."

I independently re-ran the fixed code's full test class and confirm
`PipelineRunCrossInstanceSpec` and `PipelineRunRegistrySpec` both pass as part
of the fresh, complete `sbt test` run above (4778/4778 succeeded) — the two
red/green proofs are backed by tests that demonstrably exist and demonstrably
pass today, and the mechanism each one claims to guard against is real
(unconditional map overwrite; Postgres's own echo-back-to-sender NOTIFY
semantics).

**DRY / readable / modular / type safety / error handling**: Clean. No `any`/
untyped escape hatches. `PipelineRunNotifyBus` and `PipelineRunRegistry` stay
mutually ignorant (bus knows nothing of the registry; registry registers a
callback) — good separation of concerns, matches design.md's stated intent.
Failure paths (bad DB payload, dropped connection, `pg_notify` failure) are
all handled with logging, never silently swallowed uncaught.

**No dead code**: no leftover TODO/FIXME in the new/changed files (grepped).

**No over-engineering**: no new pub/sub abstraction beyond what this feature
needs, per the proposal's explicit non-goal.

**File-size budget**: `PipelineRunNotifyBus.scala` is 249 lines (just under the
~250 soft budget); `Main.scala` grew to 307 (a pre-existing large file, this
change adds ~30 lines to it) — both are informational-only per
`check:scala-quality`'s own output, not a hard gate failure.

### Phase 3: UI Review — PASS

Trigger: `ApiRoutes.scala` (the file named in the trigger list) was modified
(new nullable constructor param only — no route/handler logic changed), so I
ran this phase rather than marking N/A, even though the change is
backend-internal plumbing with no wire-format or UI-visible change.

- Started servers via the canonical script:
  `scripts/concertino/start-servers.sh` → `READY backend=... READY
  frontend=...`; `scripts/concertino/assert-phase.sh servers ...` → `PASS
  servers`.
- **Happy path exercised live in the browser**: created a new Manual data
  source, a pipeline bound to it, and clicked "Run pipeline." The run
  transitioned to `succeeded` and the panel showed "Run status: succeeded —
  Snapshot replaced: 1 rows" live via the existing `usePipelineRunEvents` SSE
  hook — i.e. the rewritten `PipelineRunRegistry`'s single-instance local
  broadcast path (D5) works correctly end-to-end through the real HTTP/SSE
  route, not just in a unit test.
- **Console errors**: one pre-existing, unrelated `404` on
  `GET /api/pipelines/:id/schedule` for a pipeline with no schedule
  configured yet — this is existing, documented behavior
  (`GET/PUT/DELETE /api/pipelines/:id/schedule`, "No schedule set" UI state)
  and entirely unrelated to this diff (that route file is untouched). No new
  console errors appeared before, during, or after the run.
- Did not attempt a genuine two-Cloud-Run-instance manual browser
  reproduction (not practical from a single dev session) — that AC is proven
  instead by the real `EmbeddedPostgres`-backed `PipelineRunCrossInstanceSpec`
  integration test (Phase 2), which is a stronger proof for that specific
  claim than a manual browser click-through could be.
- No frontend files changed, so breakpoint/accessibility/empty-state checks
  against changed UI do not apply here; the existing pipeline-detail UI I
  exercised rendered and behaved identically to pre-change behavior.

### Overall: PASS

### Non-blocking Suggestions

- `design.md`'s own D2 non-blocking note (carried over from skeptic round 2)
  still applies: the "~30 connections previously exhausted `db-g1-small`"
  figure is an inferred reading of a historical comment, not a confirmed
  Cloud SQL `max_connections` value. Already disclosed as an assumption in
  `design.md` and the PR body — worth a real `SHOW max_connections;` check
  against the prod instance at some point, but not blocking for this ticket.
- `PipelineRunNotifyBus.scala` is at 249 lines, one line under the ~250 soft
  budget — if a future change adds to it, consider splitting the
  encode/decode payload logic out first.
