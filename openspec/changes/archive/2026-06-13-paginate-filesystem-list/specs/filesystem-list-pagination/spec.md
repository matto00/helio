## ADDED Requirements

### Requirement: ListPage model carries paginated results and an opaque cursor
The backend SHALL define a `ListPage` case class in `com.helio.infrastructure` with two fields:
- `names: Seq[String]` — the object/file names returned for this page
- `nextCursor: Option[String]` — an opaque token for the next page; `None` when this is the last or only page.

#### Scenario: ListPage with more results provides a nextCursor
- **WHEN** a list call returns fewer than the total matching objects
- **THEN** `nextCursor` is `Some(token)` where `token` is a non-empty string usable in the next list call

#### Scenario: ListPage on the final page has no cursor
- **WHEN** a list call returns the last (or only) set of matching objects
- **THEN** `nextCursor` is `None`

#### Scenario: ListPage for empty prefix has no cursor and empty names
- **WHEN** no objects match the given prefix
- **THEN** `names` is empty and `nextCursor` is `None`

### Requirement: FileSystem.list accepts cursor and pageSize parameters
The `FileSystem` trait SHALL define the paginated list method as:
`list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage]`
replacing the previous `list(prefix: String): Future[Seq[String]]` signature.

#### Scenario: list called without cursor returns first page
- **WHEN** `list(prefix)` is called (cursor and pageSize use defaults)
- **THEN** the first page of matching names is returned with up to 1000 entries

#### Scenario: list called with cursor returns subsequent page
- **WHEN** `list(prefix, cursor = Some(token), pageSize = N)` is called with a token from a prior call
- **THEN** the next up-to-N names after the cursor position are returned

#### Scenario: list called with pageSize smaller than total returns partial page
- **WHEN** there are 5 matching objects and `list(prefix, pageSize = 2)` is called
- **THEN** exactly 2 names are returned and `nextCursor` is `Some(_)`

### Requirement: LocalFileSystem uses cursor as an integer offset for lazy pagination
The `LocalFileSystem.list` implementation SHALL sort matching file paths, skip the number of entries indicated by `cursor.map(_.toInt).getOrElse(0)`, and return the next `pageSize` entries. The `nextCursor` SHALL be `Some((offset + pageSize).toString)` when more entries remain, or `None` when the last entry has been returned.

#### Scenario: Single page of results on local filesystem
- **WHEN** a prefix directory contains 3 files and `list(prefix, pageSize = 10)` is called
- **THEN** all 3 names are returned and `nextCursor` is `None`

#### Scenario: Multi-page iteration on local filesystem
- **WHEN** a prefix directory contains 5 files and `list(prefix, pageSize = 2)` is called
- **THEN** the first 2 names are returned with `nextCursor = Some("2")`
- **WHEN** `list(prefix, cursor = Some("2"), pageSize = 2)` is called
- **THEN** names 3 and 4 are returned with `nextCursor = Some("4")`
- **WHEN** `list(prefix, cursor = Some("4"), pageSize = 2)` is called
- **THEN** name 5 is returned with `nextCursor = None`

#### Scenario: Empty prefix on local filesystem
- **WHEN** no files exist under the prefix
- **THEN** `names` is empty and `nextCursor` is `None`

#### Scenario: Prefix resolves to a single file on local filesystem
- **WHEN** `prefix` matches a single regular file (not a directory) and `list(prefix)` is called with `cursor = None`
- **THEN** `names` contains the single relative path and `nextCursor` is `None`
- **WHEN** `list(prefix, cursor = Some("1"))` is called after the first page
- **THEN** `names` is empty and `nextCursor` is `None`
