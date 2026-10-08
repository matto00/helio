# Test-count and guard evidence (HEL-1253, design D7b/D7c)

Baseline: unmodified tree at 24f6de4cf, `cd backend && nice -n 19 sbt testFull` (exit 0). After: this change, same command (exit 0).

```
--- BASELINE
[info] Total number of tests run: 6180
[info] Suites: completed 443, aborted 0
[info] Tests: succeeded 6180, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
EXIT=0
--- AFTER
[info] Total number of tests run: 6180
[info] Suites: completed 443, aborted 0
[info] Tests: succeeded 6180, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
EXIT=0
```

Per-suite counts (test lines under each suite header in the sbt log; `counts.py` in scratchpad), every *Panel*Spec plus ExistenceNotLeakedRoutesSpec; `diff` of before/after is empty:

```
DashboardPanelAclSpec: 41
ExistenceNotLeakedRoutesSpec: 61
FormPanelRoundTripSpec: 22
FormPanelSpec: 30
OutputPanelSpec: 14
PanelAppearanceMergeSpec: 13
PanelBatchCreateSpec: 10
PanelCapabilityServiceSpec: 5
PanelControlsValidationSpec: 45
PanelCreatePlacementSpec: 20
PanelCreateSeamSpec: 5
PanelPackerSpec: 13
PanelRowMapperSpec: 11
PanelServiceBatchUpdateErrorSpec: 1
PanelServiceBuildAllForCreateSpec: 5
PanelServiceDefaultLayoutSpec: 10
PanelServiceOutputBindingSpec: 7
PanelServiceOutputControlsSpec: 5
PanelSpec: 36
PanelTypeSpec: 15
PatchSetUndoPanelDashboardSpec: 5
PipelineOnlyPanelBindingMigrationSpec: 5
WorkspaceContextServicePanelCountSpec: 3
ALL suites-with-tests: 443 counted test lines: 6184
```

Test diff: `git diff 24f6de4cf -- backend/src/test` is empty (0 lines).

## Guard scan (D7c), recomputed over every main .scala file (`guardscan.sh`, mirrors ExistenceNotLeakedRoutesSpec codeLines/filesCallingAccessHelpers/forbiddenProducerCounts)

```
--- before
== files calling shared access helpers (non-comment, non-def lines)
      1 com/helio/services/panels/AutoLayoutService.scala
      4 com/helio/services/panels/PanelService.scala
== Forbidden( producers per file (non-comment lines)
      1 com/helio/services/panels/AutoLayoutService.scala
      5 com/helio/services/panels/PanelService.scala
--- after
== files calling shared access helpers (non-comment, non-def lines)
      1 com/helio/services/panels/AutoLayoutService.scala
      4 com/helio/services/panels/PanelService.scala
== Forbidden( producers per file (non-comment lines)
      1 com/helio/services/panels/AutoLayoutService.scala
      5 com/helio/services/panels/PanelService.scala
```
Identical: PanelService.scala only (4 access-helper call lines, 5 Forbidden producers); no new module has either.

## Size and quality (D7d)

```
  320 backend/src/main/scala/com/helio/services/panels/PanelService.scala
  128 backend/src/main/scala/com/helio/services/panels/PanelBindingChecks.scala
  115 backend/src/main/scala/com/helio/services/panels/PanelCreateBuilder.scala
   96 backend/src/main/scala/com/helio/services/panels/PanelFormFileSubmission.scala
   69 backend/src/main/scala/com/helio/services/panels/PanelUpdateValidation.scala
  110 backend/src/main/scala/com/helio/services/panels/PanelBatchWrites.scala
   61 backend/src/main/scala/com/helio/services/panels/PanelLifecycleWrites.scala
   21 backend/src/main/scala/com/helio/services/panels/ResolvedPanelPatch.scala
  920 total
```
`node scripts/check-scala-quality.mjs`: exit 0, "clean (214 soft warning(s))" (baseline soft warnings: PanelService 709 lines -> 321 lines; no new-file warnings). Eye-check of every `s"...${...}"` in the new files: only simple identifiers/member access (`$label`, `${dashboardId.value}`, `${idx + 1}`, `${UUID.randomUUID().toString}`), no inline FQNs.

## D8 measured floor: PanelService.scala = 321 lines (> 300 spec figure, < 400 hard trigger)

Taken after the optional create/delete/duplicate tails moved (PanelLifecycleWrites). Remaining blocks, all guard- or signature-pinned:
- imports ~19; class scaladoc (CS4 ACL strategy, unchanged) 18; constructor + its HEL-nnnn wiring comments 30 (cannot move: the signature is public API); `require` + module wiring 16; `audit` 6.
- ACL preambles that must stay textually (D2/C1): submitForm 30 (incl. its Forbidden + doc), create 20, batchUpdate 40, batchCreate 27 + authorizeEditor 23, delete 12, duplicate 12, update 24, authorizeEditorOnDashboard 10.
- two `private[services]` delegates 16 (signature-pinned incl. `itemLabel` default); `findById` 7.
Reaching 300 would require moving ACL lines or the constructor comments; recorded as a follow-up candidate.
