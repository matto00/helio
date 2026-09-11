## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

For each round-1 change request (CR), I re-checked the cited code, not just the revised wording.

- **CR3 (0-based seq, reuse replaceDatasetRows): RESOLVED.**
  - V106 L74-82 uses `elem.ord - 1` and documents 0-based.
  - `insertDatasetSource` (DataSourceRepository.scala ~L329) and `replaceDatasetRows` (L359) both use `idx.toLong`.
  - Design D2 now uses `COALESCE(MAX(seq), -1) + 1`, and the spec scenario "empty source starts at seq 0" matches.
  - D2 and tasks 1.4 reuse `replaceDatasetRows` rather than adding a parallel method.
- **CR2 (inferred_schema): RESOLVED in intent.**
  - `PipelineRowJson.staticColumnRuntimeType(declaredType, cells)` (L120) is column-wise over all cells. Once a column has any non-null cell, the result depends on the cells, so recomputing it over the full post-write set (D3, tasks 1.2(f)) is correct.
  - Test 5.8 (null to numeric) exercises the right branch: an all-null column falls back to the declared type, and one numeric cell flips it to `float`.
- **CR4 (per-row updatedAt): RESOLVED.** D6, tasks 2.3, 5.11, and the spec requirement all return `{rows:[{id,seq,updatedAt}], updatedAt}`.
- **CR5 (body shape and empty arrays): RESOLVED.** D6 and the spec pin:
  - the body as `{"rows": [[...]]}`, positional;
  - `POST []` returns 400, and `PUT []` clears the rows;
  - validator error indices are 0-based and relative to the request.
- **CR6 (byte size): RESOLVED.**
  - `grep -rn "max-content-length|withSizeLimit|toStrictEntity|withoutSizeLimit" backend/src/main` finds only a comment in ContentSourceSupport.scala. That comment is about the *client*-side setting, not the server.
  - `backend/src/main/resources/` holds only `application.conf` and `logback.xml`, and neither sets a server parsing override.
  - So Pekko's server default `max-content-length` (8m) applies, which is what D7 claims.
- **CR1 (lock covers every writer, checks run inside the transaction): PARTIALLY RESOLVED. See CR-A below.**
  - Resolved:
    - Append (tasks 1.2) now reads the schema, count, `MAX(seq)`, and cells, then validates and inserts, all under `lockSource` in one `withUserContext` DBIO.
    - The concurrent-count test (5.7) and the refresh-races-append test (5.3) are planned.
    - `lockSource` is added to `replaceDatasetRows`.
  - Not resolved: the replace path shared by refresh and PUT contradicts itself. Details follow.
- Ground truth for CR-A: the current `replaceDatasetRows(id, declaredColumns, rows, inferredSchema, updatedAt, user): Future[Option[DataSource]]` (L359-381):
  - takes `declaredColumns` and `inferredSchema` as caller-computed arguments;
  - writes `dataset_schema = declaredColumns` unconditionally;
  - generates row UUIDs internally;
  - returns only the `DataSource`.
- `applyStaticRefresh` (DataSourceService.scala L709-760) validates against the **new** declaration it is about to write, computes `inferredSchema` from it, and passes both in. Per the HEL-1076 D8 comment, that is intended.

### Verdict: REFUTE

Five of the six CRs are resolved against ground truth. CR1 still has a real hole on the replace path. The artifacts give two incompatible instructions for the same method, and the reading that tasks 1.4 spells out reintroduces a race D1 claims to close.

### Change Requests

1. **CR-A: Pin the new `replaceDatasetRows` contract, which must serve both refresh and PUT without a pre-lock read. (design D1/D2, tasks 1.3/1.4)**
   - **What conflicts:**
     - D1 says all three writers do "the lock, a fresh read of `dataset_schema`/current row count, validation, and the write" inside one DBIO. Tasks 1.3 repeats this for the existing `replaceDatasetRows`: "read the declared schema and validate the incoming set inside the same locked transaction."
     - That is wrong for refresh. Refresh validates against the *new* declaration it is writing (DataSourceService.scala ~L730-740, HEL-1076 D8), not the stored one. Validating a refresh against the freshly read *old* schema would break refresh whenever the declaration changes.
     - Tasks 1.4 has PUT call `replaceDatasetRows` "passing the source's *current* `declaredColumns` unchanged and a freshly recomputed `inferredSchema`." Those values can only be computed by the service *before* the lock, since the method takes them as arguments.
   - **The race:**
     - PUT reads declaration D_old outside the lock.
     - A refresh commits D_new plus new rows.
     - PUT gets the lock and writes `dataset_schema = D_old`, along with rows validated against D_old and an `inferredSchema` built from D_old types.
     - Result: the refresh's schema change is silently reverted. This is the exact check-then-act CR1(ii) required closing, and D1 claims it is closed.
   - **Required:**
     - (a) State the new signature. Two acceptable options:
       - `declaration: Option[Vector[DatasetFieldDeclaration]]`, where `Some` means refresh (validate against and write the supplied declaration) and `None` means PUT (read `dataset_schema` under the lock, validate against it, and leave it unchanged).
       - Two thin entry points over one shared locked DBIO.
     - (b) Both validation (`DatasetRowValidator.validate`) and the `inferredSchema` computation run inside the locked DBIO, from the declaration actually in effect under the lock. They must not be caller-supplied for PUT.
     - (c) The method must return what D6's PUT response needs: the inserted rows' `id`/`seq`/`updatedAt` plus the source's `updatedAt`. Today it returns only `Option[DataSource]` and discards the UUIDs it generates.
     - (d) Fix D1's "all three" sentence so it no longer claims refresh validates against the freshly read schema.
     - (e) Add a test for PUT racing a refresh that changes the declaration. After both commit, `dataset_schema` and the stored rows must agree: the final declaration is whichever writer serialized last, and every stored row validates against it.

### Non-blocking notes

- `DatasetRowValidator.validate` returns `validatedRows`, which may be transformed (for example, defaults applied). Store and measure the *validated* rows, not the raw request rows, on append and PUT, as create and refresh already do. The `inferred_schema` computation should also use the validated cells.
- `staticColumnRuntimeType` takes the declared type as a `String`. The stored declaration is `DatasetFieldDeclaration` with a `DataFieldType`, so make sure the wire value passed in canonicalizes the way create/refresh's `col.type` does.
- Tasks 5.9 (non-superuser role) is still the right call. MISTAKES.md notes that dev/CI connect as superuser, so `lockSource`'s `FOR UPDATE` under RLS is only proven under the real app role.
