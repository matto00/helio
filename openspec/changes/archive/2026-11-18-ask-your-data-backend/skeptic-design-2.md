## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `1e0d610bbabb8744c75d11f901a4a88110d5efd5`. The change dir is untracked and there is no code diff. I checked every claim against the live code. I did not take the round-1 report or the revisions' word for anything.

### What I verified (with evidence)

**Round-1 CR1 (ledger race): resolved.**
- `ClaudeClient.sendWithTools` still runs one response's tool uses with `Future.traverse` (`ClaudeClient.scala:148-158`). Each call runs as `Future(executor.execute(..))` (`:214`).
- D6 now builds the pack and appends its citations inside one `synchronized` `packAndRecord`.
- `InsightContextBuilder.pack(in, keepRows, limits)` is pure (`InsightContextBuilder.scala:65-81`). `Cells.next()` is `c${citations.size + 1}` (`:114`), so a `firstCitation` offset is a one-line change, and the default keeps output byte-identical.
- Task 4.1c and the spec scenario "Two history calls in one response" ask for disjoint ids and a red with the lock removed.

**CR2 (Output route relied on RLS): resolved.**
- `OutputReadAccess.readablePipelineId` (`services/pipelines/OutputReadAccess.scala:16-26`):
  - It reads the Output's pipeline with `findByIdInternal`, then releases it only through `PipelineService.findSummaryById`, whose predicate is explicit SQL.
  - It is `private[services]`, so `services/ask` can call it.
- D2 and the spec make it the Output-route gate and the per-call gate. The Context section says `findById`/`rows` and `OutputHistoryService.read/payloadRows` are RLS-only. I confirmed this: `OutputHistoryService.scala:52-66` uses `outputRepo.findById`.
- Task 4.4 adds the Output-route stranger case (404, no model call, no charge), with a red against a `findById`-only gate.

**CR3 (per-call re-check): resolved.**
- D4 caches nothing. Each call re-runs the access check and re-reads the panel set.
- Task 4.1b covers both a panel removed between hops and a grant revoked between hops, and records a red against a loop-start cache.

**CR4 (dashboard history read): resolved, and it can be built as written.**
- The chain D5 names exists with the signatures it assumes:
  - `PublicPanelOutputResolver.resolvePanelOutput(dashboardId, panelId): Either[ServiceError, (OutputPanel, Output)]`
  - `OutputHistoryService.forOutput(output, config, limit, since)`, which has no ACL and reads no RLS-dependent Output (`OutputHistoryService.scala:89`)
  - `InsightInputAdapters.fromResolution(output, resolution)` (`InsightInputAdapters.scala:16`)
- `PublicPanelHistoryResolver` (`:24-40`) runs this same sequence for anonymous callers, so it works without a pipeline grant in prod.
- The tool result is `{pack, points?}`, with `points: [{pointId, t}]` kept outside the pack. That is correct given `WindowPointKeys = {t, v}` (`InsightPack.scala:34`). `points` is included only when `readablePipelineId` passes. `get_history_rows` is not offered to a caller who sees only summaries.

**CR5 (several panels bind one Output): resolved.**
- `resolveRows` gates on the panel's own controls and returns `Left(BadRequest)` when the panel does not admit the filter (`PublicPanelRowsResolver.scala:52-64`). Trying each binding panel in order and using the first that admits the filter is well-defined and buildable.
- `get_output_rows` has no `sort` input, so `validateSortColumn` always sees `None`.
- Task 4.1d and the spec scenario cover it.

**CR6 (unruled `model` field): resolved within the rulings.**
- The request has no model field. D3 uses `policy.serverDefault` and sends `policy.specFor(serverDefault)`, so the catalog request rules apply (`AssistantModelPolicy.scala:25-28`).
- ticket.md's driver-decisions section now says R1/R2 are HEL-1743 render rulings. I confirmed that against `.concertino/runs/HEL-1743/**/ticket.md`: R1 is a per-Output render `model` config key, and R2 sets render weights.
- Epic D1 ("the shared `CLAUDE_MODEL` for v1", `.concertino/scratch/driver/hel921-leaves-draft.md`) governs ask. A per-ask model choice is listed as a non-goal and an open owner question for the PR. Nothing was decided on the owner's behalf.
- Weighting is one residual point; see the first non-blocking note.

**Round-1 non-blocking notes: all addressed.**
- D2's rationale is corrected. `AccessChecker.requireAccess("dashboard", id, Some(user))` is literally owner, else `findGrant`, else 404, and it never consults a public grant for a signed-in caller (`AccessCheckerImpl.scala:51-86`).
- The pin `name` is the question cut to 80 characters. The schema only requires `minLength 1` (`create-output-request.schema.json:19-22`).
- The owner and editor check goes through `requireAccess("pipeline")`.
- Row counts were dropped from `list_board_outputs`.
- The shed happens before recording.
- The live-check projection counts 5 round trips.

**Other checks.**
- Route mounting: the public tree only matches `dashboards/:id/panels/...` (`PublicDashboardRoutes.scala:63`), so `POST /api/dashboards/:id/ask` on the authenticated tree (beside `DashboardAuthoringRoutes`, `ApiRoutes.scala:1077`) does not collide with it.
- The retry design (`maxHops = 1` continuing `FinalResponse.history`) matches the loop's semantics:
  - `thisHop > maxHops` yields `HopBudgetExhausted` (`ClaudeClient.scala:144`).
  - `FinalResponse` carries `history` (`ClaudeModels.scala:213`).
- Billing primitives exist as described:
  - `checkConverseCap(user, tier, weight, label)` (`ChatAccessService.scala:40`)
  - `weightOf` uses the env-overridable catalog weight (`ClaudeModelCatalog.scala:45-47`)
  - Catalog ids `claude-sonnet-5-5` etc. (`:53-55`) match the spec scenario.
- AC coverage: fail-first (4.1), tool-schema assertion (4.2), day-14 citation (4.3, built on `windowJson` date cells, `InsightContextBuilder.scala:154-163`), and the live check (4.10/C15). The model id is asserted on the first hop before going on.

### Verdict: CONFIRM

### Non-blocking notes

1. **The ask weight is an interpretation; say so in the PR.**
   - Epic D3 says "each render or ask counts 1". The owner's R2 amended that to chat weights for renders only.
   - D3 and the spec scenario "Beta ask on a Sonnet server default: counter +4" apply catalog weights to ask too. This is what round 1 suggested, and it matches how chat charges its server default.
   - The repo's own `HELIO_BETA_MODEL_WEIGHTS` row in CLAUDE.md says "pipeline AI and authoring calls keep weight 1". So the existing convention for non-chat callers is also 1, not the catalog weight.
   - With prod pinned to Haiku (weight 1) the two readings give the same result, so nothing ships differently today.
   - It is still an extension of a render ruling to ask. List it next to the per-ask-model question in the PR's open owner questions rather than presenting it as ruled.
2. **"Shed before `pack` is called" (D5).** You cannot estimate a pack's tokens without building it. State that trial packs are built outside the lock (`pack` is pure) and that only the final, within-budget pack goes through `packAndRecord`. Otherwise an implementer may record shed trial packs.
3. **Per-hop input size.** The ticket says "about 20k input tokens per hop". Each tool result is capped at about 4k tokens, but nothing caps how many tool uses one response may carry, and history accumulates over 4 hops. A response with many parallel calls can push the loop toward the `CLAUDE_MAX_INPUT_TOKENS` guardrail. That gives a `413` after the ask was charged. Consider capping honoured tool uses per response, or a total ledger budget, and put the worst case in the live-check projection.
4. **History config source.** `forOutput` needs the Output's config. On both paths, read it with `outputRepo.findConfigsByIdsInternal` after the gate, as `PublicPanelHistoryResolver` does, not with `findConfigById(id, user)`, which depends on RLS.
5. **Insight-kind Outputs in pin `reads`.** D10 says "1..8 cited non-insight Outputs" and the spec says reads are "the cited non-insight Output ids". Make it explicit whether a cited insight Output is filtered out of `reads` or makes `pin` null. Either is fine; the test in 4.7 should pin one down.
