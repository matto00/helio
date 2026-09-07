## ADDED Requirements

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
