## ADDED Requirements

### Requirement: The backend compile-cache key is cheap to compute
The backend compile-output cache key SHALL be derived from the committed content of the backend sources and build
definition without walking the workspace file tree at key-evaluation time, so the restore step cannot fail because
computing its key timed out. The key SHALL still change whenever any tracked file under `backend/src`, `backend/build.sbt`
or the tracked build definition under `backend/project` changes, and SHALL keep the `backend-compile-v3-<os>-` prefix so a
run with no exact match still restores the newest main entry.

#### Scenario: a backend source changes
- **WHEN** a commit changes any tracked file under `backend/src`
- **THEN** the computed compile-cache key differs from the parent commit's key

#### Scenario: nothing backend-relevant changes
- **WHEN** a commit changes only files outside `backend/src`, `backend/build.sbt` and `backend/project`
- **THEN** the computed compile-cache key equals the parent commit's key

#### Scenario: key evaluation under load
- **WHEN** the backend job reaches the compile-cache restore step
- **THEN** the step does not evaluate a workspace glob for its key, and its duration in real CI runs is reported
  before and after the change
