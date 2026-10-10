## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: f5d1c61ce12dd2022d075d57aaaffacdba2298a8. Base (resolved live): 6d298d5f83a56041188fb619bb0fd4ad333bb9ca.
Backend-only change: no file under `frontend/`, `schemas/`, `openspec/specs/` or `ApiRoutes.scala`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (four gaps, red then green): new `PipelineServiceCoverageGapsSpec` (G1 service, G2 unknown and foreign, G4 None branch and Some branch), `PipelineAclSpec` (G1 route), `PipelineAnalyzeProposalRoutesSpec` (G3). The evidence logs `mut-g1..g4b` each show `[hel1468-guard] failed=N` with only the guarding tests failing. Each `*.mutation.txt` is a one-line status swap on exactly the guarded arm. For G4 I checked that `PipelineStepWrites.scala:64` and `:129` are the update-returned-`None` arms and not the step-not-found or foreign arms (`:33`, `:39`).
  - **Independent reproduction (G4b):** I mutated `PipelineStepWrites.scala:129` from `NotFound(` to `Conflict(` and ran `nice -n 19 sbt -batch -J-Xmx3g "testOnly ...PipelineServiceCoverageGapsSpec"`. Result: `[hel1468-guard] failed=1`. Only "return NotFound on the config branch" failed, with `Left(Conflict(...)) was not equal to Left(NotFound(...)) (PipelineServiceCoverageGapsSpec.scala:140)`. I then restored the file from a byte copy, and `git status --short` printed nothing.
  - **Green re-run, unmutated:** suites CoverageGaps + ExistenceNotLeakedRoutes + PipelineAcl + PipelineAnalyzeProposalRoutes + PipelineCreateTransactional. Result: `[hel1468-guard] failed=0 aborted=0 unreadable=0`, `Tests: succeeded 133, failed 0`.
- AC2 (citations): all ticket-listed sites are corrected to symbol + file. I spot-verified the targets:
  - The `classifyDbError` comment now names the two local `PipelineCycleRejected` catches. These are `PipelineCreateTransaction.createTransactional` (catch at :87) and `PipelineRootWrites.addRoot` (catch at :131), confirmed by grep of the enclosing defs.
  - `PatchSetApplyResolvers.scala` changed at :178 only.
- AC3 (existence rows): the `ExistenceNotLeakedRoutesSpec` diff is exactly four lines, and in each only `sites` changed: three step rows now point to `PipelineStepWrites.scala`, and analyze points to `PipelineAnalyzeReads.scala`. The PatchSetApplyResolvers rows, `patchKindExemptions` and `expectedForbiddenProducers` (`"PipelineService.scala" -> 1`) are untouched. The `GET/PATCH/DELETE pipeline` rows correctly stay on `PipelineService.scala`, which still holds `findSummaryByIdShared`, `findByIdShared` and the single `Forbidden` producer.
  - The `row-analyze` mutation resolves the owner through `findByIdInternal` and queries as the owner. In the failure, the foreign probe gets `Outcome(200, ... costVerdict ...)` and the absent probe gets 404, so the probes genuinely differ. The three step-row mutations change only the foreign arm's message. Each row run fails only that row: 60 succeeded, 1 failed.
- AC4 (dead code): see C1 under Phase 2.
- AC5: the D5 keep decision is recorded in design.md D5 and in the tasks.md "Item 4 decision" section.
- AC6:
  - `full-testfull.log` shows exit 0, `[hel1468-guard] failed=0 aborted=0 unreadable=0`, and 6662 succeeded. The log mtime is 14:15:34 and the commit time 14:16:13. The tree at log time is not content-proven to equal HEAD. Every suite that contains new or changed test code was re-run green by me at HEAD (above), and main code differs from base only in comments plus the two dead private members.
  - New spec uses `VerifiedEmbeddedPostgres.start`. No inline FQNs.
- Tasks: all marked done and they match the diff. No scope creep. The commit message has no claude.ai session link and no Claude-Session trailer.
- CONSTRAINTS C1–C6: all honored.
  - C1: see Phase 2.
  - C3 is verified above.
  - C4: no split.
  - C5: all logs use `-batch -J-Xmx3g` and show the guard. No `backend/project/target/active.json`, so no sbt server was left running.

### Phase 2: Code Review — PASS
Issues: none blocking.

- Gates (my own fresh runs):
  - `npm run check:scala-quality` reports "clean (231 soft warning(s))". All of these warnings are pre-existing file-size soft warnings. The new spec is 143 lines.
  - Targeted `sbt testOnly` is green as above.
  - I did not run a full `testFull`, per the lane-hygiene brief. I had no concrete reason to: there is no main-code behaviour change, and every touched test suite was re-run.
- C1 (main code): a mechanical filter over `git diff -U0 base...HEAD -- backend/src/main` kept every changed line that is not a comment line (`*`, `//`, `/**`). The only lines it left were:
  - `-  private val log = LoggerFactory.getLogger(getClass)`
  - `-  private def stepAddress(idx: Int): String   = PipelineService.stepAddress(idx)`
  - two blank lines

  No string literal was edited. The fenced `s"PipelineService.toAnalyzeStepResponse: ..."` runtime strings in `PipelineServiceSupport.scala:145/171/177` are intact. The `LoggerFactory` import is still needed because the companion object's `log` uses it (`PipelineService.scala:270`). The companion's `stepAddress` (still used by `PipelineCreatePreflight` and `PipelineServiceAddressFormatSpec`) is kept.
- javap: `diff` of `javap-base-*` against `javap-post-*` is empty for `PipelineService`, `PipelineService$` and `PipelineServiceSupport` (58, 38 and 33 lines). Both removed members were private, so this proof is necessarily weak, but it meets AC4 as written.
- citation-sweep.md is reproducible. Running the stated grep with `HEL1480-moved-members.txt` at HEAD returns exactly 86 hits, which matches the document.
  - I separately extracted every `PipelineService.<ident>` in `backend/src` and checked it against the defs and vals that `PipelineService.scala` still declares. Only five identifiers are not declared there:
    - `toAnalyzeStepResponse`: in the three fenced runtime strings.
    - `.scala`: file citations.
    - `AllowedOps`, `resolveInlineOrExistingRoot`, `resolveRootDataSources`: none of these exists at base either. They are older stale references, not members moved by HEL-1463, so they are outside D2's scope. See the suggestion below.
- Tests are meaningful:
  - G1 service asserts no pipeline row is written.
  - G2 covers foreign vs owner (owner `isRight`).
  - G4 uses a real `PipelineService` wired to a test-local repo subclass. design.md Risks records its limitation (it proves the handling of `None`, not that a real race produces one).

### Phase 3: UI Review — N/A
No UI-affecting files changed.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala:60` cites `PipelineService.resolveInlineOrExistingRoot`, which has not existed since before HEL-1463. `PipelineStepRoutesSpec.scala:972` cites `PipelineService.AllowedOps`, though that one reads as historical. A later comment sweep could fix them. They are out of D2's moved-member scope, so they are not a change request here.
- `PipelineService.scala:314`: the repointed comment line is about 150 columns, much longer than the surrounding wrapped block. Re-wrapping it would match the file. This is cosmetic, and scala-quality passes.
- `PipelineCreateTransactionalSpec.scala:170`: the same over-long-line remark applies.
