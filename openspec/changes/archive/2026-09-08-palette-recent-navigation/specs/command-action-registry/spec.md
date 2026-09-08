## ADDED Requirements

### Requirement: A contributor may add entries to the empty-query default
The palette SHALL allow a contributor to add entries to its empty-query presentation. Contributed entries
SHALL be presented **in addition to** the palette's existing empty-query content, ordered ahead of it, and
SHALL NOT displace or suppress it. When no contributor supplies entries, the empty-query presentation SHALL
be exactly what it is today.

#### Scenario: Contributed entries are added ahead of the existing content
- **WHEN** the palette is opened with an empty query and a contributor has supplied entries for that state
- **THEN** those entries are presented first, and every section the palette already presented on an empty
  query is still presented after them

#### Scenario: No contributed entries leaves today's behavior intact
- **WHEN** no contributor supplies empty-query entries
- **THEN** the palette presents exactly what it presents today, unchanged

#### Scenario: Contributed entries never suppress existing sections
- **WHEN** contributed entries are present
- **THEN** no previously-presented section is removed from the empty-query view
