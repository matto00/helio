# HEL-1498: After HEL-1485: single panel-row lock order across all panel writers; teardown pre-lock misses untagged dashboards; split PatchSetPreviewProjection

## Description

Follow-ups from HEL-1485 (matto00/helio#943, 6ac99447d), which fixed a reproduced 40P01 deadlock between dashboard delete/teardown and panel delete by locking panel rows first (`DashboardRepository.lockPanelRows`, `ORDER BY id FOR UPDATE`), matching V122.

1. **Panel-to-panel lock order isn't single yet.** `replaceContents`, the output/pipeline/step FK cascades and `batchUpdate` lock panel rows in scan or request order. A dashboard delete racing one of them over two or more shared panels can still hit 40P01. Reproduce it first (as HEL-1485's `DashboardDeleteRacesPanelDeleteSpec` did), then make every panel writer lock in id order.
2. **Teardown's pipeline cascade also locks untagged dashboards** whose panels are bound to the tagged pipelines' outputs, and the HEL-1485 pre-lock doesn't cover them.
3. **Patch-set preview is still computed per edit,** so an earlier create or delete in the same patch set can make preview differ from apply. This applies to every field, not just layout.
4. `PatchSetPreviewProjection.scala` (now 403 lines) — split it, behaviour-preserving.
5. **Test tightening:** `DashboardDeleteRacesPanelDeleteSpec` should assert `(None, None)` and rethrow non-PSQL errors. Label the 2 preview guard cases as guards.

Never edit V122 or V123 (nor any applied migration). Any SQL change goes in the next free migration (V128 at planning time; re-check before claiming — another lane may take it).

## Folded-in scope: HEL-1526 (owner decision, escalation HEL-1498-1791863327533-e537a4: fold-in)

`DashboardContentsOps.replaceContents` reads the dashboard row without a lock or precondition and, when the request carries no `layout`, writes the layout it read back — a concurrent layout write committed between that read and the write-back is reverted.

## Acceptance Criteria

- AC1: Every transaction that locks two or more panel rows locks them in panel-id order before any other panel/dashboard row lock, so the single lock order is "panel rows by id, then dashboard rows by id". Covers at least `replaceContents`, `batchUpdate`, output delete, and the output/pipeline/step/root/source FK cascades reaching `panels`.
- AC2: A red-first concurrency spec reproduces 40P01 for a dashboard delete racing at least one multi-panel writer over two or more shared panels on the pre-fix code, and passes (both sides `None`, no error) after.
- AC3: Teardown's panel pre-lock also covers panels on untagged dashboards bound to the outputs of the tagged pipelines/sources, in the same single id-ordered lock.
- AC4: Patch-set preview projects edits cumulatively, so an earlier create/delete in the same patch set is reflected in later edits' preview exactly as apply would produce it; red-first preview-vs-apply parity specs.
- AC5: `PatchSetPreviewProjection.scala` is split into files each under the repo's size budget, behaviour-preserving (existing preview specs pass unchanged).
- AC6: `DashboardDeleteRacesPanelDeleteSpec` asserts `(None, None)` and rethrows non-PSQL errors; the 2 preview guard cases are labelled as guards.
- AC7 (HEL-1526): `replaceContents` never overwrites a layout it did not read; panel rows first, then the dashboard (HEL-1485 order). A red-first spec with a real concurrent transaction on `VerifiedEmbeddedPostgres` as a NOBYPASSRLS role shows a layout write committed mid-request survives.
- AC8: No applied migration (V1..V127) is edited.
