# Mutation runs (HEL-1433, D4 and task 3.6)

V119 file: `backend/src/main/resources/db/migration/V119__data_sources_image_uploads_owner_fk.sql`, base sha256
`574aff75bf071eabd4c2aacdcb2bbc02920de2ac26a41221083b21d6b359e54f`. Each mutation edits exactly one clause in the worktree,
runs `V119OwnerFkCleanupSpec V119OwnerFkGuardSpec V119OwnerFkMigrationSpec` (17 tests, embedded Postgres only, no servers),
then `git checkout --` the file. After each: `git diff --exit-code` rc=0 and the sha256 above.

| # | Mutation | Result | Red test |
|---|---|---|---|
| 1 | remove `'join'` from the op IN list | 16 passed, 1 failed | `abort ... when an orphan is a join step's secondaryInput source` |
| 2 | remove `'lookup'` | 16 passed, 1 failed | `abort ... lookup step's secondaryInput source` |
| 3 | remove `'union'` | 16 passed, 1 failed | `abort ... union step's secondaryInput source` |
| 4 | remove `'upsertsource'` | 16 passed, 1 failed | `abort ... upsertsource step's existing-source target` |
| 5 | drop `root_refs` from the sum | 16 passed, 1 failed | `abort ... one of TWO roots of a pipeline ...` |
| 6 | drop `panel_refs` from the sum | 16 passed, 1 failed | `abort ... form panel's source ...` |

Every mutation turned exactly its targeted test red and no other. Restore proof for all six:
`git diff --exit-code -- <V119>` rc=0 and sha256sum `574aff75...e54f` (equal to base).

## Task 3.6: eager-conversion mutation

`DataSourceRepository.insertRowAction` changed from `DBIO.successful(()).flatMap { _ => ... domainToRow(source) ... }` to
an eager `domainToRow(source)` outside the DBIO. `DataSourceRepositoryEmptyOwnerSpec`: 1 passed, 2 failed (`insert` and
`insertDatasetSource` empty-owner tests red; the valid-owner test stays green). Restored by copying the head file back;
sha256 of `DataSourceRepository.scala` before and after: `281d5f3df817eba77ced7b5640b5f54aaedeb161383ae9ffa0d95c1ea49fe0c9`.
(The tests capture the Future inside `noException should be thrownBy`, so a synchronous throw fails them directly.)

## Also: PipelineCycleGuard

Flipping `ownerId.toString == actingUserId` to `!=` in `resolveDisplayNamesAction` turned
`should reject a write that closes a cycle within the editor's OWN visible graph, naming a non-owned source by id` red
(293 passed, 1 failed); restored (`git diff` shows only the intended edit).
