# Red evidence (C3): every red-first spec failing on the PRE-FIX production code

HEAD at the time: the split commit only (production behaviour identical to origin/main 968835477). The specs under
test were written first; no production code beyond the behaviour-preserving split existed. Embedded Postgres only
(C2); `nice -n 19`, default local caps.

Legend: RED = fails before the fix, proves the defect; GUARD = green before and after (pins behaviour the fix must not change).
SQLSTATE 40P01 = Postgres deadlock_detected.

## 1. Lock-order races W1-W8 and the HEL-1526 race (SQLSTATE 40P01 / lost layout item)

Command (from backend/):
`nice -n 19 sbt -J-Xmx3g 'testOnly *DashboardDeleteRacesPanelDeleteSpec *PanelWriterLockOrderRaceSpec *PipelineCascadeLockOrderRaceSpec *ReplaceContentsLayoutRaceSpec'`
exit code: 1 (Tests: succeeded 2, failed 10). The two succeeded are the HEL-1485 GUARD cases in
`DashboardDeleteRacesPanelDeleteSpec` (already correct; now asserting `(None, None)`). W2 failed first in this run on a
harness defect (panel appearance `'{}'` could not decode); fixed in the fixture, and re-run below (section 1b).

```
PipelineCascadeLockOrderRaceSpec:
- should complete on both sides with no 40P01 (W4 PipelineRepository.delete) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PipelineCascadeLockOrderRaceSpec.scala:71)
- should complete on both sides with no 40P01 (W5 PipelineStepRepository.deleteInternal) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PipelineCascadeLockOrderRaceSpec.scala:78)
- should complete on both sides with no 40P01 (W6 root removal) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PipelineCascadeLockOrderRaceSpec.scala:86)
- should complete on both sides with no 40P01 (W7 DataSourceRepository.delete) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PipelineCascadeLockOrderRaceSpec.scala:93)
- should complete on both sides with no 40P01 (W8 WorkspaceTeardownRepository.teardown, untagged grantee dashboard) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PipelineCascadeLockOrderRaceSpec.scala:100)
ReplaceContentsLayoutRaceSpec:
- should leave every panel with a layout item in every breakpoint and fail on neither side *** FAILED ***
  breakpoint lg: Set() was not equal to Set("e96c68e9-fc24-4d25-98d8-1e41bb106623") (ReplaceContentsLayoutRaceSpec.scala:104)
- should return the layout version that is stored *** FAILED ***
  Some(0) was not equal to Some(1) (ReplaceContentsLayoutRaceSpec.scala:119)
DashboardDeleteRacesPanelDeleteSpec:
- should complete on both sides with no 40P01 (DashboardRepository.delete)
- should complete on both sides with no 40P01 (WorkspaceTeardownRepository.teardown)
PanelWriterLockOrderRaceSpec:
- should complete on both sides with no 40P01 (W1 DashboardRepository.replaceContents) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PanelWriterLockOrderRaceSpec.scala:55)
- should complete with no 40P01; a vanished panel is the only accepted failure (W2 PanelRepository.batchUpdate) *** FAILED ***
  java.lang.IllegalArgumentException: requirement failed: no session ever waited on a lock: the interleave did not form (writer: Some(Failure(spray.json.DeserializationException: Object is missing required member 'background')))
  at scala.Predef$.require(Predef.scala:337)
  at com.helio.infrastructure.persistence.panels.LockRaceSupport.awaitLockWait(LockRaceSupport.scala:53)
  at com.helio.infrastructure.persistence.panels.LockRaceSupport.awaitLockWait$(LockRaceSupport.scala:49)
  at com.helio.infrastructure.persistence.panels.PanelWriterLockOrderRaceSpec.awaitLockWait(PanelWriterLockOrderRaceSpec.scala:23)
  at com.helio.infrastructure.persistence.panels.LockRaceSupport.gateRace(LockRaceSupport.scala:122)
  at com.helio.infrastructure.persistence.panels.LockRaceSupport.gateRace$(LockRaceSupport.scala:113)
  at com.helio.infrastructure.persistence.panels.PanelWriterLockOrderRaceSpec.gateRace(PanelWriterLockOrderRaceSpec.scala:23)
  at com.helio.infrastructure.persistence.panels.PanelWriterLockOrderRaceSpec.$anonfun$new$4(PanelWriterLockOrderRaceSpec.scala:72)
  at org.scalatest.OutcomeOf.outcomeOf(OutcomeOf.scala:85)
  at org.scalatest.OutcomeOf.outcomeOf$(OutcomeOf.scala:83)
  ...
- should complete on both sides with no 40P01 (W3 OutputService.delete) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PanelWriterLockOrderRaceSpec.scala:86)
Tests: succeeded 2, failed 10, canceled 0, ignored 0, pending 0
*** 10 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.infrastructure.persistence.panels.ReplaceContentsLayoutRaceSpec
[error] 	com.helio.infrastructure.persistence.pipelines.PipelineCascadeLockOrderRaceSpec
[error] 	com.helio.infrastructure.persistence.panels.PanelWriterLockOrderRaceSpec
```

### 1b. W1-W3 re-run after the W2 fixture fix (`*PanelWriterLockOrderRaceSpec`, exit 1)

```
PanelWriterLockOrderRaceSpec:
- should complete on both sides with no 40P01 (W1 DashboardRepository.replaceContents) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PanelWriterLockOrderRaceSpec.scala:55)
- should complete with no 40P01; a vanished panel is the only accepted failure (W2 PanelRepository.batchUpdate) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PanelWriterLockOrderRaceSpec.scala:73)
- should complete on both sides with no 40P01 (W3 OutputService.delete) *** FAILED ***
  (None, Some("40P01")) was not equal to (None, None) (PanelWriterLockOrderRaceSpec.scala:86)
Tests: succeeded 0, failed 3, canceled 0, ignored 0, pending 0
*** 3 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.infrastructure.persistence.panels.PanelWriterLockOrderRaceSpec
```

Reading the lines: each `(None, Some("40P01"))` is (gate side, writer side): the writer under test was chosen as the
deadlock victim. The HEL-1526 cases are RED by assertion, not deadlock: `breakpoint lg: Set() was not equal to
Set(<created panel id>)` is the created panel that lost its layout item to replace's write-back, and
`Some(0) was not equal to Some(1)` is the pre-read `layoutVersion` returned while the stored one had been bumped.

## 2. Cumulative preview parity (`*PatchSetPreviewCumulativeSpec *PatchSetPreviewGhostLayoutSpec`, exit 1)

`nice -n 19 sbt -J-Xmx3g 'testOnly *PatchSetPreviewCumulativeSpec *PatchSetPreviewGhostLayoutSpec'`

```
PatchSetPreviewCumulativeSpec:
- should drop a deleted panel's layout items from a later dashboard rename, matching apply *** FAILED ***
  Vector("cf64c76a-88d9-4eac-bb38-da88cdc3b6b1", "0417336f-4a83-4dfb-96e4-36eb12585815") was not equal to Vector("0417336f-4a83-4dfb-96e4-36eb12585815") (PatchSetPreviewCumulativeSpec.scala:75)
- should include a created panel's placement in a later dashboard appearance update, matching apply *** FAILED ***
  Set("91af2e9d-995c-4639-8877-fdaf443cbf66", "496c7c57-aee5-4eeb-907f-ec282b8c1b75") contained element "91af2e9d-995c-4639-8877-fdaf443cbf66", and Set("91af2e9d-995c-4639-8877-fdaf443cbf66", "496c7c57-aee5-4eeb-907f-ec282b8c1b75") contained element "496c7c57-aee5-4eeb-907f-ec282b8c1b75", but Set("91af2e9d-995c-4639-8877-fdaf443cbf66", "496c7c57-aee5-4eeb-907f-ec282b8c1b75") had size 2 instead of expected size 3 (PatchSetPreviewCumulativeSpec.scala:84)
- should show an earlier update of the same panel in a later one, matching apply *** FAILED ***
  "p" was not equal to "first" (PatchSetPreviewCumulativeSpec.scala:93)
- should reject an update of a panel an earlier edit deleted, as apply does *** FAILED ***
  200 OK was not equal to 404 Not Found (PatchSetPreviewCumulativeSpec.scala:101)
- should reject a layout update whose expectedLayoutVersion an earlier edit already moved past, as apply does *** FAILED ***
  200 OK was not equal to 409 Conflict (PatchSetPreviewCumulativeSpec.scala:113)
- should return the pre-apply fingerprint for both edits of one target and apply the set without a stale refusal
- should report the pre-apply state as `before` on every edit, equal to apply's priorState
- should leave a set of edits on unrelated targets exactly as apply produces them
PatchSetPreviewGhostLayoutSpec:
- should drop a stored ghost on an appearance-only update, matching apply
- should drop a supplied breakpoint item naming a non-live panel, matching apply
- should not reject a layout that overlaps only a ghost, as apply does not
- should GUARD: still reject a layout that overlaps two live panels
- should GUARD: leave the layout unfiltered on a rename-only update, as apply's rename-only write does
Tests: succeeded 8, failed 5, canceled 0, ignored 0, pending 0
*** 5 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.api.routes.patchsets.PatchSetPreviewCumulativeSpec
```

The five `PROOF:` cases fail; the three `GUARD:` cases (fingerprints, `before`, unrelated targets) and the
existing ghost-layout cases are green.
