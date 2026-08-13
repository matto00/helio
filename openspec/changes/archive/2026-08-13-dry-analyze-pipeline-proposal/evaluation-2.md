## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS

Issues: none.

Re-verified all Phase 1 findings from evaluation-1.md still hold (resumed cycle — planning artifacts
unchanged except tasks.md/files-modified.md, which were updated to document the fix; ticket/proposal/
design/spec not re-read per resumability). The one prior gap is closed:

- **AC #3 ("Per-step validation errors are surfaced in the response body (not thrown)")** — now fully
  satisfied. Commit `c79aab46` adds `PipelineService.validateStepKinds`
  (`backend/src/main/scala/com/helio/services/PipelineService.scala`, new private method after
  `analyzeProposal`), called as the *first* step inside `analyzeProposal` — before
  `resolveProposalSourceSchema` and before any `stepInputs` are built. It mirrors the existing
  `addStep` guard (`PipelineStepKind.All.contains`) and short-circuits with
  `Future.successful(Left(ServiceError.BadRequest(...)))` for the first step whose `type` isn't a
  registered `PipelineStepKind` — so an unrecognized type never reaches
  `PipelineAnalyzeService.analyze`/`toAnalyzeStepResponse` at all. tasks.md 3.14 and files-modified.md
  were both updated to record the fix, correctly citing evaluation-1.md CR1.
- New regression test ("reject a proposal step whose type is not a registered PipelineStepKind with
  400, never a 500 (evaluation-1.md CR1)", `PipelineAnalyzeProposalRoutesSpec.scala:313-330`) posts a
  proposal with a valid inline `static` source and one step of `type = "not-a-real-step-kind"`,
  asserting `400` and that the error message names the offending type — exercising exactly the gap
  identified in cycle 1.
- All other ACs, and design.md D2's precedence/config-absent guards, remain correctly implemented and
  unaffected by this diff (`resolveProposalSourceSchema`/`resolveInlineSourceSchema` are unchanged).

### Phase 2: Code Review — PASS

Gates (fresh run, this worktree, `WORKTREE_PATH` — `EVALUATOR_CLEAN_WORKTREE` not set):

- `cd backend && sbt test` → **all 2488 tests passed** (146 suites, 0 failed) — one more than cycle 1's
  2487, the new regression test. Also re-ran the suite in isolation
  (`sbt "testOnly com.helio.api.routes.PipelineAnalyzeProposalRoutesSpec"`) → 12/12 green (11 from
  cycle 1 + 1 new).
- `node scripts/check-scala-quality.mjs` → clean; no new inline-FQN violations. `PipelineService.scala`
  is now 712 lines (was 679 in cycle 1) — the file-size soft warning is unchanged in kind (informational
  only per CONTRIBUTING.md), just a larger number; not a new class of issue.
- `node scripts/check-schema-drift.mjs` → schemas still in sync with `JsonProtocols` (38 checked); this
  cycle touched no schema files.

**Verified the fix actually closes the reported gap** by reading `validateStepKinds` and its call site
directly: it runs unconditionally before `resolveProposalSourceSchema`, uses `steps.find(s =>
!PipelineStepKind.All.contains(s.\`type\`))` (an exhaustive check across every step, not just the
first-encountered during folding), and on `Some(bad)` returns a `BadRequest` naming the invalid type —
so `toAnalyzeStepResponse`'s `PipelineStepConfigCodec.decode` re-decode path (the code that previously
threw an uncaught `IllegalStateException`) is now provably unreachable for an unregistered step kind:
the whole method returns before `stepInputs` is even constructed.

**Checked for anything new introduced by the fix:**

- **Validation ordering change** (not a regression against any AC/spec): step-kind validation now runs
  *before* source resolution, so a proposal with both an invalid step type and an inaccessible
  `sourceId` now returns `400` (step) rather than `404` (source), a flip from cycle 1's ordering. No
  AC, spec scenario, or test specifies precedence between these two independent failure modes, and the
  new ordering is arguably preferable (a cheap, pure check short-circuits before any RLS lookup or
  live SQL/REST inference call). Not a blocking issue.
- No new inline FQNs, no new nullable/unguarded access, no new collaborators introduced — the fix is
  self-contained to one new private method plus a call-site wrap of the existing method body in a
  `match`.
- Error message reflects the caller-supplied invalid `type` string back in the `400` body, identical
  to the existing `addStep` precedent (`PipelineService.scala:401-404`) — no new injection surface (JSON
  API, not HTML-rendered).
- Doc comment on `analyzeProposal` was expanded to explain the guard's rationale in place — accurate
  and consistent with the actual code below it.

No new issues found.

### Phase 3: UI Review — N/A

Unchanged from cycle 1: this ticket is backend-only. `git diff 22519d20..c79aab46 --stat` confirms this
cycle's fix touches only `PipelineService.scala`, the test spec, and openspec planning artifacts — no
`frontend/**`, no `ApiRoutes.scala`, no `schemas/**`.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `PipelineService.scala` is now 712 lines (was 542 on `main`, 679 after cycle 1). Still worth a
  one-line acknowledgment in the PR description per CONTRIBUTING.md's "propose a split" convention for
  files crossing ~400 lines, though design.md D1 already reasons explicitly about keeping
  `analyzeProposal`'s logic on `PipelineService` rather than splitting to a new service class — not
  blocking.
