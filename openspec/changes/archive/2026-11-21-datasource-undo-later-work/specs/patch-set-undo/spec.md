## ADDED Requirements

### Requirement: Undo SHALL refuse when a data source create's undo would delete or break later work
Before restoring anything, undo SHALL check every `dataSource` `create` edit. It SHALL refuse the whole undo with a
conflict error and restore no edit when, since the apply:

- a row was appended to the created source, by any user and by any path, form submits included;
- a row the apply created was edited;
- the source's declared dataset schema was edited; or
- a pipeline (root, or join/union/lookup/upsert secondary) or a form panel references the source.

Deleting rows does not block an apply journaled with its created-dataset record. A patch set cannot itself reference a
source it creates, so no reference is excused.

For rows and the schema, the conflict message SHALL give counts only. It SHALL never include a row value, a row id or
a column value. For references it SHALL name only the pipelines and panels the undoing user can read, and count the
rest. No id of a referencing pipeline, panel, dashboard or the source SHALL appear in the message. No other user's
name or id SHALL appear in the message or in INFO-or-higher logs.

#### Scenario: A form submit after the apply refuses the undo
- **WHEN** user A applies a patch set that creates a dataset source, user B (an editor on A's dashboard) submits a form
  panel bound to it, and A calls `POST /api/patch-sets/:id/undo`
- **THEN** the call is rejected with a conflict error giving a count of added rows, and the source, every row and every
  other resource in that application remain exactly as they were before the undo call

#### Scenario: A row the owner appended after the apply refuses the undo
- **WHEN** A applies a patch set that creates a dataset source, appends a row to it, and undoes
- **THEN** the undo is refused with a conflict error and nothing is restored

#### Scenario: An edited apply-era row refuses the undo
- **WHEN** a row the apply created is edited after the apply and the applying user undoes
- **THEN** the undo is refused with a conflict error giving a count of edited rows and nothing is restored

#### Scenario: A schema edit refuses the undo
- **WHEN** the created source's declared schema is edited after the apply and the applying user undoes
- **THEN** the undo is refused with a conflict error saying the schema was edited and nothing is restored

#### Scenario: A schema edit does not claim added rows
- **WHEN** only the created source's declared schema is edited after the apply and the applying user undoes
- **THEN** the conflict message says the schema was edited and gives no count of added rows

#### Scenario: Deleting an apply-era row and appending one refuses the undo
- **WHEN** the last row the apply created is deleted, a new row is appended, and the applying user undoes
- **THEN** the undo is refused with a conflict error counting the added row and nothing is restored

#### Scenario: A deleted row does not block
- **WHEN** a row the apply created is deleted after an apply journaled with its created-dataset record, nothing else
  changed, and the applying user undoes
- **THEN** the undo succeeds and removes the source

#### Scenario: A later pipeline using the source refuses the whole undo before anything is restored
- **WHEN** a patch set creates a dataset source plus a dashboard and a panel, a pipeline outside that patch set later
  uses the source as a root or as a join, union or lookup secondary, and the applying user undoes
- **THEN** the call is rejected with a conflict error containing that pipeline's name and not its id, and the source,
  the dashboard and the panel remain

#### Scenario: A later form panel bound to the source refuses the undo
- **WHEN** a form panel outside the patch set is bound to the created source and the applying user undoes
- **THEN** the call is rejected with a conflict error and nothing is restored

#### Scenario: With no later work the undo removes the source and its rows
- **WHEN** a patch set creates a dataset source with rows, nothing is changed afterwards, and the applying user undoes
- **THEN** the undo succeeds and the source and its rows are gone

#### Scenario: A row added during the undo is not deleted silently
- **WHEN** a row is appended after undo's pre-check passed and the re-check immediately before the source delete sees it
- **THEN** the source is not deleted and the undo reports that edit as failed with a count only
