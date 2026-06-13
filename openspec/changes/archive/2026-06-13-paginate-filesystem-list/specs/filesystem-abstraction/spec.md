## MODIFIED Requirements

### Requirement: FileSystem trait defines async storage operations
The backend SHALL expose a `FileSystem` trait in `com.helio.infrastructure` with the following methods, all returning `Future`:
- `write(path: String, bytes: Array[Byte]): Future[Unit]`
- `read(path: String): Future[Array[Byte]]`
- `delete(path: String): Future[Unit]`
- `exists(path: String): Future[Boolean]`
- `list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage]`

where `ListPage` is a case class defined in `com.helio.infrastructure` with fields `names: Seq[String]` and `nextCursor: Option[String]`.

#### Scenario: Trait is defined with correct signatures
- **WHEN** a developer creates a new `FileSystem` implementation
- **THEN** the compiler enforces all five method signatures including the paginated `list` overload
