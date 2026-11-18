## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD fd7090bf6bc10a091c99d8090a440093ced74475. This equals origin/main, and the branch has no commits; the
change dir is untracked. I judged the artifacts on their own merits and re-derived every claim from the tree.

### What I verified (with evidence)

- **Round-1 CR1 (no model client by construction): fixed.** D3 now limits the constructor to
  `OutputRepository`, `OutputInsightRepository` and the implicit `ExecutionContext`. It forbids `OutputService` and
  replaces the deny-list guard with an exact-equality guard, with the red mutation "add an `OutputService` param".
  The spec scenario matches. `OutputRepository.findById(id, user)` exists at OutputRepository.scala:144
  (`withUserContext` plus sharing RLS), and `Output` carries `kind: OutputKind`, which includes `Insight`
  (model.scala:652-657, 606-615). So the D4 kind gate is implementable from the one ACL'd read.
  - Nit: D3 says "both repositories hold only a `DbContext`". `OutputRepository` also takes
    `PipelineDefinitionLocks` (OutputRepository.scala:28). That is a lock helper, not a model path, so the
    conclusion still holds.
- **Round-1 CR2 (citation shape): fixed.** The L3 `Citation` is
  `(id, outputId, field, number: Option[Double], date: Option[Instant], capturedAt: Option[Instant], isPct)`
  (InsightPack.scala:9-17). The design's Context and the D1 stored element now match it exactly.
  `InsightValidator.citationsUsed(text, pack): Vector[String]` exists (InsightValidator.scala:32). D1 also pins
  "ok row stores only the used citations, non-ok row stores `[]`". The public element in D6 and the spec is
  explicit.
- **Round-1 CR3 (ACL-free public read path): fixed.** D3 and D6 name `latestOkFor(output)`, document it as no-ACL,
  return `None` for a non-insight kind, and wire it as `insightReadServiceOpt` next to `historyServiceOpt`. That
  parameter is real (PublicDashboardRoutes.scala:43; ApiRoutes.scala ~880, where it is passed as
  `Some(outputHistoryService)`).
- **Round-1 CR4 (live RLS executable): fixed.** D9 now:
  - runs the automated spec as `helio_app_test`, which is accurate (OutputHistoryRlsSpec.scala:16, 46-55: created
    NOSUPERUSER, with schema usage and table DML granted, used via `SET ROLE`);
  - creates the manual-check role `helio_app` NOBYPASSRLS inside one transaction that is rolled back;
  - captures `pg_roles` proof first.

  This is a sound, residue-free procedure. I did not re-probe the local cluster's roles, because that would need
  credentials from `.env`, which is forbidden. The planner's "no `helio_app` role locally" claim is unverified by me
  but harmless: the procedure creates the role either way. If the role already exists, `CREATE ROLE` would error
  and the transaction would abort loudly, not silently.
- **Migration ledger.** The worktree and origin/main both end at V141. The only lane migration at 142 or above is
  HEL-1739's V144. V142 is free, and the D8 renumber rule is correct.
- **Retention (D7).** I checked it against OutputHistoryRetentionService.scala:91-133:
  - The history and payload parts fold into `failed`/`busy`/`more` booleans. A third part that is only `Ran` or
    `Failed` slots in without changing the Busy semantics.
  - The no-lock rationale is now written down (round-1 note addressed).
  - The constructor has no defaulted slot except `protectedNewest`, so a new no-default param forces `Main` wiring.
  - Keeping the newest ok row and the newest attempt matches the spec scenario.
- **Query parsing reuse (D5).** `OutputHistoryQueryParsing.parse` is 1..100, default 30, never clamped
  (OutputHistoryQueryParsing.scala:16-27), as claimed. The `since`-before-`limit` semantics are now stated and
  pinned by a test (round-1 note addressed).
- **Surface.** `RlsPolicyGuardSpec.rlsTables` exists. `schemas/outputs/` has the `public-output-history-response`
  precedent. CLAUDE.md:51 still carries the stale `ANTHROPIC_API_KEY` text, and task 1.10 covers it.
- **Public gate: NOT adequately specified. See CR1.**
  - `PublicPanelOutputResolver.resolvePanelOutput` calls `panelRepo.findAllByDashboardId(..., accessAlreadyGranted =
    true)` (PublicPanelOutputResolver.scala:30). Its own scaladoc (lines 11-28) says "the caller already passed the
    dashboard-level ACL gate to reach here".
  - That gate lives only in the route tree. Every public panel route wraps its resolver in
    `aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, "Dashboard not found", token)` and
    reads a `token` query parameter (PublicDashboardRoutes.scala:152-171 for `history`).
  - The design's Context calls `resolvePanelOutput` "the single panel -> Output gate". D6 and the spec say only "a
    panel the existing public panel gate admits". Neither the directive, the `token` parameter nor any test of the
    dashboard-level denial appears in D6, the spec or tasks 1.7/2.3.
  - An implementer who follows D6 literally ("the resolver calls `resolvePanelOutput`, then `latestOkFor`") ships
    an unauthenticated endpoint that serves insight markdown from any dashboard's panel. The test plan as written
    would not catch it, because 2.3 checks only the projection's field allow-list.
  - This is the one unauthenticated read in the ticket, and the most sensitive surface it adds.
- **AC coverage.** Each AC maps to a task:
  - 404 parity: task 2.1, authenticated route only (see CR1 for the public route).
  - Public schema test: task 2.3.
  - Cascade: task 2.4.
  - No model client: tasks 1.4 and 2.5.
  - Live RLS as non-bypass: tasks 2.7 and 2.8.
  - CLAUDE.md: task 1.10.

  I found no TODO/TBD placeholders and no scope drift. L4/L5 items are correctly excluded.

### Verdict: REFUTE

### Change Requests

1. **Specify and test the public route's dashboard-level authorization (design Context, D6, spec "Public insight
   read", tasks 1.7 and 2.3).**
   - **Context:** correct the claim. `resolvePanelOutput` is the panel-to-Output resolver, and it runs with
     `accessAlreadyGranted = true`. The authorization gate is
     `aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, "Dashboard not found", token)`
     in the route tree.
   - **D6 and the spec:** state that the route accepts `?token=` and is wrapped in that directive exactly as the
     `history` route is (PublicDashboardRoutes.scala:152-171), before `resolvePanelOutput` runs.
   - **Task 2.3:** add these scenarios, each recorded red first (C6):
     - an anonymous caller on a private dashboard gets 404 with the same body as an unknown dashboard;
     - a signed-in stranger gets the same 404;
     - a valid share token gets 200;
     - a panel id from another dashboard gets 404.
   - **Mutation (task 2.9):** removing the directive turns the private-dashboard test red.

### Non-blocking notes

- D7 cites "(D4)" for "at most one on_run render per Output per hour". That is the epic's ruling D4
  (`.concertino/scratch/driver/hel921-leaves-draft.md:65`), but in this design D4 is the ACL decision. Write "epic
  D4" to avoid misreading.
- D3's "both repositories hold only a `DbContext`" is slightly inaccurate (`OutputRepository` also takes
  `PipelineDefinitionLocks`). It is harmless, but correct the wording.
- D5 does not say how `OutputInsightReadService` reaches `OutputRoutes`. Presumably it mirrors
  `historyService: Option[OutputHistoryService] = None` (OutputRoutes.scala:32). Note that an `Option` defaulting to
  `None` there means a missed wiring silently rejects the route, and only a route spec built through `ApiRoutes`
  would catch that. Either use a no-default parameter or make the 2.1 route spec build through the production
  wiring.
- Round-1 note on a failure `reason`/`error` column: it is still absent. L4 will likely want one. Consider raising it
  with the driver before V142 is applied, since adding it later costs another migration.
