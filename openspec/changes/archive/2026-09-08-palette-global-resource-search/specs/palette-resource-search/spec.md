## Purpose
Lets a user find their own dashboards, data sources, data pipelines and outputs by typing a name into the
command palette, and open the matched resource directly, so navigating to a known resource does not require
knowing where it lives.

## ADDED Requirements

### Requirement: Typing finds the user's resources by name
Typing a query into the command palette SHALL present matching dashboards, data sources, data pipelines and
outputs, grouped by kind, ranked so that closer matches appear first. Results SHALL be presented alongside
the palette's existing actions rather than replacing them.

#### Scenario: A resource is found by name
- **WHEN** the user types part of a resource's name
- **THEN** that resource appears as a result, under a heading for its kind

#### Scenario: Closer matches rank higher
- **WHEN** several resources match a query with differing closeness
- **THEN** the closer matches are presented first

#### Scenario: Existing palette actions are not displaced
- **WHEN** a query matches both a resource and an existing palette action
- **THEN** both are presented

### Requirement: Selecting a result opens that resource
Selecting a result SHALL open the resource it names, for every searchable kind — including a resource that
lives inside another and is presented as a sub-view of it, and one whose location is not expressed in the
address bar.

#### Scenario: Each kind opens correctly
- **WHEN** the user selects a matching dashboard, data source, data pipeline, or output
- **THEN** the application opens that resource, in each case

#### Scenario: A nested resource opens presented, not merely contained
- **WHEN** the user selects an output result
- **THEN** the application opens its pipeline with that output presented, rather than merely opening the
  pipeline

### Requirement: Searching stays responsive
Search SHALL NOT block typing. Matching SHALL be deferred so that a fast typist is not made to wait, and the
results presented SHALL correspond to the query as last typed.

#### Scenario: Typing is never blocked
- **WHEN** the user types quickly
- **THEN** input remains responsive

#### Scenario: Results match the final query
- **WHEN** the user types a query and stops
- **THEN** the results shown correspond to what was typed, not to an earlier partial query
