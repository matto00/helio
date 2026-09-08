## Purpose
Makes the collections that search reads available regardless of where the user happens to be in the
application, and states plainly which collections are searchable at any moment, so that "no results" can be
distinguished from "not yet searched".

## ADDED Requirements

### Requirement: Searchable collections are made available regardless of route
The application SHALL ensure each searchable collection is fetched when search needs it, rather than relying
on the user having previously visited the route that happens to load it. This SHALL hold on the application's
default landing route, where no other route has been visited.

#### Scenario: Search works on the default route with no prior navigation
- **WHEN** the user opens the application at its default route, does not navigate anywhere, and searches for
  a resource that exists
- **THEN** that resource is found

#### Scenario: A collection is not fetched repeatedly
- **WHEN** a collection has already been fetched
- **THEN** searching again does not refetch it

### Requirement: Coverage is reported from live state, never asserted
While any searchable collection is not yet available, the application SHALL tell the user **which** kinds are
currently being searched. That statement SHALL be derived from the actual availability of each collection at
that moment. A fixed or assumed list SHALL NOT be presented, so the statement cannot drift from what is
actually searched.

#### Scenario: Partial coverage names the covered kinds
- **WHEN** some searchable collections are available and others are still being fetched
- **THEN** the user is told which kinds are being searched, naming them

#### Scenario: Full coverage says nothing
- **WHEN** every searchable collection is available
- **THEN** no coverage caveat is shown

#### Scenario: The statement tracks reality
- **WHEN** a collection becomes available while the coverage statement is shown
- **THEN** the statement updates to include that kind, without the set of kinds being restated anywhere as a
  fixed list

### Requirement: A collection that could not be fetched is reported as such
When a searchable collection cannot be fetched, the application SHALL tell the user that this kind could not
be searched, distinctly from telling them it is still being fetched. A collection that failed SHALL NOT
simply be omitted from the covered kinds, because that would leave "no results" for that kind
indistinguishable from a failure the user was never told about.

#### Scenario: A failed collection is named as failed
- **WHEN** one searchable collection cannot be fetched and the others are available
- **THEN** the user is told that kind could not be searched, in terms distinct from a kind still being
  fetched

#### Scenario: A failed collection is retried on a later explicit search
- **WHEN** the user opens the search again after a collection previously failed
- **THEN** that collection is attempted again

### Requirement: An empty result is distinguishable from an unsearched one
The application SHALL NOT present "nothing found" in a way that is indistinguishable from "not yet searched".
When a query yields no matches while collections are still being fetched, the user SHALL be able to tell that
the search is not yet complete.

#### Scenario: No matches while still indexing is not reported as no matches
- **WHEN** a query matches nothing and some collections are still being fetched
- **THEN** the user is not told there are no matches, but that the search is still in progress
