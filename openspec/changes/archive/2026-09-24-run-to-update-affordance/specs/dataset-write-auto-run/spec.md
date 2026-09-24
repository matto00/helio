## MODIFIED Requirements

### Requirement: Only pipelines passing the cheapness verdict auto-run
The system SHALL NOT schedule an auto-run for a pipeline whose `PipelineCostEstimator` verdict is
not `autoRunnable` at the time eligibility is evaluated, and SHALL return the verdict's denial
reason(s) to the writer — never discarding them silently, and never merely logging them — SUBJECT
TO the visibility requirement below. The write response SHALL include, for each denied downstream
pipeline the writer has visibility into, its id, name, denial reasons, and whether the writing user
is permitted to trigger a manual run of it (`canRun`, mirroring the same owner-or-editor-grantee
check the manual run submission path enforces). Evaluation of every downstream pipeline's verdict
SHALL complete before the write response is returned — the write itself is not delayed on a
debounced RUN, only on the (already-computed-per-write) verdict evaluation. This requirement SHALL
apply identically to every row-mutation entry point sharing the underlying trigger path EXCEPT row
delete: append, form-append, replace, and patch. Row delete (`DELETE .../rows/:rowId`) is explicitly
OUT OF SCOPE for this requirement — it SHALL continue to only log a denial, exactly as before this
change, and SHALL NOT be required to return `204`-incompatible response content. Scheduling a
debounced auto-run for an ALLOWED pipeline SHALL be unaffected by this requirement.

#### Scenario: A denied pipeline is not auto-run
- **WHEN** a dataset write's downstream pipeline contains a step the cheapness verdict denies
  (e.g. an AI step), and the writing user has at least a viewer grant on that pipeline
- **THEN** no run is scheduled or submitted for that pipeline as a result of the write, and the
  write response includes that pipeline's id, name, and denial reason(s)

#### Scenario: The write response carries canRun for the writing user
- **WHEN** a dataset write is submitted by a user who is not the owner of a denied downstream
  pipeline, but holds an editor grant on it
- **THEN** the denied pipeline's entry in the write response has `canRun: true`

#### Scenario: A denied pipeline the writer can see but cannot run still reports its reason
- **WHEN** a dataset write's downstream pipeline is denied and the writing user holds only a
  viewer grant on that pipeline
- **THEN** the denied pipeline's entry in the write response has `canRun: false`, and its denial
  reason(s) are still present

#### Scenario: A denied pipeline the writer has no relationship to at all is omitted
- **WHEN** a dataset write's downstream pipeline is denied and the writing user holds no grant
  (owner, editor, or viewer) on that pipeline whatsoever
- **THEN** that pipeline does not appear anywhere in the write response — no id, name, or reason —
  though the denial is still logged server-side exactly as before this change

#### Scenario: A replace write reports a denial identically to an append write
- **WHEN** a `PUT` (replace) row write to a dataset denies a downstream pipeline the writer can see
- **THEN** the write response includes that pipeline's id, name, and denial reason(s), exactly as
  a `POST` (append) write would

#### Scenario: A patch write reports a denial identically to an append write
- **WHEN** a `PATCH` (single-row edit) write to a dataset denies a downstream pipeline the writer
  can see
- **THEN** the patch response includes that pipeline's id, name, and denial reason(s), exactly as
  a `POST` (append) write would

#### Scenario: A delete-triggered denial is not surfaced in the response
- **WHEN** a row `DELETE` causes a downstream pipeline to be denied auto-run
- **THEN** the `DELETE` response remains `204 No Content` with no body, and the denial is only
  logged server-side, exactly as before this change

#### Scenario: An allowed pipeline's debounce scheduling is unchanged
- **WHEN** a dataset write's downstream pipeline passes the cheapness verdict
- **THEN** a debounced auto-run is scheduled for it exactly as before this change, and it does not
  appear in the write response's denied-pipelines list
