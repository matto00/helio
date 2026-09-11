## 1. Wire shapes (contract)

- [x] 1.1 Add `DatasetFieldDeclarationPayload(name, previousName: Option[String], type, required:
      Option[Boolean], default: Option[Option[JsValue]])`, `UpdateDatasetSchemaRequest(fields,
      confirmDrop: Boolean = false)`, `SchemaFieldRejection(name, reason)`,
      `SchemaUpdateConflictResponse(rejectedFields, message)`, and a NEW, DISTINCT
      `DatasetSchemaUpdateResponse(fields: Vector[DatasetFieldResponse], rowsMigrated: Int)` to
      `DataSourceProtocol.scala`. Do **not** modify the existing `DatasetSchemaResponse` (jsonFormat1,
      GET's shipped shape) in any way. Use the `Option[Option[JsValue]]` idiom for `default`. Add
      `JsonProtocols` formatters, testing fields absent on the wire.
- [x] 1.2 Update `schemas/` JSON Schema and the OpenAPI spec under `openspec/` for the new route and
      shapes only — confirm the existing GET schema entry is untouched.
- [x] 1.3 Update frontend `frontend/src/services/*` types + the data-sources service client function
      for the new route.

## 2. Repository layer

- [x] 2.1 `DataSourceRepository.updateDatasetSchema(id, newFields: Vector[DatasetFieldDeclarationPayload],
      confirmDrop): Future[Either[SchemaUpdateRejection, DatasetSchemaUpdateResult]]` — reuses
      `lockSource`, re-reads current declaration + rows under the lock, then:
      (a) Step A structural validation of the `previousName`/`name` mapping (design.md Decision 2) —
      reject `400`-shaped structural errors before any data-integrity classification;
      (b) Step B builds the old-index -> new-index mapping;
      (c) Step C runs ONE general algorithm per NEW field (design.md Decision 2, round-3 rewrite, round-4
      "touched" fix — do NOT re-implement this as separate kept/added/retyped/required-tightened
      branches; that enumeration is exactly what missed interactions across rounds 1-2): compute each
      row's candidate value (retype-validate-and-carry-over if type changed, else carry over unchanged,
      else `JsNull` if added), reject the field outright on a retype failure, then apply `default`/
      `required` to whatever candidate resulted — but ONLY when the field is "touched" (added, retyped,
      or its `required`/`default` genuinely differs from the OLD declaration at the mapped index;
      resubmitting the SAME `required`/`default` a kept field already had does NOT count). An untouched
      kept field's candidate passes through step 1's output completely unmodified — **this gate is
      required**, not optional: without it, a rename-only or retype-only request that resubmits an
      untouched field's existing `default` unchanged silently backfills that default into a pre-existing
      null the edit was never meant to touch (round-4 finding). Collect ALL rejected fields, don't
      short-circuit on the first;
      (d) if any field rejected, roll back and return every rejection;
      (e) else Step D builds every migrated row via the index mapping (no name-keyed lookups, no fixed
      transform order);
      (f) Decision 8: re-validate Step D's rows against the new declaration via
      `DatasetRowValidator.validate`, PASS/FAIL ONLY — roll back with an internal error on `Left`; on
      `Right`, persist Step D's OWN rows, never `validate`'s returned vector (it silently backfills
      defaults into untouched nulls — persisting it would violate the rename/retype "no unrelated row
      data changes" requirements);
      (g) write new `dataset_schema` + Step D's rewritten `dataset_rows`.
- [x] 2.2 Reuse `DatasetRowValidator.validateValue` (retype check — validation only, no conversion) and
      `validateDefault` (added-required-field default check, and internal declaration validity on an
      empty dataset). No new coercion table anywhere.

## 3. Service + route

- [x] 3.1 `DataSourceService.updateDatasetSchema(id, req, user)` — ACL via `findByIdOwned` (HEL-1002
      404 shape), `400` for non-dataset-kind, delegates migration/classification to the repository,
      maps its result to `200 DatasetSchemaUpdateResponse` / `400` (structural) / `409
      SchemaUpdateConflictResponse`.
- [x] 3.2 `PATCH /api/data-sources/:id/schema` in `DataSourceRoutes.scala`, alongside the existing
      `GET` at the same path; completes 200/400/404/409 per design.md Decision 6.

## 4. Tests — one per allowed/rejected/structural case (AC)

- [x] 4.1 Add optional field: empty dataset; non-empty dataset at the END of the declaration; non-empty
      dataset INSERTED AT A NON-TRAILING POSITION (assert every other field's value is still readable
      at its own shifted position — the round-1 skeptic's flagged corruption case).
- [x] 4.2 Add required field: empty dataset with no default (200); non-empty dataset with default
      (200, rows migrated, default value inserted at correct position); non-empty dataset with no
      default (409).
- [x] 4.2b Tighten a KEPT field's `required` false->true (design.md Decision 2 Step C, general
      algorithm's step 2 — must NOT fall through to a no-op path): non-empty dataset where every
      existing value is already non-null (200, no row modified); non-empty dataset with some null/absent
      values and a default supplied (200, only the null rows backfilled, others unchanged); same with no
      default supplied (409, not a 500).
- [x] 4.2c Retype AND tighten the SAME field to required in one request (design.md Decision 2 Step C,
      round-3's flagged interaction): retype fails (409 naming the retype reason, required-check never
      reached for that field); retype succeeds but a resulting null value has no default (409 naming the
      required reason); retype succeeds and a default backfills every resulting null (200).
- [x] 4.2d A kept `required: true` field whose `default` is REMOVED in the new declaration, with some
      existing rows null/absent for it: `409` (must hit the same general required/default check as
      4.2b/4.2c, not silently pass through as "kept, same type, nothing changed").
- [x] 4.2e (round-4 "touched" gate — the specific defect round 4's skeptic caught) A rename-only or
      retype-only edit that RESUBMITS an untouched field's existing `default` unchanged, on a dataset
      with a pre-existing `null`/absent value in that column: assert the cell remains `null`/absent
      after the edit — it must NOT be silently backfilled with the resubmitted default. Contrast with
      4.2b/4.2c/4.2d, where the field genuinely IS touched (its `required` or `default` differs from
      before) and backfill/rejection correctly applies.
- [x] 4.3 Rename field (via `previousName`): non-empty dataset (200, `rowsMigrated: 0`, row data
      unchanged).
- [x] 4.4 Retype field: non-empty dataset, every existing value already satisfies the new type (200,
      values carried over UNCHANGED, not converted); non-empty dataset, some value does not satisfy the
      new type (409 naming field + incompatible count, no row modified); a column containing null/
      absent values is exempted from the check for those rows (200 despite nulls present).
- [x] 4.5 Drop field with data: non-empty dataset, no `confirmDrop` (409) — including the case where
      every existing value in that column happens to be null (still 409, per design.md's unconditional
      rule); with `confirmDrop: true` (200, field/column removed from every row).
- [x] 4.6 Drop field from an empty dataset: no confirmation required (200).
- [x] 4.7 Reorder fields: non-empty dataset (200, row values rewritten to new order, unchanged values).
- [x] 4.8 Not-found / not-owned (404, HEL-1002 shape); non-dataset-kind source (400).
- [x] 4.9 Multi-field edit with one rejected field: whole request rejected, 409 lists every rejected
      field, no row modified.
- [x] 4.10 Structural rejection cases (400, design.md Decision 2 Step A): `previousName` naming no
      current field; two payload fields sharing a `previousName`; two payload fields sharing a `name`;
      a rename target colliding with a field simultaneously being dropped (UNCONDITIONALLY a 400, no
      exception — round-2 CR2 fix).
- [x] 4.11 Invalid `default` value (doesn't satisfy its own declared type) rejected even on an empty
      dataset.
- [x] 4.12 Final-re-validation safety net (design.md Decision 8): (a) a targeted unit test against the
      repository method that deliberately constructs an internally-inconsistent migration and asserts
      the transaction rolls back rather than committing a violating row; (b) a test asserting a
      successful rename-only or retype-only edit does NOT backfill a default into a pre-existing
      null/absent cell the migration didn't touch — i.e. the persisted rows are Step D's own output,
      never `DatasetRowValidator.validate`'s returned `Right(_)` vector (round-2 CR4 fix).
- [x] 4.13 `rowsMigrated` value check per design.md Decision 6's OPERATIONAL definition (round-3 fix —
      NOT a per-row byte comparison): `0` for empty dataset; `0` for rename-only (identical declaration
      except name/`previousName`); full row count for EVERY other case, including a successful
      retype-only edit where no value actually needed to change (reorder/add/drop/required-tightened/
      retype all report the full row count, even when some individual row's bytes are unchanged).

## 5. Concurrency

- [x] 5.1 Real concurrent test: two actually-overlapping executions (e.g. two `Future`s racing against
      real DB connections, synchronized with a barrier/latch — not two sequential calls) — a schema
      edit racing a row append on the same source; assert serialization via `lockSource` and that the
      final row state satisfies whichever declaration is current after both complete.

## 6. RLS

- [x] 6.1 Extend `RlsOwnerTablesSpec.scala` with the (a)/(b)/(c) structure it already uses for
      `listRows` (design.md Decision 7): (a) non-owner repository call denied/no-effect; (b) owner
      positive control succeeds; (c) a RAW non-owner `SELECT`/`UPDATE` directly against `dataset_rows`
      (not via the service), contrasted against the privileged pool, proving `dataset_rows`' OWN RLS
      policy denies it — not merely `data_sources`' existence-check policy. Plus: assert a cross-owner
      write attempt leaves the true owner's rows byte-identical afterward.

## 7. Migration (only if needed)

- [x] 7.1 If implementation surfaces a genuine schema/index need, add `V107__<name>.sql` (verify
      against `origin/main` immediately before committing — report actual number used at delivery). If
      no DB change is needed (expected), skip this task and state so in `files-modified.md`.

## 8. Gates

- [x] 8.1 `sbt test` (backend), `npm run lint` / `npm run typecheck` / `npm test` (frontend) all green.
      `openspec validate declared-schema-update-api --type change` exits zero.
