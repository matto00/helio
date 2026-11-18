## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD fd7090bf6bc10a091c99d8090a440093ced74475 (equal to origin/main; no commits on the branch yet).

### What I verified (with evidence)

- **Migration ledger.** main and origin/main both end at `V141__outputs_kind_insight.sql`. I scanned every lane
  worktree under `.claude/worktrees/*/*/*/` for V142 or higher: the only hit is HEL-1739's
  `V144__auto_run_debounce_write_generation.sql`. V142 is free. The design's D8 renumber rule is sound.
- **V115 pattern (D1).** The claim is accurate. `V115__*.sql` has a UUID pk, the `output_id` FK with
  `ON DELETE CASCADE`, TEXT `pipeline_id`/`run_id` with no FK, ENABLE + FORCE RLS, four
  `helio_can_access_pipeline(pipeline_id)` policies, and `GRANT SELECT, INSERT, UPDATE, DELETE ... TO
  helio_privileged`. D1 copies it faithfully, and the CHECK, partial index and tie-break choices are sensible.
- **ACL entry (D3/D4) vs `OutputHistoryService.read`.** `OutputHistoryService.read`
  (services/pipelines/OutputHistoryService.scala) authorizes through `outputRepo.findById(id, user)`, which is
  `withUserContext` plus the sharing-aware RLS in OutputRepository.scala:144. `OutputService.findById`
  (OutputService.scala:212) calls the same repository method and then makes one more `findConfigById` read. Both
  produce `ServiceError.NotFound("Output not found")`, so the 404 behavior would be identical. **But the dependency
  shape is not equivalent.** See Change Request 1.
- **"No model client by construction."** In production, `OutputService` is built with
  `pipelineRunService = pipelineRunService` (ApiRoutes.scala:521-525). `PipelineRunService` takes
  `aiStepClient: AiStepClient` (PipelineRunService.scala:88). ApiRoutes.scala:471-503 wires a live
  `ClaudeAiStepClient` into it whenever `ANTHROPIC_API_KEY` is set. So a read service whose constructor takes
  `OutputService` can reach a model client through one hop, and D3's guard cannot see that hop: it only rejects
  *direct* parameter types that are (or subclass) model types. The guard would pass while the AC is false in the
  transitive sense.
- **L3 citation shape (design Context).** The design describes `InsightPack.Citation` as
  `{id, outputId, field, value, capturedAt}`. The real type is
  `Citation(id, outputId, field, number: Option[Double], date: Option[Instant], capturedAt: Option[Instant],
  isPct: Boolean = false)` (domain/insights/InsightPack.scala:9-17). It has no `value` field. The public projection
  `{id, field, value, capturedAt}` in D6 and the spec therefore rests on a field that does not exist, and the
  stored `citations` JSONB element shape is never pinned anywhere. L4 will write it.
- **Public gate (D6).** `PublicPanelOutputResolver.resolvePanelOutput` is the single panel-to-Output gate and
  returns 404 on every failure. Insight panels are `OutputPanel` bindings (`OutputBindingSpec.Insight`,
  OutputBindingSpec.scala:110), so the gate does reach them. The precedent is `PublicPanelHistoryResolver`, which
  calls the ACL-free `OutputHistoryService.forOutput`. D6 does not name the ACL-free read method the new resolver
  would call, and D3 describes the read service only through its ACL'd entry. See Change Request 3.
- **Allow-list sufficiency (D6).** Dropping cost, model, tokens, run id, digest, trigger, row ids, last-attempt
  status and cited `outputId` is a sound, conservative reading of the ticket. Building the projection as an
  explicit type with `additionalProperties: false`, plus a test over a fully populated row, is the right proof
  shape.
- **Retention (D7).** `OutputHistoryRetentionService.runPass` has a history part and a payload part. Results combine
  with Failed > Busy (lockRetry) > moreWork precedence. Adding a third `PartResult` folded into the same
  `failed`/`busy` booleans is consistent. The payload part takes `pg_try_advisory_xact_lock(PurgeAdvisoryLockKey)`
  (NodePayloadHistoryRepository.scala:202), and the run-path payload trim takes the same key SHARED (:140). The
  insight purge would therefore report Busy whenever a run is trimming. That is harmless (lockRetry only) but
  unnecessary; see the notes. `maxAgeByTier` covers all three tiers (OutputHistoryRetentionConfig.scala:32). The
  "absent tier gets the strictest cap" behavior matches the history repository's documented rule
  (OutputHistoryRepository.scala:103). Keeping the newest ok row and the newest attempt is sound. The no-default
  constructor parameter matches the HEL-1276 precedent: Main.scala:289-292 is the single production construction
  site, and 15 test construction sites will need updating, which task 2.6 acknowledges.
- **RLS spec pattern (D9).** `OutputHistoryRlsSpec` exists, but it runs as **`helio_app_test`** (a NOSUPERUSER role
  the spec itself creates, OutputHistoryRlsSpec.scala:16, 46-52), not `helio_app`. `RetentionLockGuardSpec` uses
  `helio_privileged` / `helio_app_test`. No migration creates a role called `helio_app`. CONTRIBUTING.md:114-126
  describes the app pool as "`DB_USER` (non-BYPASSRLS)". D9's "runs as `helio_app` (SET ROLE, ... existing
  `*RlsSpec` pattern)" misdescribes the pattern. Its manual-check fallback ("if `helio_app` cannot be used, use a
  lane-private DB") does not address the role being absent. See Change Request 4.
- **Route surface.** `OutputRoutes` `path("history")` and `OutputHistoryQueryParsing.parse` (1..100, default 30,
  `since` ISO instant, 400 never clamped) exist as described. `path("insight")` and
  `path("insight" / "history")` do not collide with existing paths. CLAUDE.md's `ANTHROPIC_API_KEY` row does carry
  the stale "no route consumes this yet" text; task 1.10 covers it.
- **AC coverage.** Every AC maps to a task: 404 parity (2.1), public schema test (2.3), cascade (2.4), no model
  client (2.5, but see CR1), live RLS as the non-bypass role (2.7/2.8, but see CR4), and CLAUDE.md (1.10). I found
  no TODO/TBD placeholders and no scope drift.

### Verdict: REFUTE

### Change Requests

1. **Make "no model client by construction" true, then guard it with an exact allow-list (design D3/D4, spec
   "Read service has no model client", tasks 1.4/2.5).**
   - **Dependency:** `OutputInsightReadService` must not take `OutputService`. In production, `OutputService`
     holds `PipelineRunService`, which holds a live `AiStepClient` (ApiRoutes.scala:471-525,
     PipelineRunService.scala:88). Take `OutputRepository` directly and authorize with `outputRepo.findById(id,
     user)`, exactly as `OutputHistoryService.read` does. That gives the same 404 semantics and one fewer query.
   - **Guard:** replace the deny-list guard ("fails if any parameter is or subclasses InsightModelClient/...").
     The new guard asserts that the constructor's parameter types are *exactly* the allowed set, for example
     `{OutputRepository, OutputInsightRepository, ExecutionContext}`. Any added collaborator then turns it red,
     including a transitive carrier like `OutputService`. Record the red mutation as adding an `OutputService`
     parameter, not only a model-typed one.
   - **Spec:** update the scenario wording to match.
2. **Pin the stored `citations` element shape and the public mapping (design Context, D1, D5, D6, spec "Public
   insight read", task 1.9).**
   - **Correct the Context line:** the L3 `Citation` has `number`/`date`/`isPct`, not `value`
     (InsightPack.scala:9-17).
   - **Stored element shape:** specify the JSONB element L4 must write, for example
     `{id, outputId, field, number?, date?, capturedAt?, isPct}`. Also state whether the column holds every pack
     citation or only those `InsightValidator.citationsUsed` returns.
   - **Public element:** define it precisely. Either expose `number`/`date`/`isPct` or define how a single `value`
     is derived, including its JSON type. Then put it in `public-output-insight-response.schema.json` with
     `additionalProperties: false`.
   - **Why it blocks:** as written, two implementers would produce incompatible JSONB, and L4 would inherit the
     guess.
3. **Name the ACL-free read path the public resolver uses (design D3/D6, task 1.7).** Specify the method
   `PublicPanelInsightResolver` calls after `resolvePanelOutput` succeeds, for example
   `OutputInsightReadService.latestOkFor(output: Output)`, documented "no ACL: caller has authorized" like
   `OutputHistoryService.forOutput`. Say where the `insight`-kind gate lives on that path. Also specify how the
   service reaches `PublicDashboardRoutes`: as an `Option[...]` constructor parameter next to `historyServiceOpt`
   (ApiRoutes.scala:880), defaulting to a 404 when absent like the history resolver. As written, the only read
   entry D3 describes takes an `AuthenticatedUser`, which the public path does not have.
4. **Make the live-RLS plan executable (design D9, tasks 2.7/2.8).**
   - **Automated spec:** state that it follows `OutputHistoryRlsSpec` and runs as `helio_app_test` (NOSUPERUSER,
     not BYPASSRLS, created by the spec).
   - **Manual check:** name the exact role to use. Add a prerequisite step that proves the role exists and is not
     BYPASSRLS (`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '<role>'`) and record its
     output in `rls-live-check.md`. Say what to do if no such role exists on the local DB. Creating a local-only
     NOSUPERUSER NOBYPASSRLS role on a lane-private DB is the natural answer; switching databases alone does not
     supply a role.
   - **Why it blocks:** the AC literally says "run RLS as `helio_app`, the non-BYPASSRLS role". The plan has to
     show which concrete role satisfies that and how the non-bypass property is evidenced, not just assume a role
     the migrations never create.

### Non-blocking notes

- **D7 lock:** the insight purge does not conflict with the run-path payload trim, so taking
  `PurgeAdvisoryLockKey` exclusively only adds spurious Busy/lockRetry outcomes while runs trim. That is acceptable
  for symmetry, but write down the rationale. Alternatively, run it unlocked: the delete is idempotent and
  cross-instance overlap is harmless.
- **Failure reason:** the table has no `error`/`reason` column, so a `failed` attempt cannot say why. The ticket's
  column list omits it, so it is not in scope, but L4 will likely want one. Adding it now would save a follow-up
  migration. Consider raising it with the driver rather than deciding unilaterally.
- **`since` semantics (D2):** `listRecent(outputId, limit, since)` pushes `since` into SQL, while
  `OutputHistoryService.forOutput` applies it after `limit`. Either is defensible, but state which one, and have
  the history spec pin it.
- **Batching:** D7 is a single unbatched DELETE. That is fine at expected volumes (a handful of rows per Output
  per day), but note why HEL-1435-style batching is not needed.
