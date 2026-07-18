## ADDED Requirements

### Requirement: Applied proposal immediately appears in the dashboards list

When a dashboard proposal is applied from the Proposal Review UI, the Redux dashboards list SHALL be updated in the
same dispatch cycle as the successful apply response: the created dashboard MUST be present in the dashboards slice
`items` and MUST be the selected dashboard, without requiring a refetch, navigation, or reload.

#### Scenario: Apply with existing dashboards loaded

- **WHEN** the dashboards list has already been fetched (slice status "succeeded") and the user accepts a proposal
  that the server applies successfully
- **THEN** the created dashboard is present in the dashboards slice `items` and `selectedDashboardId` equals its id
  before the app navigates back to the dashboard view

#### Scenario: Apply from an empty workspace

- **WHEN** the workspace has zero dashboards (sidebar shows the "No dashboards yet" empty state) and the user
  accepts a proposal that the server applies successfully
- **THEN** the sidebar dashboard list renders the created dashboard — the empty state is not shown after the apply
  resolves

#### Scenario: Apply fails

- **WHEN** the apply-proposal request fails
- **THEN** the dashboards slice `items` and `selectedDashboardId` are unchanged and the Proposal Review UI surfaces
  the error message from the server response when one is provided

### Requirement: Apply-proposal flows through the dashboards slice

The apply-proposal frontend flow SHALL be implemented as a dashboards-slice async thunk whose fulfilled reducer
inserts the created dashboard and selects it, consistent with the duplicate and import flows. UI components MUST NOT
call the apply-proposal service directly and then rely on a refetch of the dashboards list.

#### Scenario: Thunk fulfilled reducer

- **WHEN** the apply-proposal thunk fulfills with the created dashboard
- **THEN** the reducer appends the dashboard to `items` and sets `selectedDashboardId` to its id
