## ADDED Requirements

### Requirement: Undo of a pipeline create SHALL remove the unreferenced inline root sources that create made

When a journaled `pipeline` `create` edit is undone, the system SHALL delete the pipeline and then each inline root
source that the original apply created, through the same reference-guarded source delete the API uses, and then the
implicit "Auto:" Connector of a bare-`url` REST inline root once its source is gone. A source that is still referenced
SHALL be kept. Sources the apply did not create (roots given by `sourceId`) SHALL never be deleted. The edit's undo
outcome SHALL report each journaled inline source as `removed`, `kept` or `alreadyGone`. A journal entry written before
the apply recorded its inline sources SHALL keep today's behaviour: only the pipeline is deleted and no inline-source
report is returned.

#### Scenario: Unreferenced inline root source is removed on undo
- **WHEN** a patch set whose `pipeline` `create` edit used an inline root is applied and then undone
- **THEN** the pipeline and the inline source are both gone, and the outcome lists the source as `removed`

#### Scenario: Inline source referenced since the apply is kept and reported
- **WHEN** after the apply, another pipeline adds the inline source as a root, and the patch set is then undone
- **THEN** the undo succeeds, the created pipeline is gone, the source survives, and the outcome lists it as `kept`

#### Scenario: A pre-existing root source is never deleted
- **WHEN** the `pipeline` `create` edit named an existing source by `sourceId`, and the patch set is undone
- **THEN** that source survives and is not listed in the outcome

#### Scenario: Implicit Connector of a bare-url REST inline root is removed with its source
- **WHEN** the inline root was a `rest_api` root given as a bare `url`, and the patch set is undone
- **THEN** the source and its implicit "Auto:" Connector are both gone

#### Scenario: A source that could not be removed is reported kept with a fixed reason
- **WHEN** deleting a journaled inline source fails for any reason other than a reference conflict
- **THEN** the undo still succeeds, and the outcome lists the source as `kept` with a fixed reason that carries no internal detail

#### Scenario: A create with no inline roots reports nothing
- **WHEN** every root of the `pipeline` `create` edit named an existing source, and the patch set is undone
- **THEN** the outcome carries no `inlineSources` field

#### Scenario: Legacy journal entry keeps today's behaviour
- **WHEN** a `pipeline` `create` journal entry carries no recorded inline sources and is undone
- **THEN** only the pipeline is deleted, the source survives, and the outcome carries no `inlineSources`
