## Purpose

Defines how the command palette turns a typed query into an ordered, grouped result list, and what it shows
when the query is empty or matches nothing.

## ADDED Requirements

### Requirement: An empty query shows the full default list
When the query is empty, the palette SHALL show all currently registered actions, grouped by section, in a
stable order. The first result SHALL be active so `Enter` is immediately meaningful.

#### Scenario: Empty query lists every registered action
- **WHEN** the palette opens with an empty query
- **THEN** every registered action is listed, grouped by section, with the first result active

### Requirement: Queries match against title and keywords
The palette SHALL match a query against each action's title and its keywords, case-insensitively. Matching
SHALL tolerate a query that is a subsequence of the target as well as a contiguous substring, so an
abbreviation of a title still finds it. An action matched only through its keywords SHALL still be shown.

#### Scenario: Substring query matches a title
- **WHEN** the user types a contiguous fragment of an action's title in any casing
- **THEN** that action appears in the results

#### Scenario: Subsequence query matches a title
- **WHEN** the user types letters that appear in order within an action's title but not contiguously
- **THEN** that action appears in the results

#### Scenario: Keyword-only match is included
- **WHEN** the query matches one of an action's keywords but no part of its title
- **THEN** that action appears in the results

### Requirement: Results are ranked with stronger matches first
The palette SHALL order matched results so that stronger matches rank above weaker ones: a match at the start
of the title outranks a match later in the title, a contiguous substring match outranks a non-contiguous
subsequence match, and a title match outranks a keywords-only match. Results with equal strength SHALL retain
a stable, deterministic relative order rather than reordering arbitrarily between renders.

Actions that declare the local-filtering opt-out defined by the `command-action-registry` capability SHALL NOT
be scored against these tiers, since they were matched by whoever produced them and carry no local match
strength. Within a section, such actions SHALL be ordered after all locally-matched actions and SHALL retain
the relative order their registrant supplied.

#### Scenario: Title-prefix match ranks first
- **WHEN** one action's title starts with the query and another merely contains it later
- **THEN** the action whose title starts with the query is listed first

#### Scenario: Title match outranks a keywords-only match
- **WHEN** one action matches the query in its title and another matches only in its keywords
- **THEN** the title match is listed first

#### Scenario: Opted-out actions rank after matched actions in the same section
- **WHEN** one section contains both locally-matched actions and actions declaring the opt-out
- **THEN** the locally-matched actions are listed first, followed by the opted-out actions in the order their
  registrant supplied them

#### Scenario: Equal-strength results are stably ordered
- **WHEN** two results match with equal strength and the query is unchanged
- **THEN** their relative order is the same on every render

### Requirement: Results are grouped under section labels
The palette SHALL group results under their action's `section`, rendering each group's label in the shared
mono eyebrow style. Actions with no section SHALL be grouped consistently rather than dropped. Keyboard
navigation SHALL traverse the flattened visual order across all groups, so arrowing past the last item of one
group moves into the first item of the next.

#### Scenario: Results render under their section labels
- **WHEN** results span more than one section
- **THEN** each section renders its own eyebrow-styled label above its results

#### Scenario: Arrow navigation crosses group boundaries
- **WHEN** the last result of a group is active and the user presses `ArrowDown`
- **THEN** the first result of the following group becomes active

#### Scenario: Sections with no matching results are not rendered
- **WHEN** a query matches no action in a given section
- **THEN** that section's label is not rendered

### Requirement: A query with no matches shows the shared empty state
When a non-empty query matches no registered action, the palette SHALL render the application's shared empty
state in place of the result list, and `Enter` SHALL do nothing.

#### Scenario: No matches renders the empty state
- **WHEN** the user types a query that matches no action
- **THEN** the shared empty state is rendered instead of a result list

#### Scenario: Enter with no matches is a no-op
- **WHEN** no results are shown and the user presses `Enter`
- **THEN** no action runs and the palette stays open
