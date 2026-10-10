# HEL-1480: PipelineService split follow-ups: coverage gaps, stale line citations, dead stepAddress/log

## Description

origin_kind: followup
origin_ticket: HEL-1463

Items found while delivering HEL-1463 (PR matto00/helio#922). That change was behaviour-preserving with an empty test diff, so none of them were fixed there.

1. **Coverage gaps.** HEL-1463's mutation runs found these sites have no existing assertion. Add tests, red-first:
   * the service-level blank-name 400 on `create`;
   * the `laneTree` unknown-pipeline 404;
   * the analyze-proposal inline `static` source with no `config`;
   * `updateStep` when no row is returned after the update.
2. **Stale citations.** These comments cite old `PipelineService.scala` line numbers or a single site:
   * `PipelineCreateTransactionalSpec` (:95, :170 cites `:521`);
   * `PatchSetApplyResolvers.scala:178`, `PatchSetPreviewProjection.scala:286`, `PipelineStepRepository.scala:1092`;
   * `ExistenceNotLeakedRoutesSpec` rows 426-428 and 452-455, which still name only `PipelineService.scala` as the site although the access checks now run in the collaborators.
   The moved comments also keep positional words ("above"/"below") and `[[...]]` links that the move made stale.
3. **Dead code.** `PipelineServiceSupport.stepAddress` was already dead at base. The entry point's `log` in `PipelineService` is now unused.
4. **Over the ~250-line soft budget:** `PipelineProposalAnalyze` (359), `PipelineStepCreate` (327), `PipelineStepWrites` (291), `PipelineCreateTransaction` (283), `PipelineAnalyzeReads` (272). This is informational only.

## Acceptance Criteria

Derived from the ticket and the owner-approved driver brief:

1. Each of the four coverage gaps has a test that is shown RED against a mutation of the exact code it guards, then GREEN once reverted (evidence recorded). If a gap hides a real bug, a follow-up is filed instead of a silent fix.
2. Every stale citation listed in item 2 is corrected (symbol + file, no line numbers); stale positional words and `[[...]]` links in the nine collaborator files that the HEL-1463 move made wrong are corrected.
3. ExistenceNotLeakedRoutesSpec rows 426-428 and 452-455 name the file where the access check now runs; for each row repointed at a collaborator, a mutation of that collaborator's producer makes the row fail (evidence recorded). The PatchSetApplyResolvers rows are NOT touched (HEL-1479 owns them).
4. `PipelineServiceSupport.stepAddress` and `PipelineService`'s unused class-level `log` are removed; `javap -public` of `PipelineService`, `PipelineService$` and `PipelineServiceSupport` is unchanged.
5. Item 4 (soft budget) has a recorded decision: split (byte-move, HEL-1463 proof standard) or keep with a stated justification.
6. `sbt testFull` green with the `[hel1468-guard]` line present; no inline FQNs; new spec files use `VerifiedEmbeddedPostgres.start`.
