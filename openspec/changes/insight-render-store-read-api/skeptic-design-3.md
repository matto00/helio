## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD fd7090bf6bc10a091c99d8090a440093ced74475 (planning artifacts untracked in the change dir).
I re-derived every load-bearing claim from the live tree. I did not rely on earlier skeptic reports.

### What I verified (with evidence)

- **Migration numbering.**
  - The tree's highest migration is `V141__outputs_kind_insight.sql` (`ls db/migration | sort -V`), so V142 is free.
  - The local shared dev DB's applied max is 140 (read-only `SELECT max(version)` on `flyway_schema_history`). V141 is
    not applied there yet. D10's precondition ("applied max below 142") holds.
- **V115 pattern (D1).** `V115__*.sql` matches the design's description exactly:
  - UUID pk with `gen_random_uuid()`;
  - `output_id` FK `ON DELETE CASCADE`;
  - `pipeline_id` and `run_id` as TEXT with no FK;
  - ENABLE + FORCE RLS, with four policies on `helio_can_access_pipeline(pipeline_id)`;
  - an explicit `GRANT ... TO helio_privileged`.
- **L3 types (D1 citations).** These exist as the design describes:
  - `InsightPack.Citation` (`domain/insights/InsightPack.scala:9`) has `id, outputId, field, number, date, capturedAt,
    isPct`.
  - `InsightUsage` has input, output, cacheCreation and cacheRead counts (`InsightModelClient.scala:13`).
  - The stored and public citation shapes are fully specified, and they name `StoredInsightCitation.from` as the only
    construction path.
- **Model-client isolation (D3, AC "no model client by construction").**
  - `OutputService` is built with `pipelineRunService` (ApiRoutes.scala:516-525), so excluding it is correct.
  - `OutputRepository(ctx: DbContext, locks: PipelineDefinitionLocks)` (OutputRepository.scala:28) holds no model
    path.
  - An exact-equality constructor allow-list, with an `OutputService`-parameter red mutation, turns red on any added
    collaborator, including transitive carriers.
- **Authenticated ACL (D4/D5).**
  - `OutputHistoryService.read` authorizes via `outputRepo.findById(id, user)` and maps `None` to
    `NotFound("Output not found")` (OutputHistoryService.scala:52-57). This is the 404-indistinguishability shape the
    design copies.
  - `OutputRoutes` takes `historyService: Option[...] = None` (OutputRoutes.scala:32), and `path("history")` reuses
    `OutputHistoryQueryParsing`, which validates 1..100 with default 30 and never clamps (verified in the source).
  - The risk that `Option`-defaulted wiring rejects silently is mitigated: task 2.1 builds through `ApiRoutes`.
    Existing precedents that do this are `ApiRoutesAlertHistoryWiringSpec` and `NodePayloadWiringSpec`.
- **Public route (D6).**
  - The `history` route (PublicDashboardRoutes.scala ~152-171) parses `token`, wraps the call in
    `aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, "Dashboard not found", token)`, and
    only then calls the resolver.
  - `PublicPanelOutputResolver.resolvePanelOutput` returns 404 for a panel that is not on this dashboard, a
    non-`OutputPanel`, an unbound panel, or an unknown Output.
  - `PublicPanelHistoryResolver` plus `historyServiceOpt` (ApiRoutes.scala:880) is the precedent for the new resolver
    and the `insightReadServiceOpt` parameter.
  - The excluded-field list covers the AC (cost, model, run id) and goes beyond it: tokens, digest, trigger,
    attempt status and cited `outputId`.
  - Task 2.3 includes the anonymous, stranger, share-token and foreign-panel cases. Task 2.9 includes the
    "directive removed" mutation.
- **Retention (D7).**
  - `OutputHistoryRetentionService.runPass` has a history part and a payload part, combined by
    failed/busy/more precedence (OutputHistoryRetentionService.scala:90-140). The design's third part can be `Ran` or
    `Failed` (never `Busy`) and folds into that precedence without changing the lock-retry semantics.
  - `OutputHistoryRetentionConfig.maxAgeByTier` covers all three tiers. "Absent tier = strictest" mirrors
    `OutputHistoryRepository`'s documented behavior (line 103).
  - Main.scala:290 builds the service positionally, so a no-default parameter forces the wiring.
- **`withSystemContext`** runs `privilegedDb.run(action.transactionally)` (DbContext.scala:63). Reading after a
  service ACL, with RLS as defense in depth, is the house pattern.
- **Live RLS (D9, AC).**
  - `OutputHistoryRlsSpec` creates `helio_app_test` as NOSUPERUSER, asserts `rolbypassrls = false`, and tests owner,
    grantee and stranger SELECT plus INSERT refusal. The design follows it.
  - I re-ran a read-only `pg_roles` probe: no `helio_app` role exists on the local cluster (`helio_privileged|f|t`,
    plus a stray superuser `helio_hel818`). So D9's create-in-a-rolled-back-transaction plan is necessary. It is also
    executable: CREATE ROLE is transactional, and a superuser can `SET LOCAL ROLE`.
- **CLAUDE.md.** Line 51 contains the stale "no route consumes this yet" text for `ANTHROPIC_API_KEY`, while
  `ApiRoutes` constructs `HttpClaudeTransport` (ApiRoutes.scala:246). Task 1.10 covers the fix.
- **AC coverage trace:**

  | Acceptance criterion | Covered by |
  | --- | --- |
  | Same 404 for non-grantee and unknown id | D4, task 2.1 |
  | Public schema has no cost/model/run id | D6, task 2.3 |
  | Deleting an Output cascades | D1, task 2.4 |
  | Reads never regenerate; no model client | D3, task 2.5 |
  | Live RLS as `helio_app` | D9, tasks 2.7/2.8 |
  | CLAUDE.md endpoint list and `ANTHROPIC_API_KEY` row | task 1.10 |

  Every ticket element is planned: table columns, RLS, grant, `rlsTables`, the three endpoints and tier retention.
- **Scan for placeholders and contradictions.** No TODO or TBD. Proposal, design, tasks and spec agree: the same
  allow-list, the same exclusions and the same retention exceptions. Scope stays inside the ticket, with frontend and
  L4 work explicitly excluded.

### Verdict: CONFIRM

### Non-blocking notes

- **Authenticated history detail.** D5's authenticated `render` and `history` items include `model`, the token
  counts and `costMicros` for every grantee, including `viewer` grantees. The ticket only restricts the public route,
  so this is in scope as written. The executor or L5 may still want to confirm that a viewer should see the owner's
  per-render cost.
- **Purge join.** D7's purge joins the tier through `pipelines.owner_id`, and `pipeline_id` has no FK. A row whose
  pipeline row is gone would never match the join. Outputs cascade with their pipeline, so this is likely
  unreachable. An implementer should still use the join shape `OutputHistoryRepository`/`HistoryThinBatching`
  already uses, not invent a new one.
- **Constructor parameter order.** `OutputHistoryRetentionService`'s last parameter `protectedNewest` has a
  default. Put the new no-default insight-repo parameter before it, so existing tests that pass `protectedNewest`
  positionally fail loudly and are not silently re-bound.
- **Shared dev DB.** The local dev DB has not applied V141 yet. Applying V142 there also applies V141 first. That is
  expected, but worth knowing when reading Flyway output (shared-DB hazard in MISTAKES.md).
