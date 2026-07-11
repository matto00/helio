## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **`DataFieldType` current shape** — `backend/src/main/scala/com/helio/domain/model.scala:209-224`:
  confirmed sealed trait with exactly 5 case objects (`StringType`/`IntegerType`/`FloatType`/
  `BooleanType`/`TimestampType`) and an `asString` match with no `fromString`/`category` today.
  Matches design.md's Context claims.
- **No FK on `data_type_rows.data_type_id`** — `backend/src/main/resources/db/migration/V29__data_type_rows.sql`:
  confirmed (`data_type_id TEXT NOT NULL` with no `REFERENCES`). Matches Decision 4's justification
  for omitting an FK on `binary_refs`.
- **`data_types`/`data_type_rows` schema** — V4 and V29 migrations read directly; confirms
  `data_types.fields` is a TEXT blob and `data_type_rows.data` is JSONB, consistent with the
  "no row-storage schema change needed" claim.
- **`DataTypeRowRepository.scala`** — read in full. `overwriteRows` does a transactional
  DELETE-all + bulk-INSERT per `dataTypeId` on every write (not per-row upsert); rows are keyed by
  `(data_type_id, row_index)` only, no `id`/`row` correlation column exposed to callers besides
  index.
- **`TypeDetailPanel.tsx`** — read in full; confirmed the exact 5-option hardcoded `Select` list at
  lines 126-132 that Decision 5 targets, and confirmed `InferredFieldsTable.tsx` is a distinct file
  (correctly identified as out of scope per Decision 5's reasoning about source-inference).
- **`DataFieldType` call sites** — grepped all users (`SchemaInferenceEngine.scala`,
  `SourceService.scala`, `DataSourceService.scala`, `SchemaInferenceEngineSpec.scala`). Found an
  **exhaustive match with no wildcard** in `SchemaInferenceEngine.widenType`
  (lines 133-159) over all 5 current variants. Adding 2 new sealed-trait case objects makes this
  match non-exhaustive. Checked `backend/build.sbt`: no `-Xfatal-warnings`/`-Werror`, so this stays
  a compiler warning, not a build break, and `widenType`'s `current` param is only ever seeded from
  `IntegerType`/inference output (never a content type), so it's inert today. Non-blocking, but the
  plan doesn't mention it at all.
- **`JsonProtocols.scala`** — grepped for `DataFieldType`/`InferredField`: no hits. Confirmed
  `InferredField`/`DataField.dataType` cross the wire as plain strings via `asString`, never through
  a `DataFieldType`-typed JSON formatter — so no JSON-protocol work is actually needed for the two
  new `DataFieldType` variants themselves.
- **`schemas/` JSON Schema files** — grepped for any `dataType` enum constraint: none found across
  `schemas/*.json`. The AC's "Backend schema... in `schemas/`" clause appears to have no concrete
  target file, which is fine (nothing there constrains field types today).
- **`openspec/specs/schema-inference/spec.md`** (existing canonical spec, NOT part of this change's
  artifacts) — read directly. Line 79-84:
  > "The `DataFieldType` sealed trait SHALL define **exactly five variants**: `StringType`,
  > `IntegerType`, `FloatType`, `BooleanType`, `TimestampType`."
  This requirement becomes **false** the moment this change ships, yet proposal.md's "Modified
  Capabilities" section states "(none — additive only...)" and no spec delta for
  `schema-inference` exists anywhere in `openspec/changes/content-field-types/specs/` (only
  `type-registry-content-fields/spec.md` was created, confirmed via `find`).
- **`BinaryRefRepository` planned CRUD surface** — read design.md Decision 4, tasks.md 2.3, and
  spec.md's "BinaryRefRepository provides async CRUD" requirement: `insert`, `findById`,
  `findByDataTypeId`, `delete` only.

### Analysis / judgment

1. **`binary_refs` has no per-row correlation key, contradicting the design's own stated need.**
   design.md's Context explicitly says: "v1.4 connectors (PDF/image) will ingest many binaries,
   **one potentially per row**." The `binary_refs` table (Decision 4 / spec.md) has columns
   `id, data_type_id, field_name, storage_key, mime_type, filename, size_bytes, created_at` — there
   is no `row_index`/`row_id` column. `data_type_rows` keys rows by `(data_type_id, row_index)`
   (V29). Given `findByDataTypeId` returns an undifferentiated `Vector[BinaryRef]` for the whole
   type, a downstream consumer (a HEL-219/220/221 pipeline op that needs "the binary for row N's
   `imageField`") has **no supported way to look that up** from `binary_refs` alone. The only
   possible correlation is an undocumented, unenforced assumption that `storage_key` also appears
   verbatim in the row's inline JSONB value and is unique — a coincidental join key that is never
   stated as a contract anywhere in design.md or spec.md. This is precisely the ambiguity the
   ticket owner told the design to avoid ("clean and extensible... stable contract to produce and
   consume against").

2. **Two unlinked storage locations for the same metadata, no defined write/consistency contract.**
   Decision 3 stores the full `{storageKey, mimeType, filename, sizeBytes}` object **inline** in
   `data_type_rows.data` (JSONB) — which already gives any pipeline op consuming rows everything it
   needs without touching `binary_refs` at all. Decision 4 then duplicates the same fields into a
   separate `binary_refs` table, claimed to be what "pipeline ops read from" — but if pipeline ops
   read rows via `data_type_rows` (the only documented read path — `BinaryRefRepository` has no
   route and no wiring into any row-read call site), `binary_refs` is never actually read by
   anything the design describes, and its claimed purpose ("the durable... reference downstream
   connectors write to **and pipeline ops read from**") is not substantiated. Compounding this,
   `DataTypeRowRepository.overwriteRows` **deletes and replaces the entire row snapshot on every
   pipeline run**, but `BinaryRefRepository`'s CRUD surface has no analogous
   `overwriteByDataTypeId`/bulk-replace operation — only single `insert`/`delete(id)`. Design.md
   claims connectors will call `BinaryRefRepository` "analogous to how
   `DataTypeRowRepository.overwriteRows` is called internally" (Decision 4), but the two APIs are
   not actually analogous, so a connector re-running against the same `DataTypeId` will accumulate
   orphaned/duplicate `binary_refs` rows across runs with no documented cleanup path (the
   general-orphan-GC non-goal doesn't cover this — this is about the *design's own write contract*
   being incoherent, not about missing GC tooling).

3. **Missing spec delta — internal contradiction between proposal.md and the existing canonical
   spec it silently invalidates.** `openspec/specs/schema-inference/spec.md`'s "DataFieldType
   sealed type" requirement hardcodes "exactly five variants." proposal.md declares "Modified
   Capabilities: (none — additive only...)," which is factually wrong once this ships — this is
   the "Missing contract updates" failure mode called out explicitly in my brief. The change needs
   a `MODIFIED Requirement` delta under
   `openspec/changes/content-field-types/specs/schema-inference/spec.md` updating the variant count
   and `asString` scenario to include the two new wire strings (or explicitly re-scoping that
   requirement to "at least five" / splitting it), or `openspec archive` will leave the canonical
   spec inaccurate.

4. **Minor: proposal.md/tasks.md inconsistency.** proposal.md's Impact section lists
   "`DataTypeProtocol`/JSON wiring for `BinaryRef`" as backend impact, but tasks.md has no
   corresponding task, and my read of `JsonProtocols.scala` plus the flat-scalar `binary_refs`
   schema (Decision 4) suggests no JSON protocol work is actually needed (no REST route, no JSONB
   column on the table). This is likely just a stale/over-broad line in proposal.md, but as written
   it's an unresolved discrepancy between what proposal.md promises and what tasks.md delivers.

### Verdict: REFUTE

### Change Requests

1. Add a row-level correlation key to `binary_refs` (e.g. `row_index INT` mirroring
   `data_type_rows.row_index`, or a `row_id` matching `data_type_rows.id`) so
   `findByDataTypeId`/a new `findByDataTypeIdAndRow` can actually answer "which binary belongs to
   which row's field" — the design's own Context section says connectors ingest "one [binary]
   potentially per row," so the persistence must support resolving at row granularity. Update
   spec.md's "binary_refs table" and "BinaryRefRepository" requirements accordingly.
2. Explicitly resolve and document the relationship between the inline JSONB `binary-ref` value in
   `data_type_rows.data` and the `binary_refs` table: state which one is the authoritative read path
   for pipeline ops, when/whether both are written on connector ingest, and how `binary_refs` stays
   consistent (not orphaned/duplicated) across `DataTypeRowRepository.overwriteRows`'s
   delete-and-replace semantics on pipeline re-runs. If `binary_refs` is meant to survive row
   overwrites as a superset/audit log, say so explicitly and adjust Decision 4's "pipeline ops read
   from [`binary_refs`]" claim, which is otherwise unsupported by anything else in the design.
3. Add a `MODIFIED Requirements` delta for the `schema-inference` capability (currently only
   `type-registry-content-fields` is a new capability) that updates
   `openspec/specs/schema-inference/spec.md`'s "DataFieldType sealed type" requirement (which
   hardcodes "exactly five variants" and lists only the 5 wire strings) so it no longer contradicts
   the new 7-variant reality. Correct proposal.md's "Modified Capabilities: none" claim to reflect
   this.
4. Reconcile proposal.md's Impact line ("`DataTypeProtocol`/JSON wiring for `BinaryRef`") with
   tasks.md — either add the missing task if JSON wiring is genuinely needed somewhere, or remove
   the line from proposal.md if (as the flat-scalar table + no-REST-route design suggests) it isn't.

### Non-blocking notes

- `SchemaInferenceEngine.widenType` (lines 133-159) has an exhaustive match over all 5 current
  `DataFieldType` variants with no wildcard; adding the 2 new variants makes it non-exhaustive
  (compiler warning only, no `-Xfatal-warnings` in `backend/build.sbt`, and `current` is never
  seeded with a content type today, so it's inert). Worth a one-line acknowledgment in design.md or
  a defensive wildcard case so a future refactor doesn't silently mis-widen a content type.
