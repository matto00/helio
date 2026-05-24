## Context

`PipelineService.addStep` and `PipelineService.updateStep` accept any `rightDataSourceId` in a
JoinStep config without verifying the caller has access to that source. The repo layer's ACL guards
(`findByIdOwned`) are already in place on `DataSourceRepository`; this change wires them into the
step authoring path.

At runtime, `JoinStep.evaluate` (in-process engine) and `SparkJobSubmitter.applyStep` both use
`findByIdInternal` to resolve the right-side source. The runtime path is deliberately kept
privileged — the authoring-time check is the ACL gate, and switching runtime resolution to
owner-scoped would silently break evaluation for any step whose right-source was transferred or
whose pipeline is run by an administrative path in the future.

## Goals / Non-Goals

**Goals:**
- Reject JoinStep creation or update whose `rightDataSourceId` is not owned by the caller (→ 404).
- Keep `findByIdInternal` at both runtime sites (evaluation correctness and graceful degradation).
- Add two integration test cases covering the new guard.

**Non-Goals:**
- Sharing data sources across users for join composition (separate ticket).
- Changing runtime resolution or adding snapshot capture of the right-source ID.
- Modifying `AuthService` or any authentication path.
- Frontend changes.

## Decisions

### D1: Guard in PipelineService, not PipelineStepRepository

The repo layer is pure persistence; ACL policy belongs in the service. `PipelineService` already
owns the "pipeline must belong to caller" check (`pipelineRepo.exists`) before delegating to
`pipelineStepRepo.insert`. Adding the JoinStep right-source check here is consistent with that
pattern and avoids polluting the repo's constructor with cross-repo dependencies.

**Alternative rejected**: guard in a route directive. Routes are thin shells; service-layer guards
are more testable and reusable if we ever expose a non-HTTP entry point.

### D2: pre-flight + runtime internal (not snapshot)

The ticket offers two runtime models. We choose **pre-flight + runtime internal** because:
- Snapshot would require a schema change (new column or JSON field to capture the source state).
- The semantic we want is "was valid at authoring time" — `findByIdInternal` at runtime satisfies
  that without additional storage.
- If the source is deleted after authoring, `findByIdInternal` returns `None` and the engine fails
  with `"DataSource not found"` — this is the "clear error" path AC2 allows as an alternative to
  silent graceful degradation.

### D3: 404 (not 403) on right-source ACL failure

Consistent with all other HEL-265 ACL points: existence-not-leaked semantics. The caller cannot
distinguish "source doesn't exist" from "source exists but you don't own it".

### D4: Pass DataSourceRepository into PipelineService constructor

`PipelineService` does not currently hold a `DataSourceRepository` reference. Adding it as a
constructor param follows the existing dependency-injection style (no service locator, no global).
`ApiRoutes` already owns a `dataSourceRepo` singleton and will pass it through; the wiring is a
one-line change.

## Risks / Trade-offs

- [Risk] PipelineService constructor signature change breaks any test that instantiates it with
  two args → Mitigation: update `PipelineStepRoutesSpec` (and any other test harness) to pass
  `dataSourceRepo` as the third arg, or supply a mock/stub.
- [Risk] Runtime evaluation of an existing step that passed pre-flight can still fail if the
  source is later deleted → Mitigation: this is the documented "clear error" path; no behavioral
  regression from the current state (the engine already throws on `None`).

## Planner Notes

Self-approved: the change is purely additive (new validation guard + new constructor param + two
new tests). No API shape change, no migration, no new external dependencies. Scope is squarely
within the ticket's acceptance criteria. No escalation required.
