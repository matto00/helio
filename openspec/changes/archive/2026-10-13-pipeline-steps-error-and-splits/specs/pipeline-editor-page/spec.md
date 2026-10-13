## ADDED Requirements

### Requirement: A failed steps fetch shows an error with Retry

When the steps fetch issued by the current mount of the pipeline editor fails, the Steps tab SHALL show a visible,
human-readable error with a Retry control in place of the step river. It SHALL NOT show the empty editor, the
"No steps yet" empty state, or any Add-step control while the steps are unknown, and the footer SHALL NOT report a
step count of 0. Activating Retry SHALL re-issue the steps fetch for the current pipeline, show the steps loading
placeholder while it is in flight, and on success render the pipeline's persisted steps as a first open would, including re-requesting the pipeline's analyze
result when the earlier analyze request had also failed.

#### Scenario: Failed steps fetch shows the error, not the empty editor

- **WHEN** the pipeline loads but the steps fetch for this mount rejects
- **THEN** the Steps tab shows the steps error with a Retry button, and neither "No steps yet" nor an Add-step control
  is shown

#### Scenario: Retry recovers the steps

- **WHEN** the steps error is showing and the user activates Retry, and the steps fetch then succeeds
- **THEN** the steps loading placeholder shows while the fetch is in flight, and then the pipeline's persisted step
  cards render

#### Scenario: Retry that fails again keeps the error

- **WHEN** the user activates Retry and the steps fetch rejects again
- **THEN** the steps error with Retry is shown again
