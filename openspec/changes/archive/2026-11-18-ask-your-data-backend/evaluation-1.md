## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `b2368ece36825c242b0587acba3ab302c5b9f20b` (base `1e0d610bbabb8744c75d11f901a4a88110d5efd5`, resolved live).
Backend only. No UI files changed.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- Every acceptance criterion is covered, and each one has evidence:
  - **Fail-first.** In `AskDataServiceSpec` "scope enforcement (4.1)", a dashboard-only viewer calls `get_output_rows` and `get_output_history` on an off-board Output, and `get_history_rows` on an on-board payload. Each call returns an error result with no data and no point ids. The test "refuse a dashboard-only viewer's payload read even when row-level security is bypassed" also holds in the shape where RLS is bypassed, which is how dev and CI run.
  - **No write tool.** Test "the tool list (4.2, 4.9)" asserts the exact set of four tool names, no forbidden substrings, no `WebSearch` spec, and no `temperature`/`top_p`/`top_k`/`budget_tokens`/`tool_choice`/`thinking` on the wire. It runs for each of Haiku, Sonnet and Opus.
  - **Day-14.** Test "the day-14 question (4.3)" cites the `recent.t` point dated 2026-11-14. Its ids are disjoint from the earlier rows result.
  - **Live check.** `evidence/live-check.md` records 3 Haiku questions, the response model on every hop, and about $0.0012. I recomputed Q1 from the usage table at the `InsightPriceTable` haiku-5-5 rates and got about $0.00050, which matches. The fixture ids in `live/ids.txt` match the deletion list. I did not repeat the call (owner budget).
- Driver decisions honored: pin does not render, there is no per-ask `model` field, `policy.specFor(policy.serverDefault)` is used, and the response has no model, usage or cost keys.
- Tasks 1.1 through 4.11 are all marked done and match the code.
- No scope creep. The only L3 change is the defaulted `firstCitation` parameter, and `InsightContextBuilderSpec` 4.8 proves the default is byte-identical.
- Constraints C1 to C15 are honored as far as I can observe. Scratch stays under `.concertino/scratch/HEL-1745/` (gitignored), and the live check was Haiku only and under the cap.

**Executor claims I verified:**
- **Access check.** `AskAccess.gate` calls `AccessCheckerImpl.requireAccess("dashboard", id, Some(user))`. When `userOpt` is `Some`, that function admits only the owner (`ownerResolver`) or a `findGrant(type, id, user.id)` row, and `findGrant` filters `grantee_id = <uuid>`. A public grant is stored with `grantee_id IS NULL` (`hasPublicViewerGrant` filters `granteeId.isEmpty`), so it can never match. `hasPublicViewerGrant` is reached only on the `None` branch, which this route never takes because it is on the authenticated tree. No share token is read. This is equivalent to design D2's "owner or findGrant".
- **Gate ahead of the 503.** `AskRoutes.askRoute` runs `access.gate` before `serviceOpt.fold(unavailable)`. Two rows were added to `ExistenceNotLeakedRoutesSpec`, and that spec passes in my run with no model client configured.
- **System prompt line.** The `rank` line is in `AskPrompts.system`. The timeline is consistent: `q1.out` is 00:24:42, the prompt edit is 00:24:55, and `q2.out` is 00:25:22. These are mtimes and not self-authenticating. The content claim does not depend on them: Q1's answer in the evidence talks about the rank column, and Q2 and Q3 do not.
- **Recorded mutations.** M1 to M7 are in `mut-M*.txt`, and each one has a red summary. M3 (payload grant re-check) and M7 (Output gate via RLS-reliant `findById`) go red only in the specs that bypass RLS, as claimed. Those specs are part of the suite, so the guards are covered in the dev and CI shape. The executor's `bak/` restore copies are identical to the committed source, and the tree is clean.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates I ran myself in `WORKTREE_PATH` at HEAD b2368ece3, using `nice -n 19 sbt -J-Xmx3g`:**
- `testOnly` on the five affected specs (AskDataServiceSpec, AskCitationLedgerSpec, AskRoutesSpec, InsightContextBuilderSpec, ExistenceNotLeakedRoutesSpec): 5 suites, 110 tests succeeded, 0 failed, guard `failed=0 aborted=0`.
- `sbt testFull`: 725 suites, 9883 tests succeeded, 0 failed, 5 canceled (pre-existing), 0 aborted, guard `failed=0 aborted=0 unreadable=0`, "All tests passed."
- `node scripts/check-scala-quality.mjs`: clean. The only soft warnings are file size: `AskApiHarness.scala` at 255 lines and `AskDataServiceSpec.scala` at 328 lines.
- `node scripts/check-schema-drift.mjs`: in sync. The new `schemas/ask/*` match `AskProtocol`.

**Mutations I wrote myself** (`.concertino/scratch/HEL-1745/eval-mutate.py`; source restored with `git checkout` after each run; tree clean afterwards):
- **E1, scope membership re-check.** In `AskToolExecutor.withOutput`, any model-supplied id is treated as in scope. **Red, 3 failing tests:** the off-board viewer test, the panel-removed-between-hops test, and the Output-scope "refuse any other id" test.
- **E2, per-call access re-check.** `AskAccess.resolve` skips `gate`. **Red:** the "dashboard grant revoked between hops" test fails.
- **E3, ledger lock.** `synchronized` removed from `AskCitationLedger.packAndRecord`. **Red:** "hand out disjoint, contiguous ids" fails with 14112 vs 16158.

**Checklist:**
- Code quality: imports are at the top of every file, there are no inline FQNs, and all `findByIdInternal` uses are documented as post-gate. Every file is under the 250-line soft budget except the test files noted above.
- DRY: the code reuses `PublicPanelRowsResolver`, `OutputReadAccess`, `InsightInputAdapters.fromResolution`, `InsightValidator`, `ChatAccessService` and `TierErrorCompletion`.
- Type safety and security: model-supplied ids are checked against a freshly resolved set on every call. The error text is identical whether or not an id exists. The question is sanitized, and the system prompt treats tool text as data.
- Error handling: `Failed` maps to 413/502, ungrounded maps to 422 with no answer text, and the answer is never logged.
- Tests are meaningful: every guard I mutated goes red.
- No dead code and no over-engineering.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes`-for-UI, `schemas/**`-driven UI or `openspec/specs/**` change has a UI surface here. `schemas/ask/*` matches the trigger list, but it is a new backend contract with no UI consumer yet (HEL-1744 is the frontend leaf). The orchestrator said this is backend only, with no UI.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- **Fallback timestamp for head citations.** `AskReads.capturedAt` (`AskReads.scala`, `getOrElse(Instant.now())`) uses the current time as the citation `capturedAt` for an Output with no history point. That presents "now" as the data-capture time. Consider leaving `capturedAt` unset in that case, or using the node snapshot's own timestamp.
- **History drifts from design D5.** `get_output_history` loads the Output with `findByIdInternal` after the scope check, not with `resolvePanelOutput` on the first binding panel as D5 says. It is equally safe, because membership is required by a binding panel, but the design text and the code now differ. Consider aligning `design.md` at archive time.
- **String ids in services.** `AskScope`, `AskAccess` and `AskReads` take raw `String` ids, against the CONTRIBUTING "value-class IDs only" rule for services. This follows the precedent of the reused `PublicPanel*Resolver` (also `String`), and the executor necessarily receives model-supplied strings. Wrapping the route-derived ids (`DashboardId`/`OutputId`) in `AskScope` would still be closer to the standard.
- **Share-token test.** The share-token case in `AskRoutesSpec` uses a bogus `?token=abc`. The code never reads a token, so this is sufficient. A real share token row would make the 404 test stronger.
- **Fixture deletion not independently checked.** The live-check deletions were not re-checked against the dev DB, because C1 forbids reading the `.env` that holds the DB URL. The evidence records a 204 for each delete and a 404 on the follow-up read.
