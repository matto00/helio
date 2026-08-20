## MODIFIED Requirements

### Requirement: Undo SHALL atomically restore every journaled edit's pre-apply state
`POST /api/patch-sets/:id/undo` SHALL restore every edit in the named application to its pre-apply
state via the same per-resource services the apply path uses, or restore none of them, for every
condition detectable before any restore begins (a conflict, or a structurally-unrecoverable delete
edit) — see the separate requirement below for the narrower guarantee that applies only to a genuine,
undetectable-in-advance restore failure.

#### Scenario: Undo restores every touched resource to its pre-apply state
- **WHEN** `POST /api/patch-sets/:id/undo` is called with a valid, owned, unconflicted
  `applicationId`
- **THEN** every resource the original application touched is restored to the value it had
  immediately before that application ran

#### Scenario: An unowned or nonexistent applicationId is rejected
- **WHEN** `POST /api/patch-sets/:id/undo` is called with an id that does not exist, or is not owned
  by the caller
- **THEN** the call is rejected (not found) and no resource is modified

#### Scenario: Restoring a pipeline step preserves its captured enabled/disabled state
- **WHEN** `POST /api/patch-sets/:id/undo` restores a `pipelineStep` edit — whether by recreating a
  deleted step or by fully reverting an updated one — and the captured pre-apply state had that step
  `enabled: false`
- **THEN** the restored step is `enabled: false`, never silently reset to `enabled: true`
- **AND** a captured pre-apply state with no `enabled` field recorded (a legacy record predating the
  field's introduction) restores as `enabled: true`
