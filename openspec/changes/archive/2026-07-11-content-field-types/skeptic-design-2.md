## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Round 1 CR1 (row correlation on `binary_refs`)** — design.md Decision 4 now specifies
  `row_index INT NOT NULL` and unique index `(data_type_id, row_index, field_name)`; spec.md's
  "binary_refs table..." requirement and its migration scenario list the same columns/index;
  tasks.md 2.2 matches. Cross-checked `V29__data_type_rows.sql` (read in full):
  `data_type_rows` is keyed `UNIQUE (data_type_id, row_index)`, confirming `row_index INT` is the
  correct, type-consistent correlation column to mirror. `findByDataTypeIdAndRow` is specified in
  spec.md's "BinaryRefRepository provides an overwrite-and-lookup contract" requirement and
  tasks.md 2.3. **Resolved.**
- **Round 1 CR2 (dual-storage relationship)** — design.md Decision 3 now states explicitly:
  "This inline JSONB value is the sole read path for row data." Decision 4 redefines
  `binary_refs` as "a row-correlated secondary index, not a second read path," explicitly listing
  its purposes (lifecycle mgmt, GC, asset browsing) and stating it is "never an independent
  source of truth pipeline ops read from instead of the row." The write contract now specifies
  `overwriteForDataType(dataTypeId, refs)` as a transactional delete-all-then-bulk-insert — read
  `DataTypeRowRepository.scala` in full: `overwriteRows` does exactly this pattern (single
  `sqlu` DELETE + per-row bulk INSERT wrapped in `ctx.withSystemContext(DBIO.seq(...).transactionally)`),
  so the claimed "mirrors `overwriteRows`'s semantics exactly" is accurate, not hand-waved. Old
  incoherence (single `insert`/`delete(id)` claimed "analogous" to a delete-and-replace write
  path) is gone — spec.md now states "There is no singular `insert`/`delete(id)`." **Resolved.**
- **Round 1 CR3 (missing schema-inference spec delta)** — `specs/schema-inference/spec.md` now
  exists in this change directory as a `MODIFIED Requirements` delta. Diffed directly against the
  real canonical `openspec/specs/schema-inference/spec.md` (read lines 79-84): original said
  "exactly five variants" + 5-string `asString` scenario; the delta updates to "seven variants,"
  lists all 7 (`StringType..TimestampType, StringBodyType, BinaryRefType`), adds the category
  mapping note, and extends the `asString` scenario to all 7 wire strings. This is a faithful,
  correctly-scoped modification of the existing requirement (same requirement title, preserved
  structure). proposal.md's "Modified Capabilities" section now lists `schema-inference` with an
  accurate description of what changed ("vocabulary requirement itself," no inference-behavior
  change). **Resolved.**
- **Round 1 CR4 (proposal/tasks JSON-wiring mismatch)** — proposal.md's Impact section now reads
  "No `DataTypeProtocol`/JSON-formatter changes are needed — `BinaryRef` has no REST route and no
  JSONB column in `binary_refs` (flat scalar columns only)..." Grepped `JsonProtocols.scala` again
  (no `DataFieldType`/`InferredField`/`BinaryRef` hits) — still true, and now correctly reflected.
  tasks.md has no orphaned JSON-wiring task. **Resolved.**
- **`DataFieldType` current state** — `backend/src/main/scala/com/helio/domain/model.scala:209-224`
  re-read: unchanged 5-variant sealed trait, `asString` only, no `fromString`/`category`. Matches
  design.md's Context.
- **`SchemaInferenceEngine.widenType`** — re-read lines 133-159: exhaustive match over the 5
  current variants, no wildcard. Grepped `backend/build.sbt`: no `-Xfatal-warnings`/`-Werror`
  present, confirming the non-exhaustive-match consequence stays a compiler warning as design.md
  Decision 2 claims (non-blocking, matches round 1's own non-blocking note; not re-flagged here).
- **Migration numbering** — `backend/src/main/resources/db/migration/` latest is
  `V45__hash_session_tokens.sql`; tasks.md 2.2 specifies `V46__binary_refs.sql`. Correct next
  sequence number, no collision.
- **Frontend target file** — `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx` read: the
  5-option hardcoded `Select` at lines 126-131 confirmed still present and unchanged, correctly
  the target of Decision 5/task 3.1. `InferredFieldsTable.tsx` correctly left untouched per
  Decision 5's reasoning (no connector infers content types yet).
- **New-issue check** — cross-checked spec.md's `BinaryRef` column list (id, data_type_id,
  row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at) against
  tasks.md 2.1's case-class field list (id, dataTypeId, rowIndex, fieldName, storageKey, mimeType,
  filename, sizeBytes, createdAt) and design.md Decision 4's column list — all three agree in
  name and order. No new spec/tasks inconsistency introduced by the revision.

### Verdict: CONFIRM

### Non-blocking notes

- Design.md Decision 1's illustrative Scala snippet — `sealed trait FieldTypeCategory { case
  object Structured; case object Content }` — is not valid Scala as literally written (nested
  case objects in a trait body don't extend the outer trait; the codebase's own
  `RestApiAuth`/companion-object pattern at `model.scala:195-199` is the correct precedent). This
  is clearly shorthand/illustrative prose, and tasks.md 1.1 doesn't propagate the bad syntax, so
  it's not blocking — but worth a one-line fix in design.md so a literal-minded executor doesn't
  copy it verbatim.
- The cross-table write invariant ("`overwriteRows` and `overwriteForDataType` SHALL be called in
  the same operation") is stated as a SHALL on future connector code, with no atomicity mechanism
  specified (they'd be two separate DB transactions unless a downstream ticket composes them into
  one `DBIO`). Correctly out of scope for this ticket (no connector/call-site exists yet), and the
  Risks section already acknowledges the drift risk — flagging only so HEL-214/216's design
  explicitly revisits whether the two writes need to be one transaction.
