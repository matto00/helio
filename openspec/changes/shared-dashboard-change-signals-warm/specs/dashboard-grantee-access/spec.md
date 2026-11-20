## MODIFIED Requirements

### Requirement: Grantee panels refresh when a run finishes

On a dashboard the caller does not own, while the page is visible, the client SHALL re-read the dashboard panel status periodically and, when a panel's latest stored-data capture time advances, SHALL re-read that panel's rows through the per-panel rows route. The first status read SHALL only set the baseline and SHALL NOT trigger a refresh, except for a panel whose rows were restored from the warm tab cache: for it the first status read SHALL compare against the restored rows' capture time and SHALL trigger the refresh when the panel's stored data is later.

#### Scenario: A run finishes while a viewer watches

- **WHEN** the owner runs the pipeline feeding a panel on a shared dashboard a dashboard-only viewer has open, and the run succeeds
- **THEN** the viewer's panel shows the new rows without a page reload, read through the per-panel rows route, with no `/api/outputs/*` or `/api/pipelines/*` request

#### Scenario: A run between the last change check and a warm return still refreshes

- **WHEN** a viewer returns to a warm shared dashboard whose panel received new data after its rows were captured, but before the client's change signals reported it
- **THEN** the first panel status read re-reads that panel's rows through the per-panel rows route

#### Scenario: A shared panel remounted after status polling stopped still refreshes

- **WHEN** a viewer leaves a shared dashboard (its panel status polling stops), the panel's data advances, and the viewer returns within seconds without a warm-cache restore
- **THEN** the panel's rows are re-read through the per-panel rows route and show the new data
