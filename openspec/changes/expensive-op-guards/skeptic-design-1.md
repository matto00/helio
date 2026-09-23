## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Single choke point claim (design.md Context, proposal.md, ticket.md).** Confirmed
  `PipelineRunService.submit` is called by all three trigger paths:
  - `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:203-225`
    (`submit`).
  - `HookTriggerService.scala:68-74` (`submitNewRun` calls `.submit(...)`).
  - `PipelineSchedulerService.scala:96-118` (`fire` calls `.submit(...)`, passing
    `TriggerSource.Scheduled`).
  The claim is accurate.

- **Migration numbering.** `ls backend/src/main/resources/db/migration/` — highest is
  `V108__add_form_panel_kind.sql`. V109 is free. Accurate.

- **RLS precedent (V88).** Read `V88__*.sql` in full: `assistant_daily_usage(user_id,
  usage_date, message_count)`, `ENABLE`/`FORCE ROW LEVEL SECURITY` + owner-predicate
  policy — exactly what design.md Decision 4 describes, and `AssistantDailyUsageRepository`'s
  actual atomic-upsert SQL (`INSERT ... ON CONFLICT DO UPDATE ... WHERE message_count <
  :limit RETURNING`) matches Decision 2's proposed SQL pattern shape-for-shape. Sound and
  accurately cited. (Minor: the precedent's own doc comment flags that `WHERE` only gates the
  `UPDATE` branch, not the first `INSERT` of a bucket, so a `limit < 1` misconfiguration would
  wrongly allow one request — `AssistantDailyUsageRepository.incrementIfUnderCap` explicitly
  short-circuits `limit < 1`; design.md Decision 2 does not mention this edge case for the new
  repository. Non-blocking given the documented default is 10, but worth a task-list note.)

- **V108's NO FORCE/FORCE pattern.** Read `V108__*.sql` in full — it brackets an **ALTER of an
  already-RLS'd table** (`panels`), not a new-table creation. Decision 4's distinction ("new
  table follows V88, not V108's DDL-only bracket... if a migration needs bracketing around an
  ALTER of an EXISTING RLS'd table, it must follow V108's pattern") is accurate and correctly
  scoped — this is not the "if a new migration is needed... follow V108's pattern" reading a
  naive implementer might take from C6 in isolation.
  `RlsPolicyGuardSpec.rlsTables` at line 78/119-120 confirms `assistant_daily_usage -> None`
  is exactly the allowlist shape task 1.3 describes.

- **cd-backend.yml env vars.** `grep RATE_LIMIT .github/workflows/cd-backend.yml` — no
  `RATE_LIMIT_*` var is set in `--update-env-vars`; confirms design.md's claim that the new
  vars need no CD change, on the same basis as the existing limiter's vars. `--max-instances=2`
  also confirmed, matching the "up to 2 instances" framing throughout.

- **`analyze` route and cost profile.** `PipelineRoutes.scala:54-58` confirms the route exists
  as named. `PipelineService.analyze` (line 918) resolves summary/pipeline and walks the DAG
  without a row-level source read in its opening frame, consistent with the HEL-1092 "cheap"
  characterization this ticket treats as settled (per the skeptic brief, not relitigated here).

### The status lifecycle claim in Decision 3 is materially wrong for dry runs

Design.md Decision 3, point 2, states: "every row `insertRunInternal` writes starts at status
`'queued'` and only leaves the non-terminal set via `updateRunTerminal`, so this count is
exactly 'this owner's currently in-flight runs.'" This is true **only for non-dry runs**.

Read `PipelineRunRepository.scala:139-159` (`insertDryRun`/`insertDryRunInternal`) and
`PipelineRunService.scala:1068-1094` (`onDryRunSuccess`):

- `insertDryRunInternal` writes a row with `status = "dry_run"` **directly** — already inside
  design.md's own `NOT IN ('succeeded','failed','dry_run')` terminal set — in a single INSERT
  that also sets `completedAt = Some(startAt)` (line 152). There is no intermediate
  non-terminal row for a dry run at all.
- Critically, `onDryRunSuccess` (which calls `insertDryRun`) is invoked from the
  `case Success(...)` branch of `executeRun`'s result handling (line 1033: `if (isDry)
  onDryRunSuccess(...)`) — i.e. **after** the dry run has already executed against Spark/the
  in-process engine. The code's own doc comment at line 1079-1082 makes this explicit: "a dry
  run inserts an already-terminal row in one statement... This dry run's row is inserted above
  (unlike the real-run path, where insertRun already ran during preExec)."

So a dry run's `pipeline_runs` row is created *after* the expensive compute already happened,
and is *already terminal* the instant it exists. It never occupies a non-terminal slot, no
matter how long or how compute-heavy the dry run is.

This directly contradicts design.md Decision 3's explicit claim: "Dry runs (`isDry = true`) are
NOT special-cased out of either guard: they execute the same `executeRun`/Spark path as a real
run and are just as compute-expensive, so they consume the same budget." For the **concurrency
cap** specifically, this is false as designed — the live-count-against-`pipeline_runs` mechanism
structurally cannot see an in-progress dry run, so a user can run unlimited concurrent dry runs
regardless of `PIPELINE_RUN_MAX_CONCURRENT`. (The separate rate-limit table from Decision 2 is
unaffected by this gap — it doesn't read `pipeline_runs` and is checked pre-execution
regardless of `isDry`.)

This needs to be resolved before implementation: either (a) restructure `insertDryRun`'s call
site to insert a non-terminal placeholder row before the dry run's Spark/engine work begins,
upgraded to `dry_run` on completion (mirroring the real-run `preExec` pattern) — a real,
unscoped code change the design doesn't currently ask for — or (b) explicitly narrow the
design's claim and document that the concurrency cap does not cover in-flight dry runs (a
material scope reduction from what's written and arguably from the ticket's "just as
compute-expensive" framing).

### The concurrency-cap's atomicity claim is not achievable as currently specified — a real TOCTOU gap against C2

Decision 3 states the guard's three steps (advisory lock, count, insert) all happen "inside the
SAME transaction." Task 4.1 places the guard check "before `resolveAllRootDataSourcesInternal`/
`executeRun`" — i.e. at the very top of `submit`/`runPipeline`'s pre-execution path. But the
actual `insertRunInternal` call (the "insert" step Decision 3 says shares that transaction) sits
deep inside `executeRun`, reached only **after**:

1. `resolveAllRootDataSourcesInternal` completes (its own independent async DB call,
   `PipelineRunService.scala:303`), and
2. `pipelineStepRepo.listByPipelineInternal(pipelineId)` completes (a second independent async
   DB call, `PipelineRunService.scala:321-322`), and
3. the write-back-support precondition check (lines 324-332) passes,

at which point `executeRun` is finally invoked (line 333) and `insertRun` runs inside its
`preExec` (lines 944-950).

I read `DbContext.scala:34-65`: `withUserContext`/`withSystemContext` each open and commit/roll
back their **own independent transaction** per call (`db.run((setUserVar(userId) andThen
action).transactionally)`). There is no mechanism in this codebase for two separate repository
calls, made from two different methods with two intervening async DB round-trips in between, to
share one Postgres transaction — that would require composing the guard's DBIO and
`insertRunInternal`'s DBIO into a single `DBIO` chain passed to **one** `withUserContext`/
`withSystemContext` call. Neither design.md nor tasks.md describes this composition or the
restructuring of `executeRun`/`runPipeline` it would require (moving the row insert to
immediately follow the guard check, ahead of source/step resolution — a real reordering of
today's insert timing, not a no-op).

As written, the design's guard-check location (task 4.1) and its atomicity claim (Decision 3)
describe two different points in the control flow. Task 3.2 ("verify... and wire the guard
check to run strictly before any Spark work begins... don't assume") explicitly defers
resolving this to the executor during implementation rather than settling it in the design. But
this is exactly the mechanism C2 ("an atomic upsert or row lock, never read-then-write") depends
on for the concurrency cap specifically (the rate-limit table's single-statement `ON CONFLICT`
upsert in Decision 2 has no such problem — it's genuinely atomic in one call). Left unresolved,
the two most likely implementations both fail: (a) check-then-insert-later, as the call sites
currently sit, re-introduces the exact read-then-write race C2 forbids the moment the advisory
lock's transaction commits before the real insert happens; or (b) holding a `pg_advisory_xact_lock`
open across `resolveAllRootDataSourcesInternal` + `listByPipelineInternal`'s own separate
transactions is not achievable with the existing `DbContext` API without a broader refactor this
design never proposes.

This is the central novel mechanism of the change — the piece the owner explicitly mandated be
DB-backed and globally consistent (C1) and atomic (C2) — so an unresolved gap here is
blocking, not a nitpick.

### Everything else checked out

- Decision 2's rate-limit SQL pattern is sound and precedent-accurate (see above).
- Decision 5/C5 (analyze exclusion) is stated explicitly in proposal.md, design.md, and
  tasks.md (5.2), satisfying the owner ruling's requirement that it not be silently missed.
- Decision 6 (source-fetch/preview reuse of the unmodified `RateLimitDirective`) is a correct,
  minimal read of the existing directive's per-call override — `SourcePreviewRoutes.scala`/
  `DataSourcePreviewRoutes.scala` exist as named.
- Decision 7 (LLM guard hook as documentation-only) correctly reflects that no server-side-Claude
  HTTP route exists yet (CLAUDE.md's own `ANTHROPIC_API_KEY` row says so), so there's nothing
  live to wire a runtime guard onto.
- V109 migration numbering, RLS bracket precedent, and `cd-backend.yml` env var tracing are all
  independently confirmed against the live files, not just asserted.

### Verdict: REFUTE

### Change Requests

1. **Resolve the concurrency-cap atomicity mechanism concretely in design.md before
   implementation.** Either (a) specify composing the guard's advisory-lock+count+insert into a
   single `DBIO` passed to one `withUserContext`/`withSystemContext` call, and explicitly call
   out the required restructuring of `executeRun`/`runPipeline` (the row insert must move to
   happen immediately after the guard check, ahead of `resolveAllRootDataSourcesInternal`/
   `listByPipelineInternal`, for both dry and real runs) — or (b) pick a different atomicity
   mechanism (e.g., a dedicated `pipeline_run_guard_slots` accounting table gated by the same
   atomic-upsert pattern as Decision 2, decoupled from the timing of `insertRunInternal`) if
   restructuring `executeRun` is judged too invasive. Do not leave "wire the guard check... verify
   the actual code, don't assume" (task 3.2) as the mechanism for resolving what is currently an
   unresolved architectural question, given this is the piece C2 depends on.

2. **Resolve the dry-run/concurrency-cap contradiction.** Either restructure `insertDryRun`'s
   call site to record a non-terminal placeholder row before the dry run executes (upgraded to
   `dry_run` on completion, mirroring the real-run `preExec` pattern) so dry runs actually occupy
   a concurrency slot while running — or explicitly narrow Decision 3's claim to state that the
   concurrency cap does not cover in-flight dry runs, and confirm with the owner that this is
   an acceptable scope reduction from "dry runs... consume the same budget" (design.md Decision 3
   / Risks section). Whichever is chosen, update tasks.md's test plan (8.1/8.4) to explicitly
   cover (or explicitly exclude, with a comment citing this finding) dry runs in the concurrency
   integration test, so the gap doesn't silently ship untested either way.

### Non-blocking notes

- Decision 2's atomic upsert should mirror `AssistantDailyUsageRepository.incrementIfUnderCap`'s
  `limit < 1` short-circuit (its own cited precedent needs it for the same reason: `ON CONFLICT
  ... WHERE` only gates the `UPDATE` branch, not a bucket's first `INSERT`). Worth a one-line
  addition to Decision 2 / task 2.1 so a future operator setting `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW=0`
  gets "always capped" rather than "one free request per window."
