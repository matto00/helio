## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Confirmed no implementation exists yet in this worktree (`git status --short` shows only the
  untracked `openspec/changes/pipeline-execution-rest-sql/` dir; `git diff main...HEAD --stat` is
  empty; `git merge-base HEAD main` == `HEAD` — this branch is exactly at `main`'s tip) — every
  ground-truth citation below is checked against the same code round 1/2 saw, no drift.
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas, and both prior skeptic
  reports (`skeptic-design-1.md`, `skeptic-design-2.md`) fresh, treating the prior reports strictly as
  claims to re-verify, not as fact.
- **D7 (this round's revision) — verified every ground-truth citation against the actual file
  contents, not just design.md's prose:**
  - `PipelineApplyProposalSpecBase.scala:63-69` — read in full. `RestSuccessUrl`/`RestFailureUrl` are
    exactly at lines 63-64, `stubConnector` exactly at 66-69, and it overrides `RestApiConnector`'s
    *single-arg* `fetch(config): Future[Either[String, JsValue]]` (not the `(config, maxRows)` SPI
    method) — confirmed via `RestApiConnector.scala` that the public `fetch(config, maxRows)(implicit
    ec)` (the `Connector[Config]` SPI method D1 calls) is implemented as `fetch(config).map(_.map(json
    => toRows(json).take(maxRows)))`, so overriding the single-arg `fetch` genuinely makes the
    two-arg SPI method succeed end-to-end for both `RestSuccessUrl` (returns a real row) and
    `RestFailureUrl` (returns `Left(...)`). D7 point 1's claim that this trio is copy-pasteable
    verbatim into `PipelineRunRoutesSpec.scala` and will work the same way is correct.
  - `PipelineRunRoutesSpec.scala` — read the entire 813-line file. Confirmed exactly:
    - `seedDs` at lines 94-105 (matches D7 point 3's citation exactly, including the closing brace).
    - `makeRoutes`'s parameter list at lines 180-189, its one `new PipelineRunService(...)` call
      (11 positional args, ending `..., binRefRepo, alertEvalSvc`) at lines 191-193 — matches D7
      point 2 exactly; appending `connector` as a new *trailing* default param (mirroring D3's
      already-verified convention on `PipelineRunService` itself) breaks no existing call site,
      including the ones that pass positional args after `cache` (e.g. `makeRoutes(cache,
      pipelineRunRepo)`).
    - The three flagged tests are at lines 222-229 (`rest_api` run, D7/tasks cite "222-228" — one
      line short of the closing brace, immaterial), 231-238 (`sql` run, cited "231-237", same
      off-by-one on the closing brace), and 377-387 (preview, cited exactly, including the closing
      brace). Grepped the whole file for `"rest_api"` / `"sql"` literals — these are the *only* three
      occurrences; no other pre-existing test in this file is missed.
  - `SqlConnectorSpec.scala:29-38`'s `liveConfig` — read in full; matches D7 point 3's citation
    exactly (`dialect=postgresql, host=localhost, port=embeddedPostgres.getPort, database=postgres,
    user=postgres, password=postgres`).
  - `PipelineApplyProposalRollbackSpec.scala:93-99` — read in full; the `localhost:1`
    "fails fast and deterministically" comment + config is exactly at those lines, matching D7 point 3.
  - Independently confirmed round 1/2's two flagged tests in this same file (lines 29-57 and 118-145)
    are unchanged at those exact line numbers and are now correctly named in tasks.md 4.5 with the
    target assertions (`blocked shouldBe false`, populated run) — the round 1/2 fix is still intact.
  - Traced the full type chain for D1's row-conversion fix end to end against current code:
    `Connector[Config].fetch(config, maxRows)(implicit ec): Future[Either[String, Vector[JsValue]]]`
    (`Connector.scala:102`) is implemented identically by both `RestApiConnector.scala:143-144` and
    `SqlConnector.scala:152-154`; `RestSource.config: RestApiConfig` / `SqlSource.config:
    SqlSourceConfig` (`DataSource.scala:48-69`) so `connector.fetch(r.config, maxRunRows)` type-checks;
    `PipelineRowJson.jsRowToRow`'s proposed body (`case JsObject(fields) => fields.map { case (k, fv)
    => k -> jsValueToAny(fv) }`) type-checks against the real `jsValueToAny(v: JsValue): Any`
    (`PipelineRowJson.scala:53-59`) and produces `Map[String, Any]` = `Row` correctly — the round-1
    `ClassCastException` bug is genuinely fixed, not just claimed fixed.
  - Read `SqlConnector.scala` in full: `execute`'s `Try { connect(config); ... }` (lines ~63-107)
    catches a connection failure (e.g. `localhost:1`) the same way it catches a query failure, both
    producing `Left("SQL execution failed")` inside a `Future.successful`, not a thrown/failed Future
    — so task 4.8(b)'s unreachable-host case correctly reaches the ordinary `422`/"Pipeline execution
    failed" path via the ordinary `flatMap { case Left(err) => Future.failed(...) }` conversion, not
    an unhandled exception.
  - Read `RestApiConfigPayload`/`DataSourceConfigCodec.decodeRest` in full: `RestApiConfigPayload`'s
    non-`url` fields are all `Option`, so a bare `{"url": "..."}` config (exactly what task 4.7 seeds)
    decodes to a working `RestApiConfig` with GET/NoAuth/empty-headers defaults — confirms the new
    fixture config shape actually produces a usable `RestSource` when read back through
    `DataSourceRepository`, not just through the HTTP creation path `PipelineApplyProposalSpecBase`
    already exercises.
  - Confirmed `ApiRoutes.scala:33` (`connector: RestApiConnector` field), `:181`/`:189` (already
    threaded into `sourceService`/`pipelineService`), and `:203-207` (`PipelineRunService`'s one
    production construction site, 11 positional args ending `alertEvaluationServiceOpt.orNull`) —
    task 3.1's target site is exactly where D3 says, and a trailing default addition is safe there too.
  - Confirmed `PipelineProposalService.scala:337/345/354` and `PipelineRunService.scala:710`
    (`SparkUnsupportedKinds`) still match D4/D6's citations exactly.
  - Grepped the whole backend test suite (`grep -rln "Unsupported source type\|SparkUnsupportedKinds\|
    recordUnrunnable\|blockedReason\|blocked shouldBe true" backend/src/test/scala`) for any
    rest_api/sql-execution-rejection assertion the plan might still be missing, beyond what round 1/2
    already found. Two new hits appeared (`PipelineRunServiceSpec.scala`, `WorkspaceTeardownServiceSpec.scala`)
    — read both in context: `PipelineRunServiceSpec.scala`'s `blocked` assertions are all HEL-570
    assert-fail-policy tests (unrelated to source kind) plus one direct unit test of
    `recordUnrunnable` in isolation (unaffected since D4 leaves that method unmodified);
    `WorkspaceTeardownServiceSpec.scala`'s `.blocked` field belongs to an unrelated teardown-blocking
    response type. Neither file needs a design.md/tasks.md update — confirms round 2's "no further
    omissions" finding still holds on a fresh pass.

### Verdict: CONFIRM

Round 3's D7 revision resolves both of round 2's Change Requests with concrete, ground-truth-checked
fixture plumbing — not just a restated target outcome. Every code citation in D7 (line numbers, method
signatures, JSON codec behavior, connector error-handling semantics) checks out against the actual
current code, and I traced the full mechanical chain (config JSON → domain object → connector call →
row conversion → HTTP response) for both the success and failure branches of the `rest_api` and `sql`
paths to confirm each of tasks.md 4.6-4.9's target outcomes is actually reachable, not just plausible.
No remaining placeholders, contradictions, or unaddressed pre-existing tests were found in a fresh,
independent pass. This design is sound enough to implement.

### Non-blocking notes

- Design.md/tasks.md don't explicitly pin *where* in `makeRoutes`'s parameter list the new `connector`
  param should be inserted. I checked this is not actually ambiguous in practice — the file's existing
  call sites only ever pass positional args immediately after `cache` (for `runRepo`), so appending
  `connector` at the very end (mirroring D3's explicit "trailing" convention for `PipelineRunService`
  itself) is the only placement consistent with the rest of the design and breaks nothing; worth a
  one-line callout in tasks.md 4.6 for the implementer's benefit, but not blocking.
- Tasks.md 4.7/4.8's cited line ranges for the two full-run tests (`222-228`, `231-237`) are each one
  line short of the test's actual closing brace (`229`, `238` respectively) — cosmetic, the test
  identification itself is unambiguous and the implementer will edit the whole test body regardless.
- D2's `maxRunRows = 1000`, D4's `SparkUnsupportedKinds` becoming `Set.empty` (not deleted), D5's "no
  re-validation of `SqlSource.config.query`" precedent, and D6's stale-comment cleanup all continue to
  check out exactly against current code; no new issues found on this pass.

### Environmental note (does not affect the verdict above)

This worktree's `scripts/concertino/` (gitignored, generated by `concertino sync`) is missing
`next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` — only `assert-phase.sh`,
`cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `.concertino.env`, and `README.md` are present
(confirmed via `ls -la scripts/concertino/` in the worktree; confirmed via `git log --all -- <path>`
that these three files have never been part of any commit on this branch or `main` — they are
untracked, locally-generated artifacts that the main checkout happens to have from a more recent
`concertino sync` run, but this worktree's own copy was never refreshed with them). Per
`emit-event.sh`'s own header comment in the main checkout ("escalations are raised from inside a
worktree, whose own copy of this directory never has `.concertino.env` ... [fallback resolves via] the
resolved main checkout" — an explicitly anticipated, designed-for case), I invoked the main checkout's
copies of `next-report-number.sh` and (below) `persist-evidence.sh` directly, passing this worktree's
actual paths as arguments (both scripts resolve all paths from their arguments via `git -C`, not from
their own script location — read in full before use to confirm this). This produced `number=3` (the
same number a manual disk scan for `skeptic-design-*.md` independently confirms), so no fallback
filename was guessed. `emit-event.sh` is invoked the same way below for the same reason.
