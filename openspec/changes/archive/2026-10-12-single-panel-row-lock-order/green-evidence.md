# Green evidence: the same specs, after the fix

Migration: `V129__lock_panels_for_deletion.sql` (C4: `git fetch origin` showed origin/main at V128 -- HEL-1434 merged
it after planning -- so this is exactly max+1 = V129; re-checked again immediately before the final commit). V1-V128
untouched. Embedded Postgres only (C2); `nice -n 19`, default local caps.

## Edits between the red and the green run of the same specs (so the recorded red is not mistaken for a moved goalpost)

- HEL-1526 specs: `replaceContents`'s signature became `layout: DashboardLayout` (design D3), so the one call in
  `ReplaceContentsLayoutRaceSpec.replace` changed `Some(layout)` -> `layout` and the one in
  `PanelWriterLockOrderRaceSpec` (W1) changed `Some(DashboardLayout.Default)` -> `DashboardLayout.Default`. Nothing else.
- Gate (`LOCK TABLE panels IN SHARE MODE`) is a test-harness device only (C5): no production change beyond design D3.
- `PatchSetPreviewCumulativeSpec`: created-panel ids are rewritten to the `(pending:<i>)` placeholder before comparing
  (design D4: parity specs normalize created ids); apply reports a mid-set failure as a 200 body with `failure` +
  `rolledBack` edits, so the two rejection cases assert preview's whole-call error AND apply's `failure`.
- Two cases added after the first green run were mutation-checked red by temporarily reverting the code they pin
  (impact count -> "Cascades to 2 panel(s)" vs expected 3; dashboard-delete removal -> preview 200 vs expected 404).

## 1. Races W1-W8 + HEL-1526 (`*DashboardDeleteRacesPanelDeleteSpec *PanelWriterLockOrderRaceSpec *PipelineCascadeLockOrderRaceSpec *ReplaceContentsLayoutRaceSpec`, exit 0)

```
DashboardDeleteRacesPanelDeleteSpec:
- should complete on both sides with no 40P01 (DashboardRepository.delete)
- should complete on both sides with no 40P01 (WorkspaceTeardownRepository.teardown)
PanelWriterLockOrderRaceSpec:
- should complete on both sides with no 40P01 (W1 DashboardRepository.replaceContents)
- should complete with no 40P01; a vanished panel is the only accepted failure (W2 PanelRepository.batchUpdate)
- should complete on both sides with no 40P01 (W3 OutputService.delete)
ReplaceContentsLayoutRaceSpec:
- should leave every panel with a layout item in every breakpoint and fail on neither side
- should return the layout version that is stored
PipelineCascadeLockOrderRaceSpec:
- should complete on both sides with no 40P01 (W4 PipelineRepository.delete)
- should complete on both sides with no 40P01 (W5 PipelineStepRepository.deleteInternal)
- should complete on both sides with no 40P01 (W6 root removal)
- should complete on both sides with no 40P01 (W7 DataSourceRepository.delete)
- should complete on both sides with no 40P01 (W8 WorkspaceTeardownRepository.teardown, untagged grantee dashboard)
Tests: succeeded 12, failed 0, canceled 0, ignored 0, pending 0
[success] elapsed time: 11 s, cache 81%, 27 disk cache hits, 6 onsite tasks
```

W2 note (so it is not read as a broken AC2): W2's id-ordered `FOR UPDATE` waits on the gate's lock on the lowest
panel, then skips the rows the gate deleted and committed (READ COMMITTED recheck); the item loop then finds neither
panel and `batchUpdate` raises exactly `NoSuchElementException("Panel '<id>' not found")`. That is the correct
post-fix outcome (the panels are gone), not a failure: the spec asserts gate side `None` and writer side either
success or exactly that exception; a 40P01 (or any other error) on either side still fails it. AC2 itself is met
literally by W1 and W3-W8, each `(None, None)`.

## 2. Cumulative preview (`*PatchSetPreviewCumulativeSpec`, exit 0)

```
PatchSetPreviewCumulativeSpec:
- should drop a deleted panel's layout items from a later dashboard rename, matching apply
- should include a created panel's placement in a later dashboard appearance update, matching apply
- should show an earlier update of the same panel in a later one, matching apply
- should reject an update of a panel an earlier edit deleted, as apply fails
- should reject a layout update whose expectedLayoutVersion an earlier edit already moved past, as apply fails
- should count the panels earlier edits of the set created and deleted on that dashboard
- should reject an update of a panel on a dashboard an earlier edit deleted
- should return the pre-apply fingerprint for both edits of one target and apply the set without a stale refusal
- should report the pre-apply state as `before` on every edit, equal to apply's priorState
- should leave a set of edits on unrelated targets exactly as apply produces them
Tests: succeeded 10, failed 0, canceled 0, ignored 0, pending 0
[success] elapsed time: 5 s, cache 90%, 27 disk cache hits, 3 onsite tasks
```

## 3. Full backend suite (`nice -n 19 sbt -J-Xmx3g testFull`, exit 0)

```
[info] Tests: succeeded 7630, failed 0, canceled 4, ignored 0, pending 0
[success] elapsed time: 720 s (0:12:00.0), cache 94%, 575 disk cache hits, 34 onsite tasks
```

(The 4 canceled tests are the pre-existing `HELIO_MEASURE=1`-gated measurement cases, identical in the earlier run before the fixture
fixes: Tests: succeeded 7614, failed 16, canceled 4 -> failed 0 after granting EXECUTE in 6 non-production fixtures
and stubbing the function in the V93-pinned `ResourceTagMigrationSpec`.)
