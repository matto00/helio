## ADDED Requirements

### Requirement: Batch create places every created panel

`POST /api/panels/batch` SHALL store a layout item at every breakpoint for every panel it creates, in the same
transaction as the panels, under the create-time placement rule (stacked in request order below the breakpoint's
existing items). Each created panel in the response SHALL carry `layouts`: the item stored for it in each of `lg`,
`md`, `sm` and `xs`. A rejected batch SHALL leave the stored layout unchanged.

#### Scenario: Batch items are stacked and returned
- **WHEN** a batch creates a `text` panel and an `output` panel on a dashboard with an empty layout
- **THEN** each response panel carries `layouts` for all four breakpoints, the stored layout equals those items, the
  second panel sits below the first in every breakpoint, and no two items overlap

#### Scenario: Rejected batch writes no layout
- **WHEN** a batch is rejected with `400` because one item is invalid
- **THEN** the dashboard's stored layout is unchanged
