# HEL-1479: Split PatchSetApplyResolvers.scala (~853 lines) behaviour-preserving

## Description

origin_kind: followup
origin_ticket: HEL-1463

`backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` is 853 lines on origin/main 1b765f59d. A HEL-1463 ticket comment suggested splitting it alongside PipelineService.scala. HEL-1463's planning kept it out of that PR for two reasons: it lives in a different package, and the combined move would have been about 3400 lines.

Split it to the same proof standard as HEL-1253/1371/1385/1463:

* byte-move check in both directions, with red runs;
* `javap -public` diff empty after declared synthetic-member normalisation;
* `sbt testFull` per-suite identical before/after;
* nine-style mutation red runs per new file.

**Design problem to solve first.** `ExistenceNotLeakedRoutesSpec` pins this exact file name in three ways:

* `expectedForbiddenProducers` has `"PatchSetApplyResolvers.scala" -> 4`;
* `patchSetDispatchPairs()` does `scalaFiles().find(_.getFileName.toString == "PatchSetApplyResolvers.scala").get` and scans its `case ("kind", "op")` dispatch lines;
* about 15 route rows name it as the access-helper site.

So either the dispatch, all four Forbidden producers and every `requireAccess(` call stay in this file, or the split needs owner-approved, mechanical test-pin edits. If it is the latter, the test-diff standard must say exactly which pins change and why.

## Acceptance Criteria

1. `PatchSetApplyResolvers.scala` is split into concern-focused files in `com.helio.services.patchsets`; behaviour is unchanged.
2. Byte-move check passes in both directions (forward, reverse, coverage), with recorded red runs.
3. `javap -public` diff of `PatchSetApplyResolvers` / `PatchSetApplyResolvers$` is empty after a normalisation filter declared before the run.
4. `sbt testFull` per-suite results identical before/after; `[hel1468-guard]` present in both runs.
5. One behaviour mutation per new collaborator, each red in an existing spec, then green.
6. `ExistenceNotLeakedRoutesSpec`'s three pins are resolved per the ticket's design problem, with the resolution stated and each guard shown still failable (red) after the split.
7. No inline FQNs; any real defect found becomes a follow-up ticket, not a fix.
