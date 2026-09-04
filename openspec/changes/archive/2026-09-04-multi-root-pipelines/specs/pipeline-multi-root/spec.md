## ADDED Requirements

### Requirement: A pipeline has one or more ordered roots, each binding a data source
A pipeline SHALL own an ordered, non-empty set of roots. Each root SHALL bind exactly one DataSource. A pipeline with zero roots SHALL NOT be representable: the last remaining root SHALL NOT be removable. A root SHALL be addressed by an opaque root id; a root's position SHALL NOT be used as its address.

#### Scenario: A pipeline created with two roots reports both, in order
- **WHEN** a pipeline is created with two roots bound to two readable sources
- **THEN** the pipeline reports two roots at positions 0 and 1, each carrying its own root id and data source id

#### Scenario: Removing the last remaining root is refused
- **WHEN** a caller removes the only root of a pipeline
- **THEN** the request fails with a named error identifying the at-least-one-root invariant
- **THEN** the pipeline still has its root

### Requirement: Root order is deterministic and presentational, never semantic
Root position SHALL be a dense `0..n-1` ordering that determines the order roots are listed in responses and the topological tiebreak between lanes not otherwise ordered.

No **semantic** behaviour SHALL branch on a root's position: no root SHALL be treated as primary, no root's data SHALL be treated differently, and no access-control or lifecycle rule SHALL read position. Exactly three **deterministic tiebreaks** MAY read position, and no others: the order roots are listed in responses; the canonical node path for a node reachable from several roots; and the run result's reported rows where the graph does not otherwise determine them. A tiebreak among otherwise-unordered alternatives is not a privilege. A fourth reader of position SHALL be treated as a contract change.

#### Scenario: Lanes from two roots evaluate in root-position order when otherwise unordered
- **WHEN** a pipeline has two roots, each with one root-level step, and no lane reference orders them
- **THEN** the step attached to the position-0 root evaluates before the step attached to the position-1 root

#### Scenario: Root positions are compacted after a removal
- **WHEN** a pipeline with three roots at positions 0, 1, 2 has the position-1 root removed
- **THEN** the surviving roots occupy positions 0 and 1
- **THEN** each surviving root keeps the root id it had before the removal

### Requirement: Root-level steps are attached to a specific root
A step with no parent step SHALL carry the id of the root whose frame it reads. The engine SHALL evaluate such a step from that root's loaded frame, and SHALL NOT evaluate it from any other root's frame.

#### Scenario: Two root-level steps read their own roots' frames
- **WHEN** a pipeline has two roots whose sources carry different rows, each with one root-level pass-through step
- **THEN** each step's reported frame equals the rows of its own root's source

### Requirement: Adding a root appends an empty lane
Adding a root SHALL append it at the next position, accepting either an existing source id or an inline source spec, in the same element shape used when creating a pipeline. A newly added root SHALL have no steps.

#### Scenario: A root added to an existing pipeline starts empty
- **WHEN** a root is added to a pipeline that already has one root and steps
- **THEN** the pipeline reports two roots
- **THEN** the new root has no steps and the existing root's steps are unchanged

### Requirement: Removing a root removes its lanes and their Outputs, reporting placements
Removing a root SHALL delete every step whose lane originates at that root, together with those steps' Outputs and the Outputs' panel placements, and SHALL report the placement count before deleting. It SHALL also delete every Output, node snapshot, and binary ref bound to the root itself, explicitly where no database cascade exists to do so. Removal SHALL be refused with a named error when a surviving lane references a node that would be deleted.

#### Scenario: Removing a root removes its lane's Outputs and reports the placement count
- **WHEN** a root whose lane carries an Output placed on two dashboards is removed
- **THEN** the response reports a placement count of two
- **THEN** the root, its steps, its Output, and the two placements are gone
- **THEN** the other root's steps and Outputs are unchanged

#### Scenario: Removing a root deletes its root-bound snapshot rows
- **WHEN** a root carrying a root-bound Output and its snapshot rows is removed
- **THEN** no node snapshot row remains bound to that root
- **THEN** the removal does not rely on a database cascade to achieve this

#### Scenario: Removing a root referenced by a surviving lane is refused
- **WHEN** a surviving lane's rejoin step names a node in the lane of the root being removed
- **THEN** the request fails with a named error identifying the referencing step
- **THEN** no root, step, or Output is deleted

### Requirement: Every root's source is ownership-checked at write time
Every root's data source SHALL be resolved against the caller's owned sources when a pipeline is created and when a root is added; an unreadable or non-existent source SHALL yield 404. An empty or blank root source id SHALL be rejected with 400. At run time roots SHALL resolve without a per-source ownership check, the pipeline's own access control being authoritative.

#### Scenario: A root naming another owner's source is a 404 at create time
- **WHEN** a pipeline is created with one readable root source and one source owned by another user
- **THEN** the request fails with 404
- **THEN** no pipeline, root, or step is created

#### Scenario: A root with an empty source id is a 400
- **WHEN** a pipeline is created with a root whose source id is the empty string
- **THEN** the request fails with 400 and no ownership lookup is performed for that root

### Requirement: A run refreshes every root atomically
A single run SHALL load every root's source and refresh every Output of the pipeline. Scheduling and freshness SHALL remain per pipeline. A failure loading any root's source SHALL fail the whole run and SHALL name the failing root.

#### Scenario: One run refreshes Outputs across both roots
- **WHEN** a two-root pipeline with an Output on each root's lane is run once
- **THEN** both Outputs are refreshed by that single run

#### Scenario: An unreadable root source fails the whole run
- **WHEN** one of two root sources cannot be read at run time
- **THEN** the run fails and the error names that root
- **THEN** no Output of the pipeline is left partially refreshed

### Requirement: An Output or snapshot bound to the root binds to a root id, never to NULL
An Output, node snapshot, or binary ref whose target is a pipeline's root SHALL identify that root by root id. Exactly one of its node step id and its root id SHALL be set; a row with neither SHALL be invalid and SHALL be rejected by the database. The node key such a row resolves to SHALL be the same node key the engine seeds for that root, so that root-bound Outputs refresh by construction rather than by a NULL-matches-NULL coincidence.

No read or write against these tables SHALL key on a null node step id alone: under multi-root that predicate selects every root rather than one, so a write scoped by it destroys other roots' rows and a read scoped by it returns them. Uniqueness of root-bound snapshot rows SHALL be per root, not per pipeline.

#### Scenario: A root-bound Output refreshes on a run
- **WHEN** a pipeline with an Output bound to its root is run
- **THEN** that Output is refreshed and its snapshot rows are the root's loaded rows

#### Scenario: A root-bound Output on a two-root pipeline refreshes from its own root
- **WHEN** a two-root pipeline has an Output bound to the second root and is run
- **THEN** that Output's rows are the second root's source rows, not the first root's

#### Scenario: Writing one root's snapshot rows leaves the other root's intact
- **WHEN** a two-root pipeline, each root carrying a root-bound Output, is run twice
- **THEN** after the second run both roots' snapshot rows are present
- **THEN** neither root's write has deleted the other root's rows

#### Scenario: Two roots may each hold a snapshot row at the same row index
- **WHEN** root A and root B each persist a root-bound snapshot row at row index 0
- **THEN** both rows persist and neither displaces the other

#### Scenario: Listing a root's Outputs returns only that root's
- **WHEN** a two-root pipeline's Outputs are listed for one root
- **THEN** only that root's Outputs are returned, not the other root's

#### Scenario: An Output with neither a node step nor a root is rejected
- **WHEN** an Output row would be written with both its node step id and its root id null
- **THEN** the write is rejected

### Requirement: A step names its root at create time by client id
In a single-call create, each element of `roots` SHALL carry a `clientId`, and a step with no `parentStepId` SHALL name one of them via `rootClientId`, resolved in the same left-to-right fold that resolves `parentStepId`. A `rootClientId` naming no root element, a step carrying neither `parentStepId` nor `rootClientId`, and a step carrying both SHALL each fail with a named error. A step with no root reference SHALL NOT default to any root.

#### Scenario: Two root-level steps name their own roots
- **WHEN** a create call supplies two roots with client ids and one root-level step naming each
- **THEN** each step is bound to the root it named

#### Scenario: An unresolvable rootClientId is rejected
- **WHEN** a step's `rootClientId` names no element of `roots`
- **THEN** the request fails with a named error identifying the unresolved client id, and nothing is created

#### Scenario: A root-level step with no root reference is rejected, not defaulted
- **WHEN** a step carries neither `parentStepId` nor `rootClientId`
- **THEN** the request fails with a named error
- **THEN** the step is not silently attached to the first root

#### Scenario: A step naming both a parent and a root is rejected
- **WHEN** a step carries both `parentStepId` and `rootClientId`
- **THEN** the request fails with a named error

### Requirement: A root is identified on the wire by its id, never by a null node
Every wire surface that reports a node SHALL identify a root node by its root id and SHALL carry an explicit discriminator distinguishing a root node from a step node. A null node id SHALL NOT be used to mean "the root".

#### Scenario: Per-node run progress names each root by id
- **WHEN** a two-root pipeline is run and per-node progress is reported
- **THEN** each root's progress entry carries that root's id and a root discriminator
- **THEN** no progress entry carries a null node id
