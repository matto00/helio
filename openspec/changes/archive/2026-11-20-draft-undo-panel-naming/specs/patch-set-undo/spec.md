## MODIFIED Requirements

### Requirement: Undo of a pipeline-definition save
`POST /api/patch-sets/:id/undo` SHALL dispatch a `pipelineDefinition` journal row to an atomic restore that re-applies
the journaled prior definition through the draft-save transaction against the post-save fingerprint, including trunk
order, recreating deleted steps and Outputs under their original ids.

When the restore would delete an Output the save created that now has bound panels or targeting alert rules, or when
the save's cascade removed a bound panel or targeting alert rule, undo SHALL refuse with a conflict error and write
nothing, regardless of which user owns the panel or rule. A refusal message SHALL NOT contain any panel id. It SHALL
name a blocking panel bound to a created Output only by panel title and dashboard name, and only when the undoing user
can read that panel and its dashboard; every other blocking panel SHALL be reported only as a count. A targeting alert
rule SHALL be named only when the undoing user owns it, else counted. Panels and alert rules the save's cascade removed
SHALL be reported only as counts. When both apply, one message SHALL report the removed counts and then the created-Output
blockers. A refusal raised inside the restore transaction SHALL report counts only.

#### Scenario: Undo restores order and deleted steps
- **WHEN** a save reordered steps and deleted an unbound step, and nothing changed since
- **THEN** undo restores the prior order and recreates the step under its original id in one transaction

#### Scenario: Later edit blocks undo
- **WHEN** the pipeline changed after the save
- **THEN** undo returns 409 `PATCH_SET_STALE` and writes nothing

#### Scenario: Cascade removed panels or alert rules
- **WHEN** the save's cascade removed a bound panel or a targeting alert rule
- **THEN** undo returns 409 reporting how many panels and alert rules were removed, with no panel or alert rule id, and
  writes nothing

#### Scenario: Another user's panel bound to an Output the save created
- **WHEN** user A saves a draft that creates an Output, user B (an editor on A's dashboard) duplicates a panel bound to
  that Output so that B owns the copy, and A undoes the save
- **THEN** undo returns 409 naming B's panel by title and dashboard name, the body contains no panel id, and the
  Output, B's panel and the pipeline definition are unchanged

#### Scenario: A blocking panel the undoing user cannot read is counted, not named
- **WHEN** a panel on a dashboard the undoing user cannot read is bound to an Output the save created, and the user
  undoes the save
- **THEN** undo returns 409 with a count of such panels and without that panel's id, title or dashboard name, and
  nothing changes

#### Scenario: A bind that lands after the pre-check is not deleted silently
- **WHEN** a panel is bound to a created Output after the pre-check passed but before the restore transaction reads the
  definition
- **THEN** undo returns 409 `PATCH_SET_STALE` with no panel id, and nothing changes

#### Scenario: Alert rules on a created Output are named only for their owner
- **WHEN** an alert rule targets an Output the save created and the user undoes the save
- **THEN** undo returns 409 naming the rule by name with no rule id when the undoing user owns it, and otherwise
  reporting only a count with neither its id nor its name, and nothing changes

#### Scenario: Removed and newly bound panels together
- **WHEN** the save's cascade removed a bound panel and a panel is now bound to an Output the save created
- **THEN** undo returns one 409 reporting the removed count and the created-Output blockers, with no panel id
