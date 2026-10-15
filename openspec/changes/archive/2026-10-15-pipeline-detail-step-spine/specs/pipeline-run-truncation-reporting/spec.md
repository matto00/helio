## MODIFIED Requirements

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

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop this applies to the header's rows written (with the Partial badge) and to the spine's per-step counts: when the shown counts come from the persisted run and `lastRunTruncated` is true, or from the in-session run and its result is source-truncated, the Steps heading carries the Partial badge and each count's accessible name ends ", partial (row cap reached)".

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

#### Scenario: Desktop step counts carry the truncation context
- **WHEN** the persisted latest run was truncated and the spine shows its per-step counts
- **THEN** the Steps heading shows the Partial badge and each count's accessible name says it is partial
