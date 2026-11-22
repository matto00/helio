## MODIFIED Requirements

### Requirement: Most-recent dashboard default selection
The system SHALL, when dashboard data loads and no prior selection exists, select the load target directly, using this precedence (the same precedence tab hydration uses): (1) the dashboard named by the authenticated `/dashboards/:id` URL when it is in the loaded list; (2) the signed-in user's saved active tab when it is in the loaded list; (3) no dashboard, when the user has a stored empty tab set; (4) when saved tabs survive pruning but none is active, the most recently viewed surviving tab; (5) otherwise the landing default: the first dashboard the user owns in the response (the backend sorts by most recently updated), or, when the user owns none, the first listed dashboard. The selection SHALL NOT pass through any other dashboard on the way to that target.

#### Scenario: Newest dashboard is selected by default
- **WHEN** dashboard data is loaded into frontend state with no deep link and no saved tab set
- **THEN** the selected dashboard is the first owned dashboard in the response, or the first listed dashboard when the user owns none

#### Scenario: Existing selection is preserved when still valid
- **WHEN** dashboard data refreshes and the current selected dashboard still exists
- **THEN** the frontend preserves the current selection instead of overriding it

#### Scenario: Deep link is selected directly on load
- **WHEN** the app loads at `/dashboards/B` while dashboard A is the landing default and B is in the list
- **THEN** every value `selectedDashboardId` takes during the load is `null` or `B`, never `A`

#### Scenario: Saved active tab is selected directly on load
- **WHEN** the app loads at `/dashboards` for a user whose saved active tab is C while A is the landing default
- **THEN** every value `selectedDashboardId` takes during the load is `null` or `C`, never `A`

#### Scenario: Surviving saved tabs with no active tab select the most recently viewed tab directly
- **WHEN** the app loads for a user whose saved tabs [D, E] survive pruning, none is active, E was viewed most recently, and A is the landing default
- **THEN** every value `selectedDashboardId` takes during the load is `null` or `E`, never `A`

#### Scenario: A stored empty tab set never selects the landing default
- **WHEN** the app loads at `/dashboards` for a user with a stored empty tab set while A is the landing default
- **THEN** `selectedDashboardId` stays `null` throughout the load

#### Scenario: Grantee deep link to a shared dashboard is selected directly
- **WHEN** a user who owns dashboard A loads `/dashboards/S`, where S is shared with them (editor or viewer) and A is their landing default
- **THEN** every value `selectedDashboardId` takes during the load is `null` or `S`, never `A`, and no request keyed on A (`/api/dashboards/A/...`) is issued during the load
