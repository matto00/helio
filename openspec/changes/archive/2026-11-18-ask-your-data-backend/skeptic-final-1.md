## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b2368ece36825c242b0587acba3ab302c5b9f20b` against the live-resolved base `1e0d610bbabb8744c75d11f901a4a88110d5efd5` (`resolve-review-base.sh`, exit 0). The diff is one commit, 37 files, and contains no `frontend/` change, so the UI step (section 4) does not apply and no servers were started. I made no live model call.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/ask-your-data-backend/HEL-1745`.

**Gates, run fresh.** I ran `nice -n 19 sbt -J-Xmx3g "testOnly AskDataServiceSpec AskCitationLedgerSpec AskRoutesSpec InsightContextBuilderSpec ExistenceNotLeakedRoutesSpec"` with exit 0. The output read `Suites: completed 5, aborted 0` and `Tests: succeeded 110, failed 0`. The log is at `.concertino/scratch/HEL-1745/skeptic-final-run1.log`.

**Scope-guard mutations.** I ran each one, then restored the source with `git checkout --`. Afterwards `git diff` was empty, and a re-run of AskDataServiceSpec plus AskRoutesSpec gave 29/29 green:
1. In `AskToolExecutor.withOutput`, I admitted any model-supplied id: `snap.find(id)` became "found, or fall back to the first panel's bindings". **4 tests went red:** off-board viewer, RLS-bypassed payload, panel removed between hops, and Output scope refuses other ids.
2. In `AskToolExecutor.historyRows`, I dropped the per-call `pipelineGrant` check, with mutation 1 reverted. **1 test went red:** "refuse a dashboard-only viewer's payload read even when row-level security is bypassed".
   - The non-bypassed test stays green under this mutation, because in the harness RLS catches it.
   - So the bypass-shaped test is the only one guarding the explicit check, and it does guard it.
3. In `AskAccess.gate`, I let the dashboard gate fall back to `requireAccess(..., None)`, which is the public-viewer-grant path. **1 test went red:** "give 404 ... to every stranger shape", the public-dashboard rows.

**Access never rests on RLS alone**:
- **Dashboard gate.** `AskAccess.gate` calls `AccessCheckerImpl.requireAccess` with `Some(user)`. I read `AccessCheckerImpl.scala`: with a signed-in caller it checks the owner (`ownerResolver`, via `findByIdInternal`) or `findGrant(type, id, user.id)` under `withSystemContext`. It never calls `hasPublicViewerGrant` and never reads a token. So public grants and share tokens are excluded by construction, and mutation 3 confirms it.
- **Output gate.** It uses `OutputReadAccess.readablePipelineId`, the explicit-SQL check. AskRoutesSpec holds it on a superuser `DbContext`.
- **`get_history_rows`.** Every call re-runs `pipelineGrant` before `OutputHistoryService.payloadRows`, which ties the point to its Output and holds against an RLS bypass (mutation 2).

**Model-supplied ids.** `withOutput` re-runs `access.resolve` on every call: the gate plus a fresh panel read. An id outside the snapshot gets the same `notAvailable` text whether or not it exists.
- Dashboard rows go only through `PublicPanelRowsResolver.resolveRows(dashboardId, panelId)`, using the panels from the snapshot.
- On the Output scope the snapshot holds only the route's id.
- `AskScope` ids come only from the route.

**No leak of model, usage or cost.**
- `AskQuestionResponse` has four fields, and its writer emits exactly those keys.
- AskRoutesSpec checks the keys at every depth.
- `AskUngroundedResponse` is `{message, code, reasons}`.
- `grep` for insert/update/delete/save under `services/ask/` finds no write, so nothing is persisted.

**Pin round-trip.**
- The pin body is `JsObject{rootId|nodeStepId, kind, name, config{prompt, reads.outputs, refresh}}`.
- `OutputRoutes.scala:84` unmarshals `entity(as[CreateOutputRequest])` with `createOutputRequestFormat`, the same format AskDataServiceSpec uses (`pin.request.convertTo[CreateOutputRequest]`) before it calls the real `OutputService.create`. The create succeeds as kind `Insight`.
- `OutputService.create` re-checks editor access and `checkInsightReads`.
- Gating is `requireAccess("pipeline")` with Owner or Editor; viewer, dashboard-only and cross-pipeline askers get `null` (tested).

**AC trace**:
- **Fail-first, off-board and payload:** AskDataServiceSpec "give a dashboard-only viewer error results ..." (t1, t2 and t3 are errors; no `PAYLOAD-ROW`; no `points`) and the RLS-bypassed variant. Mutations 1 and 2 show these tests fail when the guard is removed.
- **No write or propose tool:** "hold only read tools, no web search ..." asserts the exact four-name set, the forbidden substrings, no `WebSearch` spec, and no sampling, `tool_choice` or `thinking` on the wire, for Haiku, Sonnet and Opus.
- **Day-14 citation:** "cite the day-14 point ..." checks that the answer cites the `recent.t` citation dated 2026-11-14, that the response lists it, and that its ids are disjoint from the earlier rows result.
- **Live check:** `evidence/live-check.md` covers 3 questions on `claude-haiku-5-5`, with the model asserted on the first hop, about $0.0012 against the $1 cap, and fixture rows deleted by exact id. I accept it as recorded evidence and did not re-run it, per the instruction.
- **Billing:** AskRoutesSpec shows free gets 403 `TIER_FORBIDDEN` with no model call; beta is charged 1, 4 or 8 by catalog weight; owner pays 0; the retry is not charged again; an empty question gets 400 with no charge.
- **Order:** in `AskRoutes`, the access check runs before the 503, the body check, the tier check and the charge.

**System-prompt `rank` line** (`AskPrompts.scala`). It matches a real fact: `InsightContextBuilder.scala:172` emits `rank` as a cited numeric cell holding the row position. The line is narrow and harmless.
- Its effect is unproven. Q1 was not re-asked, and Q2 and Q3 did not hinge on rank.
- The evaluator's timeline for this line rests on mtimes. It discloses that, and it does not rest the content claim on them, so I record no gate defect.

### Verdict: CONFIRM

### Non-blocking notes
- **Pin `rootId` fallback is untested.** In the test fixture the root id equals the pipeline id (`OutputHistoryFixtures.scala:36`), so `req("rootId") shouldBe JsString(pid)` cannot tell the real `node.rootId` apart from the fallback. The fallback is `AskPinBuilder.scala`: `rootId.getOrElse(pipelineId)`. That fallback would be rejected by `resolveExplicitRootId`; it is reachable only for a pre-V98 row with no `root_id`. A fixture with a distinct root id would make the test meaningful.
- **"Default numbering unchanged" is a weak test.** `InsightContextBuilderSpec` compares the new code's default against the new code with an explicit `firstCitation = 1`, not against output from before the change. The code change is trivially equivalent, and the pre-existing L3 tests still pass.
- **422 reasons can echo uncited numerals.** `ASK_UNGROUNDED` `reasons` quote the uncited numerals from the rejected answer, for example "numeral '99' ...". That is not answer prose, and the model only ever saw in-scope data, but it is stricter to state "no answer text" with that in mind.
- **Thinking blocks with a 1,024-token cap.** The live hops show `thinking,text` blocks while `MaxAnswerTokens = 1024`. If adaptive thinking ever consumes the cap, the ask surfaces as a 502. Worth watching once L5 puts real traffic on it.
- **Ledger call count.** `AskCitationLedger.packAndRecord` counts a call before the token-budget refusal, so a refused-for-tokens call still uses one of the 6 call slots. This is conservative and harmless.
