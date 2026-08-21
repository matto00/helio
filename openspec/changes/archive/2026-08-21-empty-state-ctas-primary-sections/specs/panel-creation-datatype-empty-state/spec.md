## ADDED Requirements

### Requirement: A data-type filter matching nothing renders an empty state, not a bare status line
The panel-creation data-type step SHALL render the shared empty-state primitive, rather than a bare
status paragraph, when its filter input narrows a non-empty registry to zero rows. It SHALL name the
query that produced the result, SHALL use a title and icon distinct from the no-types-exist state already
rendered on this step, and SHALL offer an action that clears the filter.

This filtered state SHALL NOT be confused with the no-types-exist state: the latter means the registry is
genuinely empty and directs the user to create a pipeline, while the former means the registry has types
that this query did not match, and the resolution is to clear the query.

#### Scenario: A query matching no data types renders the filtered empty state
- **WHEN** the registry holds at least one data type and the filter query matches none of them
- **THEN** the step renders an empty state naming the query, with a clear-filter action

#### Scenario: Clearing the query restores the data-type list
- **WHEN** the clear-filter action in that empty state is activated
- **THEN** the filter query resets and the data-type cards render again

#### Scenario: An empty registry still renders the pipeline guidance, not the filtered state
- **WHEN** no registry data types exist at all
- **THEN** the existing no-types-exist empty state renders, directing the user toward creating a pipeline,
  and the filtered wording is not shown
