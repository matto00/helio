## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `1e0d610bbabb8744c75d11f901a4a88110d5efd5`. The change dir is untracked; there is no code diff yet.

### What I verified (with evidence)

**(a) D2 dashboard access: the check is right, but the stated reason is wrong.**
- `ResourcePermissionRepository.findGrant` (`infrastructure/persistence/auth/ResourcePermissionRepository.scala:80-90`) filters `granteeId === UUID(user)`. A public grant row (`grantee_id IS NULL`) can never match, and the check never reads a share token. Roles are only `Role.Editor`/`Role.Viewer` (`AclDirective.scala:118-121`). So owner-or-`findGrant` admits editor and viewer grantees and excludes public grants and share tokens. Verified.
- D2's reason is inaccurate. `authorizeResourceWithSharing` (`api/http/AclDirective.scala:80-150`) consults `hasPublicViewerGrant` only on the `userOpt = None` arm. A signed-in caller is never admitted by a public grant. It would admit a share token only if the route passed `shareToken = Some(..)`. With `Some(user)` and `shareToken = None` it is exactly owner-or-grant. The decision is safe; the rationale needs correcting (non-blocking).

**(b) D5 panel-scoped resolvers from the authenticated tree: they can be called, but two parts are under-specified.**
- `PublicPanelRowsResolver`, `PublicPanelHistoryResolver` and `PublicPanelOutputResolver` are public `final class`es. `PublicDashboardRoutes.scala:55-59` constructs them from `panelRepo, userOpt, outputRepo, nodeSnapshotRepoOpt, historyServiceOpt`, so `services/ask` can build them with `Some(user)`. `services/patchsets/*` already imports `com.helio.api`, so there is precedent for the layering.
- `resolveRows(dashboardId, panelId, page, sort, filter)` is keyed by **panel**, not Output. Filters are gated by that one panel's `controls` (`PublicPanelRowsResolver.scala:56-58`). The design does not say which panel's controls apply when several panels bind the same Output.
- `PublicPanelHistoryResolver.resolveHistory` returns the already-projected `PublicOutputHistoryResponse`. That response has no point ids, and it is not an `OutputHistoryResolution`. The existing adapter `InsightInputAdapters.fromResolution(output, OutputHistoryResolution)` (`services/insights/InsightInputAdapters.scala:16`) is the code that turns history into `InsightCompare`/`InsightWindow`. The design never names it, and "point ids are included only when readablePipelineId passes" cannot come out of the summary-only resolver at all.
- `InsightPack.WindowPointKeys = {t, v}` (`domain/insights/InsightPack.scala:33`). A pack window cannot carry a point id. The tool-result shape that tells the model a `pointId` for `get_history_rows` is unspecified.

**(c) D6/D7 citations across several tool results: the offset is sound, but the ledger has a race.**
- `Cells.next()` is `s"c${citations.size + 1}"` (`InsightContextBuilder.scala:132`). Adding `firstCitation` keeps the default byte-identical. `InsightValidator.validate`/`citationsUsed` only read `pack.citationById` (`InsightValidator.scala:20-35`), so `InsightPack(JsObject.empty, ledger.all, "")` works. Verified.
- **Race:** `ClaudeClient.sendWithTools` runs every tool use of one assistant response concurrently. It calls `Future.traverse(toolUses)` (`ClaudeClient.scala:148-154`), and each call is `Future(executor.execute(..))` (`ClaudeClient.scala:214`). D6's "pass `issued + 1` and append" is a read-then-write. Two `get_output_history` calls in the same response can both read `issued = k` and both issue `c(k+1)..`. `citationById` (`.toMap`) then silently keeps the last one, so a valid `[cN]` can validate against the wrong Output's value. Nothing in tasks.md would catch this.

**(d) Pin body against `POST /api/pipelines/:id/outputs` and `InsightReadsCheck`: accepted.**
- `CreateOutputRequest(nodeStepId, kind, name, config, rootId)` (`api/protocols/pipelines/OutputProtocol.scala:77-83`) and the schema (`schemas/outputs/create-output-request.schema.json`, top-level `additionalProperties: false`) accept `{nodeStepId|rootId, kind:"insight", name, config:{prompt, reads:{outputs}, refresh:"manual"}}`.
- `InsightConfig.parse` accepts these: `prompt` at most 2000 characters (the question cap matches), `reads.outputs` 1..8 distinct, `refresh` `manual`.
- `OutputService.create` (`OutputService.scala:127-185`) rejects a Viewer with 403 and runs `InsightReadsCheck` (non-insight, same pipeline, not self). D10's one-pipeline, non-insight, at-most-8 rule satisfies it. `nodeStepId`/`rootId` are mutually exclusive, and D10 picks one.
- Gap: `name` is required (`minLength 1`), but D10 never says what the pin's `name` is (non-blocking).

**(e) Would the tests be red without the implementation?** Everything is new code, so all of it is trivially red. The real question is whether each guard has a test that its mutation turns red:
- 4.1 (off-board / payload-row error results) does catch a dashboard path that bypassed the panel set. In dev/CI, `OutputService.rows` would serve the rows, because RLS is bypassed.
- **No test catches "scope resolved once at loop start" instead of "per call".** That is the ticket's literal requirement ("every tool call re-checks access"). A cached board set passes 4.1 unchanged.
- **The Output route's access gate cannot be red in dev/CI as designed.** D2 uses `OutputService.findById`, which calls `outputRepo.findById` (`OutputRepository.scala:144-145`): `withUserContext` plus `filter(_.id === id)`, with **no** owner or grant predicate. It relies on RLS, which never runs in dev/CI (`MISTAKES.md:163-166`). `OutputHistoryService.read/payloadRows` (`OutputHistoryService.scala:52-66`) has the same dependency. In dev/CI any signed-in stranger passes the gate, and that gate fronts a billed model call. Task 4.4 lists no Output-route stranger case, so this goes unnoticed. `OutputReadAccess.readablePipelineId` (`services/pipelines/OutputReadAccess.scala:16-26`) uses an explicit SQL predicate. It is `private[services]`, so it can be reached from `services/ask`.

**Driver decisions in ticket.md, checked against their sources.**
- I checked "Owner rulings R1/R2 (HEL-1755)" against Linear HEL-1755 and against `.concertino/runs/HEL-1743/.../insight-render-triggers/ticket.md:24-38`.
  - R1/R2/R3/R3b are **HEL-1743 (L4) rulings about insight renders** (a per-Output `model` config key, render billing weights, insight-route visibility).
  - They are not HEL-1755 rulings, and they say nothing about ask.
  - HEL-1755's own text lists the insight leaves affected as L1/L4/L5. L6 is not among them.
  - The epic ruling that does govern ask is D1: "the shared `CLAUDE_MODEL` for v1" (`.concertino/scratch/driver/hel921-leaves-draft.md:62`), plus D3 (each ask counts against the shared counter).
  - The Linear HEL-1745 text has no `model` request field.
  - **So the optional `model` request field on ask is an unruled product addition, attributed to the wrong rulings.** If it stays, so does the question of whether the default should be the user's Settings default (HEL-1755's chat rule) or the server default. That is also unruled for ask.
- "Default = server `CLAUDE_MODEL`" with no `model` field is consistent with epic D1 and needs no ruling.
- "No model/token/cost in the response" is stricter than any ruling and harmless.
- "Pin without render because L4 is unmerged" is consistent with the ticket's own dependency (L4 parked) and with D10. It is defensible.

**Other checks.**
- Billing primitives exist as D3 describes: `ChatAccessService.guard`/`checkConverseCap(user, tier, weight, label)` (`ChatAccessService.scala:30-52`) and `AssistantModelPolicy.validate/serverDefault/specFor/weightOf` (`AssistantModelPolicy.scala:11-30`).
- `ClaudeToolRequest` defaults `webSearch = false`, `temperature = None`, and has `model: Option[ClaudeModelSpec]` (`ClaudeModels.scala:180-191`).
- `FinalResponse` returns `history`, so D7's continuation is implementable.
- `PipelineRepository.findGrantRole` exists (`PipelineRepository.scala:186`).
- `DashboardAuthoringRoutes` takes `Some(chatAccessService)` (`ApiRoutes.scala:1077`).

### Verdict: REFUTE

### Change Requests

1. **Make the citation ledger safe under concurrent tool calls (D6, task 2.2).** Tool uses within one response run concurrently (`ClaudeClient.scala:148-154, 214`). D6 must require that reserving an id range and appending the pack is one atomic step. Either build the pack inside a `synchronized` reserve-and-append, or pack with a placeholder and renumber under a lock. Add a test where one scripted assistant response carries two `get_output_history` tool uses. Assert that the ids are disjoint and that the answer validates against the correct Output's value. Record the red with the atomicity removed.
2. **Output-route access must not rest on RLS alone (D2, D4 Output path, task 4.4).**
   - Gate `POST /api/outputs/:id/ask`, and every Output-path tool call, on `OutputReadAccess.readablePipelineId`, whose predicate is explicit in SQL, before any `OutputService`/`OutputHistoryService` read.
   - State that `OutputService.findById` and `rows` are RLS-only in dev/CI (`OutputRepository.scala:144-145`) and are used only after that gate.
   - Add to 4.4: a signed-in stranger on the Output route gets `404` with no model call and no charge. Record its red against a `findById`-only gate.
3. **Add a per-call re-check test (task 4.1 or a new one).** Between hop 1 and hop 2 of the scripted transport, remove the panel binding (or revoke the dashboard grant). The hop-2 tool call must return an error result with no data. Record its red against a mutation that resolves the board set once at loop start. This is the ticket's literal "every tool call re-checks access".
4. **Specify the dashboard-path history read precisely (D5).**
   - Use `PublicPanelOutputResolver.resolvePanelOutput`, then `OutputHistoryService.forOutput`, then `InsightInputAdapters.fromResolution`. Alternatively, state how `PublicOutputHistoryResponse.points[].summary` becomes window values (the `OutputHistoryService.headline` rule) so it does not drift from L3's adapter.
   - Specify the `get_output_history` tool-result shape: the packed JSON, plus (only when `readablePipelineId` passes) a separate `points: [{pointId, t}]` list outside the pack, since `WindowPointKeys = {t, v}`.
   - State that a summary-only caller receives no point ids, so `get_history_rows` is not offered to them.
5. **Resolve the panel ambiguity in `get_output_rows` (D5).** When several panels on the board bind the same Output, define which panel's `controls` gate `filter`/`sort`. For example: the union of their control columns, iterating panels and passing if any panel admits the filter. Add a scenario for it.
6. **Remove the unruled `model` request field, or escalate it (proposal, D3, spec "Request and response contract", tasks 3.1/3.4/4.5).**
   - R1/R2/R3/R3b are HEL-1743 render rulings, not HEL-1755 ask rulings. Neither the ticket nor any ruling gives ask a `model` parameter.
   - Within the rulings, the minimal version is: no `model` field; always the server `CLAUDE_MODEL` (epic D1); charged `policy.weightOf(serverDefault)` through `guard` + `checkConverseCap` (epic D3/D6).
   - If the planner wants per-ask model choice, it is an owner call. Raise it through the escalation channel, including the user-Settings-default vs server-default question. Do not keep it on the driver's say-so.
   - Fix the "Driver decisions" attribution in ticket.md either way.

### Non-blocking notes

- Correct D2's rationale: `authorizeResourceWithSharing` with `Some(user)` and `shareToken = None` is already owner-or-grant. The custom check is fine; the claim that the directive "would admit a public-viewer grant" is not.
- D10: say what the pin's `name` is (required, `minLength 1`). Suggestion: the trimmed question, truncated. Also say how "owner" is checked, since `findGrantRole` covers grantees only.
- D5 `list_board_outputs` returns row counts with no citation. Any numeral the model repeats from it fails the validator and burns the retry. Either cite it or leave it out.
- D5: state that the ~4k cap sheds before `pack` is called, so the ledger holds only citations that were actually sent.
- `maxHops = 4` allows four tool-executing round trips plus a fifth that must answer (`ClaudeClient.scala:144`). Use that count in the live-check cost projection.
