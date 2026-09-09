## Purpose
Defines Output-scoped persisted column-filter state for table panels — the storage shape on
`TableOutputConfig`, the match predicate, composition with column sort, and the disclosure
obligations that follow from filtering a row set the client has only partially fetched.

## ADDED Requirements

### Requirement: Filter state persists on the Output as a flat sibling
Table filter state SHALL be stored as `columnFilters` on the Output's `TableOutputConfig`, a flat
top-level sibling of `columnSort`, carrying an optional quick-filter term and an optional per-column
term map. It SHALL NOT be stored on the panel placement record, and SHALL NOT be nested inside any
other config key. Reading a `columnFilters` that is absent or malformed SHALL yield no filtering
rather than an error. An empty or whitespace-only term SHALL be treated as no filter and SHALL NOT
be persisted.

Because the state lives on the Output, filters SHALL apply to every panel bound to that Output **on
load**. Panels do not converge live: filtering one panel SHALL NOT narrow another panel in the same
session.

#### Scenario: A filtered table reopens filtered
- **WHEN** a table panel's filter has been set and the Output config is re-read after a reload
- **THEN** the table renders with that filter still applied

#### Scenario: Absent filter state renders every loaded row
- **WHEN** a table panel's Output config carries no `columnFilters`
- **THEN** every loaded row renders and no filter term is shown as active

#### Scenario: A malformed stored filter is ignored
- **WHEN** a stored `columnFilters` is not an object, or carries a non-string `quick`, or column
  entries whose values are not strings
- **THEN** the table renders unfiltered rather than throwing

#### Scenario: Clearing a filter does not persist an empty term
- **WHEN** a user clears a previously-set column filter
- **THEN** the persisted config no longer carries a term for that column, rather than carrying an
  empty string

#### Scenario: Filtering one panel does not narrow its sibling in the same session
- **WHEN** two panels are bound to the same Output and both are on screen, and one is filtered
- **THEN** the other panel's rows are unchanged until it is next loaded

### Requirement: A row matches on the text its cells render
A term SHALL match a cell when the cell's rendered text contains the term, case-insensitively, with
surrounding whitespace on the term ignored. The match SHALL be evaluated against the same rendered
text the cell displays, so that every match is visible in the cell that produced it — including for
columns whose values are objects, which render as serialized text. The quick-filter term SHALL match
a row when ANY visible column matches. Per-column terms SHALL match only their own column, and
multiple column terms SHALL AND together. The quick-filter and per-column terms SHALL AND together.

#### Scenario: Matching is case-insensitive
- **WHEN** a column contains "EMEA" and the term "emea" is entered
- **THEN** that row matches

#### Scenario: Quick-filter matches across columns
- **WHEN** a quick-filter term matches only one column's value in a row
- **THEN** that row is retained

#### Scenario: Multiple column filters narrow together
- **WHEN** two different columns each carry a term
- **THEN** only rows matching BOTH terms are retained

#### Scenario: An object-valued cell matches its rendered text
- **WHEN** a column's values are objects rendered as serialized text, and a term appearing in that
  serialized text is entered
- **THEN** the row matches, and the matching text is visible in the cell

#### Scenario: An empty term filters nothing
- **WHEN** a filter term is empty or whitespace only
- **THEN** every row is retained for that term

### Requirement: Filtering composes with column sort
Filtering SHALL be applied to the loaded row set before ordering, and SHALL NOT alter the sort state
or the sorted order of the rows that remain. Sorting SHALL NOT alter which rows a filter retains.

#### Scenario: A filtered table stays sorted
- **WHEN** a sort is active and a filter is then applied
- **THEN** the retained rows remain in the sorted order

#### Scenario: Sorting a filtered table does not restore filtered-out rows
- **WHEN** a filter is active and the sort direction is then changed
- **THEN** only the retained rows are reordered

### Requirement: The UI states the scope of a filtered result and never implies a whole-Output count
Truncation SHALL be determined from a signal that is accurate regardless of which row-supply branch
a panel renders through — a panel whose rows arrive already keyed and a panel whose rows arrive
positionally may both be showing a truncated set. When the loaded row set is truncated and a filter
is active, any displayed match count SHALL be
paired with the size of the loaded set it was computed over, and SHALL NOT be rendered as a bare
number. When the loaded row set is NOT truncated, the disclosure SHALL NOT be shown, because the
result is complete.

When a filter matches no loaded row AND the loaded row set is truncated, the empty state SHALL say
that no match was found among the rows loaded so far, SHALL indicate that more rows may match, and
SHALL offer a clear-filters action. It SHALL additionally offer a load-more action ONLY where a
load-more affordance is available to that surface; where none is, the disclosure text SHALL still be
shown with clear-filters alone. When a filter matches no loaded row
and the set is NOT truncated, the empty state SHALL report no matches and offer a clear-filters
action.

#### Scenario: A truncated filtered count is scoped
- **WHEN** a filter is active and more rows remain unfetched
- **THEN** the displayed count states the number of loaded rows it was computed over

#### Scenario: A complete filtered result carries no scope caveat
- **WHEN** a filter is active and every row has been loaded
- **THEN** no loaded-scope disclosure is shown

#### Scenario: Truncation is reported accurately on every row-supply branch
- **WHEN** a panel renders a truncated row set through a branch that carries no pagination
  affordance of its own
- **THEN** the disclosure treats the set as truncated, and no unqualified count and no
  complete-result empty state is shown

#### Scenario: A truncated empty state without a load-more affordance still discloses scope
- **WHEN** a filter matches no loaded row, more rows remain unfetched, and the surface offers no
  load-more action
- **THEN** the empty state still names the loaded scope and says more rows may match, offering
  clear-filters alone

#### Scenario: Truncated empty results offer to load more
- **WHEN** a filter matches no loaded row and more rows remain unfetched
- **THEN** the empty state names the loaded scope and offers both clear-filters and load-more

#### Scenario: Complete empty results do not offer to load more
- **WHEN** a filter matches no loaded row and every row has been loaded
- **THEN** the empty state reports no matches and offers only clear-filters

### Requirement: Filter state is written as a minimal config patch by a permitted caller
Persisting filters SHALL send only the changed key (`{ config: { columnFilters } }`) and SHALL NOT
re-send the rest of the Output's config. The write SHALL happen only in response to a user editing a
filter — never on mount. When the caller cannot write the Output, the filter SHALL still apply on
screen and no write SHALL be attempted, with no error surfaced and no control disabled or hidden.

#### Scenario: Filtering preserves the Output's other config
- **WHEN** a filter is persisted for an Output whose config carries `fieldMapping`, `columnOrder`
  and `columnSort`
- **THEN** the request body carries only `columnFilters`, and a subsequent read still returns the
  original values

#### Scenario: Merely rendering a table panel attempts no filter write
- **WHEN** a table panel is rendered and no filter is edited
- **THEN** no config write is attempted

#### Scenario: A grantee filters a shared dashboard's table without an error
- **WHEN** a user who does not own the Output enters a filter term
- **THEN** the rows narrow, no config write is attempted, and no error is surfaced
