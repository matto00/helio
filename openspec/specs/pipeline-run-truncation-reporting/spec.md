# pipeline-run-truncation-reporting Specification

## Purpose
Defines how a pipeline run detects that its source read was capped by the run row limit, and what every caller-facing surface — the run-result API body, the MCP `run_pipeline` tool, the pipeline detail UI, and REST source creation — must report so that a truncated result is never mistaken for a complete one.

## Requirements

### Requirement: The run row cap is reported, never silently applied
A pipeline run SHALL report whether its primary source read was truncated by the engine's run row cap. The cap value itself SHALL NOT be changed, raised, or made configurable by this capability — the cap is a memory bound and remains in force; only its visibility changes.

A run that was truncated SHALL be distinguishable from a run that was not, at every surface listed in this capability, without the caller inspecting row counts and inferring.

`sourceTruncated` SHALL be true when **any** source read performed by the run was truncated, including a secondary source read by a `join`, `union` or `lookup` step. The run SHALL NOT report `sourceTruncated: false` when a secondary source was truncated — reporting completeness the run cannot support is a worse failure than reporting nothing.

`sourceAvailableRowCount` SHALL describe the **primary** source only, and its documentation SHALL say so. Per-source detail SHALL be carried by `truncatedReads`, one entry per truncated read, each naming the data source, the rows read, and the available total when one was measured.

#### Scenario: A source larger than the cap reports truncation
- **WHEN** a pipeline runs over a REST source whose response contains 3303 rows and the run row cap is 1000
- **THEN** the run result reports `sourceTruncated: true`, `sourceAvailableRowCount: 3303`, and `sourceRowCount: 1000`

#### Scenario: A source smaller than the cap reports no truncation
- **WHEN** a pipeline runs over a source containing 250 rows
- **THEN** the run result reports `sourceTruncated: false` and omits `truncationNotice`

#### Scenario: A source exactly at the cap is not reported as truncated
- **WHEN** a pipeline runs over a source containing exactly as many rows as the run row cap
- **THEN** the run result reports `sourceTruncated: false` — the cap being reached is not by itself evidence that rows were discarded

#### Scenario: A truncated union right-hand source is reported
- **WHEN** a pipeline's `union` step reads a secondary source larger than the run row cap, while the primary source is under the cap
- **THEN** the run result reports `sourceTruncated: true` and `truncatedReads` contains an entry naming that secondary source

#### Scenario: A truncated join or lookup source is reported
- **WHEN** a pipeline's `join` or `lookup` step reads a secondary source larger than the run row cap
- **THEN** the run result reports `sourceTruncated: true` rather than `false`

#### Scenario: The run row cap is unchanged
- **WHEN** this capability is implemented
- **THEN** `InProcessPipelineEngine.maxRunRows` is still `1000`

### Requirement: A connector reports an available-row count only when it measured one
A connector SHALL report an available-row count only when that count was actually observed. A connector that can prove truncation without knowing the total SHALL report truncation with **no** available-row count rather than reporting an inferred, estimated, or saturation-derived number.

#### Scenario: REST reports an exact available-row count
- **WHEN** a REST connector parses a response body into N rows and returns the first `maxRows` of them
- **THEN** it reports `availableRowCount = Some(N)` and `truncated = N > maxRows`

#### Scenario: SQL proves truncation without claiming a total
- **WHEN** a SQL connector is asked for `maxRows` rows and the database returns more than `maxRows` rows to its `maxRows + 1` probe
- **THEN** it reports `truncated = true` and `availableRowCount = None`, and returns exactly `maxRows` rows

#### Scenario: SQL returning fewer than the probe size is complete
- **WHEN** a SQL connector's `maxRows + 1` probe returns `maxRows` or fewer rows
- **THEN** it reports `truncated = false`

#### Scenario: Uncapped source kinds never report truncation
- **WHEN** a pipeline runs over a static, CSV, text, PDF, or image source
- **THEN** the run reports `sourceTruncated: false` and no available-row count — the engine applies no run row cap to these kinds

### Requirement: The truncation notice states the consequence, not just the fact
When a run was truncated, the run result SHALL carry a human- and agent-readable `truncationNotice` composed server-side. The notice SHALL state how many rows were read, SHALL state the available total when one was measured, SHALL explicitly say the total is not known when none was measured, and SHALL state that results derived from the run describe only the partial population.

The notice SHALL interpolate the cap value from the engine's configured cap rather than embedding a literal, so the message cannot desynchronise from the behaviour.

A notice that reports truncation without saying how many rows were read does not satisfy this requirement.

#### Scenario: Notice when the total is known
- **WHEN** a run read 1000 of 3303 available rows
- **THEN** `truncationNotice` names both 1000 and 3303, names the 1000-row run cap, and states that filters, sorts, and aggregates from this run describe only the partial population

#### Scenario: Notice when the total is unknown
- **WHEN** a run read 1000 rows from a SQL source proven to have more
- **THEN** `truncationNotice` names 1000, states that more rows exist and that the total is not known, and does not name any number as the available total

#### Scenario: No notice on a complete run
- **WHEN** a run was not truncated
- **THEN** `truncationNotice` is absent from the response body

### Requirement: Truncation is visible at the MCP surface
The MCP `run_pipeline` tool result SHALL carry the run-wide truncation flag, the per-source truncated-read detail, the
primary source's row counts, and the truncation notice. The tool's own description SHALL describe the returned
truncation fields rather than promising an unqualified row count.

An agent reading only the tool result, without access to the raw HTTP body, SHALL be able to tell a truncated run from
a complete one, and SHALL be able to identify **which** source was truncated and by how much without parsing prose.

**No two truncation fields of different scope SHALL be presented under names that do not distinguish their scope.**
The result's scalar row counts describe the **primary** source only and SHALL be named so that this is evident from
the field name alone; the truncation flag is **run-wide** (true when any read, primary or secondary, was truncated).
A result SHALL NOT present a run-wide truncation flag alongside unqualified fields named `availableRowCount` and
`sourceRowCount`, because a caller comparing that pair on a secondary-source truncation reads equal values and
concludes nothing was lost. Renaming those scalars does not by itself prove completeness; the run-wide flag together
with a non-empty `truncatedReads` is the signal that rows were lost, and the scope-qualified names exist so the
scalars cannot contradict it.

Per-source detail SHALL be carried by `truncatedReads`, one entry per truncated read, each naming the data source, the
rows read, and the available total when one was measured. `truncatedReads` SHALL be present and empty — never absent —
on a complete run, so an agent can branch on its length without distinguishing empty from missing.

The tool's description SHALL state what each returned row count is scoped to, and SHALL state that the truncation flag
is run-wide.

#### Scenario: MCP result distinguishes a truncated run
- **WHEN** an agent calls `run_pipeline` on a pipeline whose source exceeds the cap
- **THEN** the returned object carries `truncated: true`, the primary source's available-row count, the notice text,
  and a `truncatedReads` entry for that source

#### Scenario: MCP result on a complete run carries no truncation claim
- **WHEN** an agent calls `run_pipeline` on a pipeline whose source is under the cap
- **THEN** the returned object carries `truncated: false`, an empty `truncatedReads`, and no notice

#### Scenario: A secondary-source truncation is not readable as a complete run
- **WHEN** an agent calls `run_pipeline` on a pipeline whose primary source is under the cap and whose `lookup`,
  `join` or `union` secondary source exceeds it
- **THEN** the returned object carries `truncated: true`, and `truncatedReads` contains exactly one entry, naming the
  secondary source with the rows read and the larger available total
- **AND** the returned object contains no field named `availableRowCount` and no field named `sourceRowCount`, so
  the equal-valued primary pair cannot be read as a run-wide statement

#### Scenario: The primary-scoped row counts are named for their scope
- **WHEN** any `run_pipeline` result is returned
- **THEN** the primary source's rows-read and available-row counts are carried under names that identify them as
  primary-scoped, and no field named `availableRowCount` sits at the top level of the result alongside the run-wide
  truncation flag

### Requirement: Truncation is visible in the pipeline UI
The pipeline detail UI SHALL display a warning when the most recent run was truncated, rendering the server-composed notice, and SHALL display nothing when the run was not truncated. The warning SHALL be visible without the user opening a raw response or a developer tool.

#### Scenario: Warning shown after a truncated run
- **WHEN** a user runs a pipeline whose source exceeds the cap
- **THEN** a truncation warning naming the rows read and the available total is visible on the pipeline detail page

#### Scenario: No warning after a complete run
- **WHEN** a user runs a pipeline whose source is under the cap
- **THEN** no truncation warning is rendered

### Requirement: Source creation warns that runs will be truncated
When a source is created and schema inference actually observed more rows than the run row cap, the create response SHALL carry a `rowCapNotice` advising that runs over this source will read only the first `maxRunRows` rows. This is a forward-looking advisory about run behaviour; source creation itself applies no run row cap.

The observed row count SHALL be carried out of inference on the existing inference result rather than obtained by issuing a second fetch. A connector kind whose inference cannot observe the true row count SHALL report no observed count, and SHALL therefore emit no advisory rather than a guess.

#### Scenario: REST creation over a large source advises
- **WHEN** a REST source is created and inference observes 3303 rows
- **THEN** the create response carries a `rowCapNotice` naming 3303 and the 1000-row run cap

#### Scenario: REST creation under the cap is silent
- **WHEN** a REST source is created and inference observes 250 rows
- **THEN** the create response carries no `rowCapNotice`

#### Scenario: SQL creation emits no advisory
- **WHEN** a SQL source is created
- **THEN** the create response carries no `rowCapNotice` — SQL inference samples at most 100 rows and cannot observe the true total

### Requirement: Truncation survives the session that produced it
A run's truncation facts SHALL be persisted with the run record, not held only in client session state. After the
process, the browser session, and the Redux store that produced a run are all gone, a reader of the persisted record
SHALL still be able to tell that the run's row count is partial.

The persisted facts SHALL be sufficient to reconstruct the run-wide truncation flag, the primary source's
available-row count when one was measured, and the per-source truncated-read detail (data source name, rows read, and
available total when measured). Persisting only a boolean does not satisfy this requirement, because the notice cannot
then be reconstructed and a reader learns that something was lost without learning how much.

A persisted run SHALL NOT store a pre-rendered notice string. The notice SHALL be recomposed on read from the
persisted reads using the same single server-side composer that the live run result uses, so the persisted and live
surfaces cannot drift into two phrasings.

#### Scenario: A truncated run is still identifiable after a reload
- **WHEN** a pipeline whose source exceeds the run row cap is run, and the pipeline detail page is then reloaded from
  scratch with no prior Redux run state
- **THEN** the persisted run record read back from the server reports the run as truncated, names the rows read and
  the available total, and carries the same notice text the live run result carried

#### Scenario: The persisted notice is not a second phrasing
- **WHEN** the notice for a persisted truncated run is produced
- **THEN** it is produced by the same composer that produces the live run result's notice, from the persisted reads,
  and is byte-identical to the notice the live run returned

#### Scenario: A complete run persists a recorded, empty truncation signal
- **WHEN** a pipeline whose source is under the run row cap completes
- **THEN** the persisted run record reports the run as recorded-and-not-truncated, with per-source truncated-read
  detail present and empty rather than absent

### Requirement: An unrecorded truncation signal is never reported as complete
A run persisted before truncation facts were recorded SHALL be reported as **signal not recorded**, which is a
distinct state from **not truncated**. No read path and no rendered surface SHALL collapse the two, because doing so
re-creates the original defect for every historical row: an absent signal read as completeness is exactly the
plausible-looking number with nothing to distrust it.

A recorded run SHALL always carry present, non-null truncation detail. This SHALL hold for **every** persisted run
row that reaches a terminal status after this capability ships, including dry runs and failed runs, not only for the
successful-run write path — an unpopulated terminal row would make the unrecorded state ambiguous between "predates
recording" and "this write path was missed", which is precisely the ambiguity the state exists to remove.

A run row that has not reached a terminal status carries no truncation detail, because its truncation facts do not
yet exist. Such a row SHALL be identified by its status rather than by its truncation signal, and SHALL display no
row count, so it presents no number requiring qualification.

#### Scenario: A historical run reads as unrecorded, not as complete
- **WHEN** a run row persisted before this capability shipped is read back
- **THEN** it reports the truncation signal as not recorded, and does not report the run as not-truncated

#### Scenario: A non-terminal run carries no truncation signal and no row count
- **WHEN** a run row exists in a queued or running status
- **THEN** its truncation signal is absent, and it displays no row count for that absence to misqualify

#### Scenario: A newly recorded complete run is not unrecorded
- **WHEN** any run reaches a terminal status after this capability ships, truncated or not
- **THEN** its persisted truncation signal is recorded, never null

#### Scenario: A dry run records its truncation signal
- **WHEN** a dry run executes over a source exceeding the run row cap and is persisted to run history
- **THEN** its persisted truncation signal is recorded and reports the run as truncated, and the row count it renders
  in run history is marked partial

#### Scenario: A failed run records rather than omits its truncation signal
- **WHEN** a run fails and is persisted
- **THEN** its persisted truncation signal is recorded, never null, so it is not confusable with a run predating
  this capability

A failed run's recorded signal is `[]` (recorded-and-not-truncated) even when a truncated read was
observed before the failure occurred — this is a deliberate simplification, not a gap: a failed run never
persists a row count either, so there is no displayed number for a more precise per-read signal to
qualify, and reserving the richer detail for this one unobservable-on-any-surface case was judged not
worth a second code path. A future run of the SAME pipeline that succeeds still reports its own,
independently-observed truncation accurately.

### Requirement: A persisted row count is never displayed without its truncation context
Every surface that displays a persisted row count SHALL NOT display a truncated count bare, and SHALL NOT assert or
imply completeness for a run whose truncation signal was never recorded. A truncated count shown without its context
is the defect this capability exists to remove; an unrecorded count rendered as though it were verified complete is
the same defect displaced onto history.

Surfaces are NOT required to render an affirmative marker for the complete or the unrecorded state — rendering
nothing satisfies this requirement for both, because neither claims completeness. Only the truncated state requires
a positive affordance.

This applies at minimum to the pipeline detail footer's rows-written figure, the run history list's per-run row count,
and any pipeline list view showing a last-run row count. A truncated count SHALL be visually distinguishable from a
complete one without the reader hovering, expanding, or opening a developer tool, and the distinction SHALL NOT rely
on colour alone.

A run under the cap SHALL show no truncation indication — including for historical rows, which render without a
truncation warning and equally without any completeness claim.

#### Scenario: The detail footer marks a partial count after a reload
- **WHEN** the pipeline detail page is loaded fresh for a pipeline whose last run was truncated
- **THEN** the rows-written figure is rendered as partial, alongside the server-composed notice

#### Scenario: The run history list distinguishes truncated runs
- **WHEN** run history is opened for a pipeline with both a truncated and a complete run
- **THEN** the truncated run's row count is marked partial and the complete run's is not

#### Scenario: A complete run shows no truncation indication anywhere
- **WHEN** a pipeline whose every run was under the cap is displayed in the list table, the detail footer, and run
  history
- **THEN** no truncation indication is rendered on any of the three

#### Scenario: A historical run is not marked truncated
- **WHEN** a pipeline whose last run predates truncation recording is displayed
- **THEN** no truncation warning is rendered, and the count is not asserted to be complete either
