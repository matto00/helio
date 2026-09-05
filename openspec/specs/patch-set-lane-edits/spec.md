# patch-set-lane-edits Specification

## Purpose
Expresses adding and removing a pipeline lane as a patch-set edit, so an agent can propose a
branching change to an existing pipeline through the same review/apply/undo path every other edit
uses, and so undoing that change removes everything the lane brought with it rather than orphaning it.

## Requirements

### Requirement: Adding a lane is a patch-set create edit
A lane SHALL be added by a `pipelineStep` create edit whose new step names an existing step as its
parent — producing a sibling of that parent's existing child rather than extending a chain.

Producing a sibling SHALL require the create patch to set `attachAsTail: true`. Without it the
step-creation path splices the new step in and reparents the anchor's existing children onto it
(the trunk-insert semantic), which silently restructures the pipeline instead of branching it.
The flag is named here because the outcome this requirement states is not the default outcome, and
every agent-facing surface that documents lane creation SHALL say so.

**Deferred, deliberately:** a single patch set carrying several create edits that chain into a
multi-step lane — each naming the previous one as parent — is **not** supported and is not asserted
here. It would need a request-scoped forward reference to a step no edit has created yet, which does
not exist in the patch-set contract. Tracked as **HEL-978**, which mirrors `create_pipeline`'s
existing `clientId` resolution rather than designing a new convention. A multi-step lane is built
today with several sequential applies, one step each.

#### Scenario: A create edit naming a parent that already has a child produces a sibling
- **WHEN** a patch set creates a `pipelineStep` with `attachAsTail: true` whose parent already has one child
- **THEN** the parent has two children afterward and neither is reparented under the other

#### Scenario: Omitting attachAsTail splices rather than branching
- **WHEN** a patch set creates a `pipelineStep` without `attachAsTail` whose parent already has one child
- **THEN** the pre-existing trunk-insert behaviour applies and the parent's existing child is reparented
  under the new step — which is why lane-creation guidance names the flag

### Requirement: Undoing an added lane removes the lane, its Outputs, and their placements
Undo of a patch set that added a lane SHALL remove every step the patch set created, together with
the Outputs bound to those steps and those Outputs' panel placements, and SHALL report the placement
count it removed — the same reporting step deletion already performs. Undo SHALL NOT leave an Output
bound to a deleted node, and SHALL NOT leave a panel placed on a deleted Output.

Undo SHALL be atomic: if any part of the removal cannot be performed, the whole undo is refused and
nothing is removed, rather than a partial teardown.

#### Scenario: Undo of an added lane removes its Outputs and placements
- **WHEN** a patch set that added a lane carrying an Output placed on two dashboards is undone
- **THEN** the lane's steps, that Output, and both placements are gone, and the result reports a
  placement count of two

#### Scenario: Undo of an added lane leaves the rest of the pipeline intact
- **WHEN** a patch set that added a lane to a pipeline with an existing trunk is undone
- **THEN** the trunk's steps, Outputs, and placements are unchanged, and the pipeline still has at
  least one lane

#### Scenario: A surviving rejoin referencing the added lane refuses the undo
- **WHEN** a step added after the patch set carries a `lane`-kind secondary input referencing a node
  the undo would delete
- **THEN** the whole undo is refused with a named error identifying the referencing step, and nothing
  is removed

#### Scenario: Removing a lane by patch set and undoing it restores its Outputs and placements
- **WHEN** a patch set deletes a lane carrying a placed Output, and is then undone
- **THEN** the lane's steps, its Output, and its placement are restored
