## ADDED Requirements

### Requirement: A failed folder removal does not block the registry cleanup

Once the user-delete transaction has committed, a failure while removing any deleted user's conversation folder
(including a failure resolving the uploads root) SHALL NOT prevent the remaining folders from being attempted, and
SHALL NOT prevent the run's registry from being cleared. The teardown SHALL then fail loudly, reporting the failure only
as a count of folders not removed, never a path or id. Every other caller of the throwaway-user delete SHALL treat a
non-zero failed count as a failure, reported as a count. A delete that did not commit SHALL still leave the registry in
place.

#### Scenario: Folder removal fails after the delete committed

- **WHEN** the delete commits and removing one recorded user's folder throws
- **THEN** the other users' folders are still removed, the run's registry directory is gone, and the teardown fails
  with a message carrying only the failed count

#### Scenario: The next teardown accepts the left state

- **WHEN** teardown runs again after a folder-removal failure cleared the registry
- **THEN** it deletes nothing and does not fail the exact-match check

#### Scenario: A failed delete still keeps the registry

- **WHEN** the delete transaction aborts
- **THEN** no folder is removed and the registry directory is left in place
