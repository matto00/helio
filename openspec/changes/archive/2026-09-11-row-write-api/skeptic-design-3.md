## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Ground truth: the current code (re-read cold)**

- `DataSourceRepository.replaceDatasetRows` (DataSourceRepository.scala:359-381) has the signature `(id, declaredColumns, rows, inferredSchema, updatedAt, user): Future[Option[DataSource]]`.
  - It generates row UUIDs internally and discards them.
  - It takes no lock.
  - It writes `dataset_schema` unconditionally.
- `grep -rn replaceDatasetRows backend/src` finds exactly one production caller: `DataSourceService.applyStaticRefresh` at L756.
  - The test callers are all in DataSourceRepositorySpec.scala (L250, L263, L274, L278), and 1.3's rename will have to update them.
  - `createStatic` calls `insertDatasetSource` (L162), not `replaceDatasetRows`.
- `applyStaticRefresh` (L709-760) runs these steps in order:
  1. Validates column types (`invalidColumns`).
  2. Builds `declaredColumns` from the payload.
  3. Runs `DatasetRowValidator.validateDefault`.
  4. Runs `DatasetRowValidator.validate(declaredColumns, payload.rows)`, against the NEW declaration (HEL-1076 D8).
  5. Computes `inferredSchema` from `col.type` and the validated cells.
  6. Calls `replaceDatasetRows`.

**Round-2 CR-A, sub-item by sub-item**

- **(a) Signature pinned: RESOLVED.** Design D1 and tasks 1.3 pin `replaceRows(id, declaration: Option[Vector[DatasetFieldDeclaration]], rows, updatedAt, user)`. `Some` means refresh, which writes the supplied schema. `None` means PUT, which reads the current schema under the lock and keeps it.
- **(b) Schema resolution, validation and inferred_schema all run inside the lock: RESOLVED.**
  - D1 places the whole sequence inside the method's one transaction: `lockSource`, then effective-declaration resolution (`declaration.get`, or a fresh `SELECT dataset_schema` under the lock for `None`), then `validate`, delete/insert, the `inferred_schema` recompute, and the `data_sources` update.
  - `inferredSchema` is no longer a parameter, so PUT cannot pass a value computed before the lock.
  - Walked the race: PUT reads `D_old`, then refresh commits `D_new`, then PUT gets the lock. Under the new design, PUT's schema read happens after `FOR UPDATE` is granted. Postgres read-committed gives each statement a new snapshot, so it sees `D_new`, and PUT writes nothing to `dataset_schema`. The race is closed.
  - For refresh, validating inside the transaction against the caller's `Some(decl)` is equivalent to today's pre-call validation, because it is a pure function of the caller's inputs. The HEL-1076 D8 semantics are preserved.
- **(c) Return shape: RESOLVED.** The method returns `Vector[DatasetRowRow]` (id/seq/updated_at) alongside the `DataSource`, which is enough for D6's PUT response with no second read.
- **(d) The "all three" sentence: RESOLVED.** The round-2 correction block in D1 explicitly separates refresh's semantics (new schema) from PUT's (schema current at lock time). Grepping design/tasks/proposal/specs for `fresh|stored schema|current declaredColumns`, the only "freshly-read schema" left is tasks 1.2, which is the append path, where it is correct. The old tasks 1.4 wording ("passing the source's current declaredColumns unchanged and a freshly recomputed inferredSchema") is gone.
- **(e) Race test: RESOLVED.** Tasks 5.3b adds PUT racing a schema-changing refresh, and asserts that the loser observes the winner's committed schema and that neither write is reverted.

### Verdict: CONFIRM

Round 2's single remaining required revision is resolved against ground truth. The transaction boundary covers schema resolution and validation for both refresh (`Some`) and PUT (`None`), and no artifact still describes the two writers as sharing one schema read. None of the notes below needs guessing to implement.

### Non-blocking notes

1. **The pinned return type has no channel for validation errors.** D1 says a validation failure "is surfaced as a `Left`/typed failure the service maps to `BadRequest`", but the pinned type is `Future[Option[(DataSource, Vector[DatasetRowRow])]]`, where `None` already means not-found. The row-count check for PUT (D5) needs the same channel.
   - Recommended: `Future[Either[<ValidationFailure>, Option[...]]]`, or a dedicated sealed result.
   - If a failed-Future typed exception is used instead, the service must `recover` exactly that type, so an unexpected DB error does not map to 400.
   - Either way, run `validate` before the `DELETE`, so a rejected PUT never needs a rollback to preserve the prior set (test 5.4 asserts this).
2. **Tasks 1.4, "remove its now-redundant pre-call validation":** remove only `DatasetRowValidator.validate`. The `invalidColumns` type-canonicalization check, the `validateDefault` check, and the `staticMaxRows` check at L687 must stay in the service. They validate the declaration or the payload size, not rows against the schema.
3. **inferred_schema parity for refresh.** Today refresh computes the runtime type from the raw payload `col.type` string (L745). Inside `replaceRows` it will come from `DatasetFieldDeclaration.fieldType`. Make sure the wire string passed to `staticColumnRuntimeType` canonicalizes the same way, so refresh's `inferred_schema` output stays byte-identical. The existing HEL-893/HEL-1074 refresh tests should catch any drift.
4. **Wrong attribution in D1, L81:** it says "`createStatic`/`applyStaticRefresh`'s existing call site". `createStatic` uses `insertDatasetSource`, and only `applyStaticRefresh` calls this method. This is cosmetic.
5. **Stale wording in proposal.md L17:** it still says "reusing the existing `replaceDatasetRows`", but the method is now restructured and renamed to `replaceRows`. This is cosmetic.
6. **Returned `updated_at` values.** The returned `DatasetRowRow`s should carry the same `updatedAt` written to the rows, since HEL-1078 preconditions on exactly that value. The current code already uses one `updatedAt` for rows and source, so keep that.
7. **Test 5.9 carries over from round 2.** It must exercise `lockSource`'s `FOR UPDATE` under the non-superuser app role.
