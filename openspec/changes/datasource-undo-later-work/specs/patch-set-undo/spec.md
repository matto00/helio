## ADDED Requirements

### Requirement: Undo SHALL refuse when a pipeline create's undo would delete an inline dataset root with later work
Before restoring anything, undo SHALL check every inline `dataset` root source that a `pipeline` `create` edit made.
Undo SHALL skip a source that still exists and is referenced by anything other than the pipeline being undone, since
that source is kept and the undo removes nothing from it. For every other inline `dataset` root, undo SHALL refuse
the whole undo with a conflict error and restore no edit when, since the apply:

- a row was appended to it, by any user and any path;
- a row the apply created was edited; or
- its declared dataset schema was edited.

Deleting rows SHALL NOT block. The conflict message SHALL give counts only. It SHALL NOT include a row value, a row id
or a source id. It MAY name the inline source, which the applying user owns.

#### Scenario: A row appended to an inline dataset root refuses the pipeline-create undo
- **WHEN** user A applies a patch set whose `pipeline` create makes an inline dataset root, a row is then appended to
  that source, and A calls `POST /api/patch-sets/:id/undo`
- **THEN** the call is rejected with a conflict error giving a count of added rows, and the pipeline, the source and
  every row remain exactly as before the call

#### Scenario: An edited row or schema of an inline dataset root refuses the undo
- **WHEN** a row the apply created in the inline dataset root, or that source's declared schema, is edited after the
  apply and the applying user undoes
- **THEN** the whole undo is refused with a conflict error and nothing is restored

#### Scenario: A still-referenced inline source keeps HEL-1493 behaviour
- **WHEN** another pipeline also uses the inline dataset root and rows were appended to it after the apply, and the
  applying user undoes
- **THEN** the undo succeeds, the pipeline is removed, and the source is reported as kept with all its rows

#### Scenario: With no later work the pipeline-create undo still removes its inline dataset root
- **WHEN** a patch set's `pipeline` create made an inline dataset root, nothing changed afterwards, and the applying
  user undoes
- **THEN** the undo succeeds and removes the pipeline, the source and its rows
