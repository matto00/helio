## ADDED Requirements

### Requirement: Pipeline detail boot requests are bounded

Opening the pipeline detail page SHALL NOT issue more than one GET of the same resource for the same pipeline per page
open, in development (including React StrictMode) and production builds alike. The page SHALL NOT fetch the
pipeline's run history on open unless something rendered on first paint needs it. The only first-paint consumer is the
persisted truncation banner, which renders only when the pipeline's last run is recorded as truncated. Run history
SHALL instead be fetched when the user opens the run-history modal, at least once per page open (a list loaded on an
earlier visit SHALL NOT be shown without being refetched), and refreshed after a run the page started or observed
finishes, as before; that refresh SHALL NOT be dropped because another run-history fetch is in flight, and an older
response SHALL NOT overwrite a newer one. Every first-paint element the page showed before this requirement (header, schedule
summary, bound sources, river view, Outputs tab with its count, footer last-run metadata) SHALL render unchanged.

#### Scenario: Run history is fetched at most once on open
- **WHEN** the user opens the detail page of a pipeline whose last run was truncated
- **THEN** exactly one run-history GET is issued for that pipeline during the page open, and the persisted truncation
  notice renders

#### Scenario: Run history is not fetched on open when nothing needs it
- **WHEN** the user opens the detail page of a pipeline whose last run was not truncated (or that has never run)
- **THEN** no run-history GET is issued until the user opens the run-history modal

#### Scenario: Opening run history fetches it
- **WHEN** the user opens the run-history modal and run history has not been loaded for this page open
- **THEN** the run history is fetched and its runs render in the modal

#### Scenario: A StrictMode revisit still issues one run-history GET
- **WHEN** the user revisits, in the same session and under React StrictMode, the detail page of a pipeline whose last
  run was truncated
- **THEN** exactly one run-history GET is issued for that page open

#### Scenario: A response from an earlier visit does not count for a later one
- **WHEN** a run-history fetch is still in flight as the user leaves the page (including an in-place switch to another
  pipeline and back), lands afterwards, and the user returns and opens the run-history modal
- **THEN** a new run-history GET is issued for the new page open before any runs are listed

#### Scenario: Switching pipelines in place closes the run-history modal
- **WHEN** the run-history modal is open and the page switches in place to another pipeline (sidebar, picker, or
  browser Back)
- **THEN** the modal closes, and no pipeline's runs are shown under another pipeline's page

#### Scenario: A failed fetch is retried only on request
- **WHEN** the run-history modal shows its error state
- **THEN** no further run-history GET is issued until the user activates Retry, and each Retry issues exactly one

#### Scenario: Run history is refetched on a later page open
- **WHEN** the user opens the run-history modal, leaves the page (by navigating away, or in place to another pipeline),
  returns to the same pipeline, and opens the modal again
- **THEN** a new run-history GET is issued on the second visit, and the first visit's list is not shown before it

#### Scenario: The run-history modal does not claim emptiness while loading
- **WHEN** the run-history modal is open and its fetch is still in flight
- **THEN** the modal shows a loading state, its title carries no run count, and it does not show "No runs recorded yet"

#### Scenario: A failed run-history fetch is reported
- **WHEN** the run-history modal is open and its fetch fails
- **THEN** the modal shows an error state, its title carries no run count, and it does not show "No runs recorded yet"

#### Scenario: A run finishing during an in-flight fetch still refreshes
- **WHEN** a run-history fetch is in flight and a run started or observed on the page reaches a terminal status
- **THEN** a further run-history fetch is issued, and the list shown reflects that later fetch even if the earlier
  response arrives last; a list already shown in this page open stays visible while the refresh is in flight

#### Scenario: A finished run still refreshes run history
- **WHEN** a run started or observed on the page reaches a terminal status
- **THEN** run history is refreshed, so an open or later-opened modal lists that run
