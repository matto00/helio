## Context

`dataset_schema` (V106, HEL-1074) is `jsonb` on `data_sources`, Scala-side
`Vector[DatasetFieldDeclaration]` (HEL-1076: `name`, `fieldType: DataFieldType`, `required: Boolean`,
`default: Option[JsValue]`). `dataset_rows.data` stores each row as a positional `JsArray` aligned to
`dataset_schema`'s column order. The only two existing writers of `dataset_schema` are
`insertDatasetSource` (create) and `replaceDatasetRows` (full CSV-style refresh) — no route mutates an
existing declaration. HEL-1076's own design.md explicitly deferred this ("no product decision exists
... not built here"); the v0.8 design spec is silent on the policy too. This design makes that call.

Reused verbatim from prior tickets (verified in `premise-validation.md`, re-verified line-by-line by
the design-gate skeptic round 1):
- ACL + HEL-1002 not-found shape — every route in `DataSourceRoutes` resolves via
  `dataSourceRepo.findByIdOwned`, `None` -> `ServiceError.NotFound`.
- `lockSource` (`DataSourceRepository.scala:355`, `SELECT ... FOR UPDATE`) — the row-lock every
  row-mutating operation already takes before touching `dataset_rows`. Confirmed sufficient for this
  ticket's concurrency requirement (skeptic round 1: sound, no changes needed).
- `RlsOwnerTablesSpec.scala` — confirmed a genuine non-superuser/non-BYPASSRLS harness (`helio_app_test`
  is `NOSUPERUSER ... NOLOGIN`, wired via `setConnectionInitSql`). Reused per Decision 7 below, with the
  stronger (a)/(b)/(c) structure the file already establishes for `listRows`.
- **`DatasetRowValidator` does NOT coerce or convert values** (round-1 correction). `validateValue`
  (`DatasetRowValidator.scala:62`) is a pure predicate returning `Either[String, Unit]` — no value is
  ever transformed. `validateRow` stores the original cell verbatim; the only transformation in the
  whole file is default-substitution for a missing/`JsNull` cell. There is no coercion table anywhere
  in this codebase for dataset rows. Round 1's design incorrectly assumed one existed for "retype";
  corrected in Decision 2 below.
- **`DatasetSchemaResponse(fields: Vector[DatasetFieldResponse])`** (`DataSourceProtocol.scala:316`) is
  serialized with `jsonFormat1` (line 646) and is the **shipped, unmodified** response of
  `GET /api/data-sources/:id/schema` (HEL-1122). It is NOT extended by this ticket (round-1 correction —
  see Decision 6).

## Goals / Non-Goals

**Goals:**
- One route, `PATCH /api/data-sources/:id/schema`, that replaces a dataset's declared field list,
  migrating or rejecting existing rows per a stated, testable, code-enforced rule per edit kind.
- Every response — success or 409 — tells the caller exactly what happened/would happen so HEL-1079's
  UI can present an honest block/warn/migrate choice.
- Concurrency-safe: a schema edit and a concurrent row write against the same source can never leave a
  row that violates whichever declaration is in effect once both complete.
- The "no row may violate its declaration" invariant is enforced by a final, in-transaction
  re-validation (Decision 8), not solely by the case analysis below being exhaustive.

**Non-Goals:**
- Partial/diff-style PATCH semantics — the request is a full replacement declaration list.
- Changing `DatasetFieldDeclaration`/`DatasetRowValidator`'s own shape or behavior (HEL-1076,
  unchanged) — in particular, **no new value-coercion/conversion capability is introduced** (round-1
  correction; see Decision 2).
- Modifying the shipped `GET /api/data-sources/:id/schema` response shape (`DatasetSchemaResponse`) in
  any way (round-1 correction; see Decision 6).
- A dry-run/preview mode — a 409 response is itself a free preview, since the transaction rolls back.

## Decisions

1. **Route & wiring**: `PATCH /api/data-sources/:id/schema`, alongside HEL-1122's `GET` at the same
   path (`DataSourceRoutes.scala`, same `pathPrefix`/ACL composition — no new auth wiring). Request:
   `UpdateDatasetSchemaRequest(fields: Vector[DatasetFieldDeclarationPayload], confirmDrop: Boolean =
   false)`. Non-dataset-kind source -> `400` naming the actual kind. Not-found/not-owned -> `404`
   (HEL-1002 shape, unchanged).

2. **Migration is defined as an explicit per-row INDEX MAPPING, not a name-keyed/value-transforming
   operation (round-1 CR5 fix — rows are positional, this is the frame the storage format actually
   demands).**

   **Step A — resolve field identity (structural validation, before any classification).** Build the
   rename map from every payload field's `previousName` (`old name -> new name`). Reject the WHOLE
   request with `400` (malformed request, not a data-integrity 409) if any of: a `previousName` names
   no field in the current declaration; two payload fields share the same `previousName`; two payload
   fields share the same `name`; a `previousName` also equals another payload field's plain `name`
   with no `previousName` of its own targeting a different old field (i.e. after applying every rename,
   the resulting mapping from old-declaration names to new-declaration names must be a strict injection
   — no old name maps to two different new names, and no two old names collide onto one new name,
   **with no exception**). Concretely: **a rename TO a name that is simultaneously being dropped is
   ALWAYS a `400`** (round-1 CR4a; round-2 correction — the round-1 revision's draft carved out an
   exception "unless one of them is being dropped" and then contradicted it in the very next sentence;
   there is no exception) — the request must drop the OLD name first in a separate call, or not reuse
   the name at all, because "rename X->Y then drop Y" is ambiguous about which physical column Y refers
   to. `previousName == name` is accepted as a no-op rename marker (round-1 CR4e).

   **Step B — build the old-index -> new-index mapping.** For each position `j` in the NEW declaration:
   - if the field at `j` has a `previousName` (or matches an unrenamed current field by `name`), map it
     to that field's position `i` in the OLD declaration — this is a "kept" field (possibly renamed,
     possibly retyped — Decision 2b below governs retype).
   - if the field at `j` has no match in the OLD declaration (new `name`, no matching `previousName`),
     it is an "added" field — no source index; migration inserts a value per Decision 2c.
   Any OLD field whose position is not the source of any NEW position is a "dropped" field — governed
   by Decision 2d.

   **Step C — one general per-field algorithm (round-3 rewrite: rounds 1-2's enumerated bullets
   ["kept same-type", "kept retyped", "kept required-tightened", "added"] kept missing their pairwise
   INTERACTIONS — retype-and-required-tightened-together, default-removed-while-still-required, etc.
   Rather than adding a fifth, sixth bullet for each newly-found interaction, Step C is now ONE
   algorithm applied uniformly to every NEW field `j`, whether kept or added, so there is no
   combination left to enumerate.)**

   For each NEW field `j` (dropped fields are handled separately below — they contribute no output
   column at all, so this algorithm doesn't apply to them):

   1. **Compute each existing row's CANDIDATE value at `j`, and whether the field is retype-validated:**
      - If `j` is an ADDED field (no old-index match from Step B): candidate = `JsNull`/absent for
        every row (there is no old value).
      - If `j` is a KEPT field mapped to OLD index `i`, and `fieldType` at `j` equals the OLD
        declaration's type at `i`: candidate = the row's value at `i`, unchanged.
      - If `j` is a KEPT field mapped to OLD index `i`, and `fieldType` at `j` DIFFERS from the OLD
        type at `i` (a retype): for each row, if the value at `i` is `JsNull`/absent, candidate =
        `JsNull`/absent (exempt from the type check, matching `DatasetRowValidator.validateRow`'s own
        missing-cell semantics — round-1 CR8); otherwise the value MUST satisfy
        `DatasetRowValidator.validateValue(newType, value)` — if any row's present value fails this,
        **reject the WHOLE field** with `409` naming it and the count of failing rows, and skip steps 2
        below for it (retype failure is checked and reported independently of the required/default step
        that follows, round-3's fix for CR1's own interaction gap: this is evaluated FIRST, so a
        retyped-and-required-tightened field that also fails retype is reported as a retype failure, not
        silently proceeding to a required check on an already-rejected field). On success, candidate =
        the SAME unchanged value (no conversion is ever performed — round-1 CR1).
   2. **Apply `default` and enforce `required`, uniformly, regardless of whether this is an added field,
      a kept field whose `required` just changed, or a kept field whose `default` just changed or was
      removed — BUT gated on the field being "touched" (round-4 fix, skeptic round-4 finding: an
      earlier draft ran this step unconditionally for every KEPT field too, which meant a rename-only or
      retype-only edit that simply resubmits an untouched field's existing, unchanged `default`
      silently backfilled that default into a pre-existing `JsNull` the edit was never meant to touch —
      contradicting "rename is metadata-only" and Decision 8's own no-silent-backfill note).**
      A field is **"touched"** for the purposes of this step iff it is ADDED, OR its `fieldType` changed
      (a retype — whether it succeeded per step 1), OR its `required` flag differs from the OLD
      declaration's value at the mapped index, OR its `default` differs from the OLD declaration's value
      at the mapped index (comparing the OLD field's own `default: Option[JsValue]` against the NEW
      payload's supplied `default` — resubmitting the SAME default value, or omitting `default` on a
      kept field that also had none before, is NOT a change and does NOT count as touched).
      **If the field is NOT touched: skip this step entirely — the candidate from step 1 is final,
      unchanged, no substitution, no enforcement, regardless of its `required` flag or whether it is
      `JsNull`.** (This is exactly what makes a pure rename, and a retype where `required`/`default` are
      both resubmitted unchanged, leave every untouched cell alone — the property rounds 1-3 required
      and round 4's first draft broke.)
      **If the field IS touched:** for every row whose candidate (from step 1) is `JsNull`/absent, if the
      NEW field declaration supplies a `default` (outer `Some`, per Decision 3's `Option[Option[JsValue]]`
      idiom), replace the candidate with that default value (which may itself be an explicit null,
      `Some(None)`). After this substitution, if the NEW field's `required` is `true` and ANY row's
      candidate is STILL `JsNull`/absent (no default was supplied, or the supplied default was itself an
      explicit null), **reject the WHOLE field** with `409` naming it and explaining a non-null default
      is needed for the field's existing/would-be-missing values. On an EMPTY dataset this step never
      rejects (no rows to check), but "touched" is still evaluated the same way (irrelevant in practice
      since there are no rows to substitute into or reject over).
   3. **Migration**: for every existing row, `j`'s value in the migrated row is the row's final
      candidate value from steps 1-2.

   This single algorithm is what produces every case rounds 1-2 needed separately: a pure rename/
   reorder (same type, `required` unchanged, no default touched) leaves every candidate untouched and
   never rejects; adding an optional field yields `JsNull`-or-default candidates with no `required`
   check; adding a required field or tightening a kept field to required both hit step 2's same
   `required` check; a retype is fully handled by step 1 before step 2 ever runs; and simultaneous
   retype + required-tightening + default-removal (round-3's flagged interaction) is now well-defined
   because step 1 rejects a bad retype outright, and step 2's `required` check runs against whatever
   candidate step 1 actually produced, whether that came from a retyped, kept, or added field.

   - **Dropped field**: (a field present in the OLD declaration whose position is not the source of any
     NEW position — Step B) on an EMPTY dataset, always allowed (no index emitted for it in any migrated
     row). On a NON-EMPTY dataset, allowed **only if the request sets `confirmDrop: true`** —
     **unconditionally, regardless of whether the column's existing values happen to all be null**
     (round-1 CR3 fix: no implicit inspection of column contents decides whether confirmation is
     needed). Without `confirmDrop`, `409` naming the field and requiring `confirmDrop: true`; zero rows
     modified.
   - **Multiple fields edited in one request**: every NEW field is evaluated independently via the Step
     C algorithm above (and every dropped field independently via its own rule); if ANY field is
     rejected, the WHOLE request is rejected — no partial application. The `409` body lists every
     rejected field (round-1 CR4).

   **Step D — build each migrated row.** For each existing row and each NEW position `j` in mapping
   order, the migrated row's value at `j` is exactly the CANDIDATE value the Step C algorithm computed
   for that row and that field (after both its retype check and its default/required substitution).
   Dropped OLD indices simply are not read/emitted. This single pass handles rename, retype (validate +
   carry over unchanged), drop, reorder, add, and required-tightening simultaneously and correctly
   regardless of caller-submitted order or which combination of edits a single field carries — there is
   no "fixed order rename->retype->drop->reorder->insert" to reason about (round-1 CR5) and no
   case-by-case enumeration to keep pace with new interactions (round-3 rewrite).

3. **Wire shape for a field edit** —
   `DatasetFieldDeclarationPayload(name: String, previousName: Option[String], `type`: String,
   required: Option[Boolean], default: Option[Option[JsValue]])`. `default: Option[Option[JsValue]]` is
   the `Option[Option[T]]` idiom already established in this codebase (HEL-1076 design.md Decision 2)
   to distinguish "no default supplied" (outer `None`) from "a default was supplied" (outer `Some`,
   inner `None` for explicit null or `Some(v)` for a value) — needed because Decision 2's "added
   required field" rule keys off whether a default was supplied at all.
   **Empty-dataset declarations are still checked for internal validity** (round-1 non-blocking note):
   `DatasetRowValidator.validateDefault` runs against every field regardless of row count, so a
   `default` that doesn't satisfy its own declared type is rejected even on an empty dataset — Decision
   2's "always allowed on empty dataset" language means "no ROW can be violated", not "no validation at
   all".

4. **Migration executes inside the same transaction as the declaration write**, reusing `lockSource`
   (`FOR UPDATE` on the `data_sources` row) exactly as `appendRows`/`replaceRows` do — new repository
   method `DataSourceRepository.updateDatasetSchema(id, newDeclaration, confirmDrop)` runs: lock source
   row -> re-read current declaration + all current rows inside the lock -> Step A structural
   validation -> Step B/C classification against the FRESH read (not a pre-lock snapshot, closing the
   check-then-act race) -> if any rejection, roll back and return the rejection reasons -> else build
   every migrated row (Step D) -> **Decision 8's final re-validation** -> write new `dataset_schema` +
   rewritten `dataset_rows` positional arrays, all in one `DBIO.seq`/transaction.

5. **Concurrency** (skeptic round 1: confirmed sound, unchanged from the original design): no
   client-supplied `updatedAt` precondition on this route — the re-read-under-lock in Decision 4 is the
   concurrency guard. A concurrent row append/patch either commits fully before the schema edit's lock
   is taken (schema edit sees and migrates it) or blocks until the schema edit's transaction commits or
   rolls back. **Test**: a real concurrency test using two actually-overlapping executions (e.g. two
   `Future`s against real DB connections, synchronized with a barrier/latch — not two sequential calls)
   — a schema edit racing a row append on the same source — asserting serialization and that the final
   row state satisfies whichever declaration is current after both complete, on both possible orderings.

6. **Response shape does NOT touch the shipped `GET` contract (round-1 CR6 fix).** `DatasetSchemaResponse`
   (`jsonFormat1`, one field) is left completely untouched — `GET /api/data-sources/:id/schema`'s
   response is unaffected by this ticket, full stop. `PATCH`'s `200` response is a **new, distinct**
   type: `DatasetSchemaUpdateResponse(fields: Vector[DatasetFieldResponse], rowsMigrated: Int)`, reusing
   the existing `DatasetFieldResponse` element type but never touching `DatasetSchemaResponse` itself.
   `rowsMigrated` is defined OPERATIONALLY, not by re-deriving "did content change" per edit kind (round-1
   non-blocking note; round-2 CR3 and round-3's own finding were both caused by that per-kind reasoning
   contradicting itself across drafts — this pins one mechanical rule instead): **`rowsMigrated` is `0`
   if and only if the new declaration is identical to the old declaration except for field
   `name`s/`previousName` bookkeeping (i.e. every NEW field maps to an OLD field at the SAME index, with
   the SAME `fieldType`/`required`/`default`, only `name` differing) — a pure rename with no reorder, no
   retype, no add, no drop, no required/default change.** In every other case — reorder, retype, add,
   drop, or any required/default change, REGARDLESS of whether Step C's algorithm happened to leave a
   given row's bytes unchanged — `rowsMigrated` equals the existing row count. This intentionally
   over-reports "migrated" for e.g. a retype where no row's value actually needed to change, in exchange
   for a definition an implementer can check against the declaration diff alone, with no per-row
   byte-comparison and no risk of re-litigating what "changed" means for a new edit combination. `409`
   carries
   `SchemaUpdateConflictResponse(rejectedFields: Vector[SchemaFieldRejection(name, reason)], message:
   String)`, mirroring the existing `DataSourceDeleteConflictResponse` pattern (HEL-987).

7. **RLS** (round-1 CR7 fix — pin to the stronger, already-established structure rather than the
   weaker "denied by app-layer or unspecified layer" version): extend `RlsOwnerTablesSpec.scala` with
   the same (a)/(b)/(c) shape it already uses for `listRows` (see its own lines ~589-631 for why the
   naive version proves nothing — a non-owner repository call can return `None`/404 purely from
   `data_sources`' OWN RLS denying the existence read, without `dataset_rows`' policy ever being
   exercised): (a) non-owner calls `updateDatasetSchema` through the repository — expect denial/no
   effect; (b) owner positive control — same call succeeds; (c) a **raw** non-owner `SELECT`/`UPDATE`
   directly against `dataset_rows` (bypassing the service entirely), contrasted against the same query
   run on the privileged pool, proving `dataset_rows`' OWN RLS policy — not just `data_sources`' — is
   what denies it. Plus: assert a cross-owner write attempt leaves the true owner's rows byte-identical
   afterward.

8. **Final in-transaction re-validation is mandatory (round-1 CR8, was entirely unspecified), and it is
   PASS/FAIL-ONLY — its `Right` output is never what gets persisted (round-2 CR4 fix).**
   `DatasetRowValidator.validate(declaration, rows)` returns `Right(rows)` with `JsNull` cells
   backfilled from `default` where present (see `validateRow`, lines ~130-135) — that substituting
   behavior is exactly right for the FIRST validation pass at create-time (HEL-1076's original use), but
   is WRONG to reuse for this re-validation step: persisting its `Right` output here would silently
   backfill defaults into rows that Step D never intended to touch (e.g. a pure rename, or a retype that
   deliberately carries a pre-existing `JsNull` through untouched), directly violating the "rename/
   retype-only never modifies unrelated row data" requirements above. **The implementation MUST**: call
   `DatasetRowValidator.validate(newDeclaration, migratedRows)` (where `migratedRows` is Step D's own
   output) treating the result as boolean-only — `Left` means roll back with `500`/`ServiceError.Internal`
   (a Steps-A-D bug, not a caller error — every caller-facing rejection is already handled by the 409/
   409-tightening paths in Decision 2); `Right` means proceed to write Step D's ORIGINAL `migratedRows`
   unchanged, discarding `validate`'s own returned vector entirely — never write its `Right(_)` payload.
   **Test**: (a) a targeted unit test that deliberately constructs a wrong migration (bypassing the
   route, calling the repository method with an internally-inconsistent mapping) and asserts the
   transaction rolls back rather than committing a violating row; (b) a test asserting a successful
   rename/retype-only edit does NOT backfill any default into a pre-existing `JsNull` cell that Step D
   left untouched — the specific silent-corruption mode this note exists to prevent.

9. **Migration**: expected **none** — `dataset_schema`/`dataset_rows` already support arbitrary
   declarations and arbitrary-length positional arrays; this is app-logic only. If implementation
   surfaces a genuine need, it lands as `V107__<name>.sql` — **the number is re-verified against
   `origin/main` immediately before committing, never hardened here** (round-1 non-blocking note) — and
   the actual number used is reported at delivery.

## Risks / Trade-offs

- **Retype is validation-only, not conversion** (Decision 2, round-1 CR1 resolution): this is a real,
  user-visible limitation — a caller cannot retype `integer` `5` to a string `"5"` via this route; they
  must drop-and-recreate the field (going through the confirmDrop path, losing the data) or fix the
  source data first. Accepted because inventing a conversion table is out of scope for this ticket and
  no such capability exists to reuse; silently rejecting is safer than silently guessing a coercion.
- **Drop always requires confirmDrop on a non-empty dataset, even for an all-null column** (Decision 2,
  round-1 CR3 resolution, choosing the stricter of the two contradictory drafts): slightly more caller
  friction than strictly necessary, in exchange for one simple, uniformly-testable rule with no
  content-dependent branch.
- **All-or-nothing multi-field edits**: simpler and safer than partial application, at the cost of
  forcing the caller to resubmit a smaller edit if one field in a batch is rejected.
- **No dry-run mode**: a 409 causes no side effect (transaction rolls back), so "submit and read the
  response" is effectively free preview.
- **Decision 8's safety net is structurally blind on a `required` field that has a `default`** (round-3
  observation): `DatasetRowValidator.validateRow`, which `validate` calls per row, substitutes the
  default BEFORE deciding pass/fail — so it reports `Right` for a stored `JsNull` in a `required` column
  that carries a `default`, even though Step D's own un-substituted row (the one actually persisted,
  per Decision 8) still has that `JsNull` in it. This is benign for every case THIS ticket produces
  (Step C's own algorithm already backfills defaults into the candidate before Step D ever builds the
  row — see Step C step 2 — so a genuinely un-backfilled null only reaches Decision 8's check if Step
  C/D themselves have a bug elsewhere, which the safety net's OTHER role — catching a bad manual/
  bypassing migration mapping in a unit test, per Decision 8's own test (a) — still exercises); reads of
  such a row re-substitute the default at read time regardless (`DatasetRowValidator`/row-read path,
  unaffected by this ticket). Documented here so the claim "no row may violate its declaration" is
  understood precisely: enforced for THIS route's own Step C/D outputs, not a general database-level
  guarantee against every possible external write to `dataset_rows`.
