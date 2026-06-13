## 1. Backend

- [x] 1.1 Add `ListPage` case class to `com.helio.infrastructure` (names: Seq[String], nextCursor: Option[String])
- [x] 1.2 Update `FileSystem` trait: replace `list(prefix): Future[Seq[String]]` with `list(prefix, cursor, pageSize): Future[ListPage]`
- [x] 1.3 Update `GcsFileSystem.list` to use `BlobListOption.pageSize`, `BlobListOption.pageToken` and `page.getNextPageToken`; remove `iterateAll()`
- [x] 1.4 Update `LocalFileSystem.list` to use sorted walk with cursor-offset skip and pageSize limit; encode cursor as decimal string offset

## 2. Tests

- [x] 2.1 Update `GcsFileSystemSpec` list tests: replace `iterateAll` mock with `Page` mock returning `.getValues` / `.getNextPageToken`
- [x] 2.2 Add `GcsFileSystemSpec` test: multi-page (mock two pages, check nextCursor on first, None on second)
- [x] 2.3 Add `GcsFileSystemSpec` test: empty prefix returns empty names and no cursor
- [x] 2.4 Add `GcsFileSystemSpec` test: list with cursor passes `BlobListOption.pageToken` to Storage.list
- [x] 2.5 Update `LocalFileSystemSpec` list tests to call `list(prefix)` and unpack `ListPage`
- [x] 2.6 Add `LocalFileSystemSpec` test: multi-page (5 files, pageSize=2, verify cursor chain)
- [x] 2.7 Add `LocalFileSystemSpec` test: empty prefix returns empty names and no cursor
- [x] 2.8 Add `LocalFileSystemSpec` test: prefix resolves to a regular file — first call (cursor=None) returns single name with nextCursor=None; call with cursor=Some("1") returns empty names with nextCursor=None
