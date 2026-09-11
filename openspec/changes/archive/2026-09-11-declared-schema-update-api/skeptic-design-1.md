## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at `HEAD = 4e313d49b83fed424217cbb7d44b87fab4e2b754`.

### What I verified (with evidence)

All claims below were checked against the worktree's actual source, not the artifacts' narrative.

- **`DatasetRowValidator` (HEL-1076 reuse claim)** — read
  `backend/src/main/scala/com/helio/domain/engine/DatasetRowValidator.scala` in full.
  `validateValue` returns `Either[String, Unit]` (line 62) — it is a **pure predicate that returns no
  value**. `validateRow` persists `raw` unchanged (line 126, `case Right(()) => Right(raw)`). There is
  **no coercion anywhere in the file**; the only transformation is default-substitution for a missing
  (`JsNull`) cell (lines 130-135). Short rows are padded (`row.lift(i).getOrElse(JsNull)`, line 122);
  over-long rows are rejected (line 118).
- **`lockSource` (HEL-1077 reuse claim)** — `DataSourceRepository.scala:355`, exactly as cited:
  `SELECT id FROM data_sources WHERE id = ? FOR UPDATE`. Confirmed taken by `appendRows` (375),
  `replaceRows` (432), `patchRow` (488), `deleteRow` (536), each re-reading `datasetSchema` under the
  lock. The claim is accurate.
- **ACL / HEL-1002 404 shape** — `DataSourceService.getDatasetSchema` (line 891-892) resolves via
  `dataSourceRepo.findByIdOwned`, as do `update` (557), `appendRows` (768), `patchRow` (814). Accurate.
- **`DatasetSchemaResponse` (HEL-1122 reuse claim)** — `DataSourceProtocol.scala:316`,
  `DatasetSchemaResponse(fields: Vector[DatasetFieldResponse])`, serialized by **`jsonFormat1`**
  (line 646). See CR6 — the design's "reused unmodified" is false.
- **RLS harness** — read `RlsOwnerTablesSpec.scala` in full. It is a **genuine** non-superuser harness:
  `helio_app_test` is created `NOSUPERUSER ... NOLOGIN` (line 98), the app pool sets that role via
  `setConnectionInitSql` (line 120), and `withUserContext` runs on it. The claim in design.md D6 is
  sound. See CR7 for the weakness in what the plan asks that harness to prove.

### Verdict: REFUTE

The concurrency approach (focus area 2) and the RLS harness reuse (focus area 3) are sound. But the
retype mechanism rests on a capability that does not exist, the add-optional migration rule is
specified in a way that silently corrupts data, and design.md contradicts spec.md on drop semantics.

### Change Requests

1. **Retype's "coercion" does not exist — the entire retype rule is built on a false premise.**
   design.md D2 (retype bullet) says values are "coerced via `DataFieldType`'s existing numeric/bool/
   string coercion (reusing the same conversion `DatasetRowValidator` already performs for row
   writes — no new coercion table)". `DatasetRowValidator` performs **no conversion at all**:
   `validateValue` returns `Either[String, Unit]` (DatasetRowValidator.scala:62) and `validateRow`
   stores the original value verbatim (line 126). There is no coercion table to reuse.
   The rule is also self-contradictory: if `validateValue(newType, currentValue)` passes, the value
   *already* satisfies the new type, so there is nothing to convert — making spec.md's "every row's
   value for that field is rewritten to the converted value" (lines 78-80) a no-op, and `rowsMigrated
   = row count` misleading. Conversely the retypes users actually want (`integer` -> `string`, so
   `5` -> `"5"`) are **rejected**, since `validateValue(StringType, JsNumber(5))` falls to
   `case _ => reject` (line 75).
   Note also proposal.md:35-36 says a coercion helper "may need" to be written, directly contradicting
   design.md's "no new coercion table".
   **Required:** decide and state explicitly one of (a) retype is *validation-only* — allowed iff every
   existing value already satisfies the new type, no rewrite, and drop the "converted"/"coerced"
   language from design.md and spec.md; or (b) a real conversion function is in scope — then specify
   its exact per-(from,to)-type table, where it lives, and that it is new code, and reconcile
   proposal.md. Resolve the proposal/design contradiction either way.

2. **Add-optional-field's "no cell data changes" silently corrupts every row when the field is not
   appended last.** The request is a *full ordered replacement list* (proposal.md:48-49), so an added
   optional field can land at any index. design.md D2 pins "no cell data changes" and spec.md:39-40
   pins "existing rows are unaffected (`rowsMigrated` ... here 0 — no cell data changes)". If the new
   field is inserted at, say, index 0, every stored positional `JsArray` is now misaligned by one —
   each cell is read against the wrong field's declared type. This is exactly the silent-violation
   outcome the ticket forbids. The reasoning only holds for an append-at-the-end.
   **Required:** specify that an added field at position *i* inserts `JsNull` (or its default) at index
   *i* of every existing row, and that rows are unchanged **only** when the field is appended last;
   correct spec.md's scenario accordingly.

3. **spec.md contradicts design.md on dropping an all-null column.** spec.md's requirement
   (lines 82-85) states the system SHALL reject dropping a field from a *non-empty* dataset unless
   `confirmDrop: true` — unconditionally. design.md D2 (drop bullet) and tasks.md 4.6 allow the drop
   **without** `confirmDrop` when every value in the column is already null. These cannot both hold;
   an implementer reading the spec delta (the binding contract) will build the wrong behavior.
   **Required:** pick one and make spec.md, design.md, and tasks.md 4.6 agree.

4. **Multi-field edit: the collision cases are unspecified, and one of them destroys the wrong
   column.** design.md D2's last bullet pins the order `rename -> retype -> drop -> reorder ->
   insert-added` but never defines behavior when edits interact. At minimum, specify:
   (a) a rename **to** a name that is simultaneously being dropped (after the rename step the dropped
   name now resolves to the *renamed* field — the drop step deletes the wrong column's data);
   (b) two payload fields carrying the same `previousName`;
   (c) a `previousName` that matches no field in the current declaration;
   (d) duplicate `name`s within the submitted list;
   (e) `previousName == name`;
   (f) a field present in the current declaration by name *and* targeted by another field's
   `previousName` (D2 says the diff is "by field `name`" *and* "possibly renamed via `previousName`" —
   which wins is undefined).
   **Required:** state the rule (or an explicit `400` validation rejection) for each, in design.md.

5. **The stated justification for the fixed transform order is incoherent, so an implementer cannot
   derive the intent.** D2 says the order exists "so e.g. a renamed field's OLD data is still findable
   under its `previousName` when the retype step runs" — but rename runs **first** in that order, so by
   the time retype runs the old name is gone. Since rows are positional (`dataset_rows.data` is an
   index-aligned `JsArray`), name-keyed lookup during migration is the wrong frame entirely.
   **Required:** restate the migration as an explicit **index mapping** from old declaration positions
   to new declaration positions (which is what the storage format actually demands), and either fix or
   drop the `previousName`-findability rationale.

6. **"Reused unmodified" + "extended with `rowsMigrated`" is a contradiction, and extending
   `DatasetSchemaResponse` breaks HEL-1122's shipped GET contract.** Ground truth:
   `DatasetSchemaResponse(fields: Vector[DatasetFieldResponse])` serialized with **`jsonFormat1`**
   (`DataSourceProtocol.scala:316,646`). tasks.md 1.1 instructs extending it with `rowsMigrated: Int`,
   which changes the response body of the already-shipped `GET /api/data-sources/:id/schema` (plus its
   `schemas/`/OpenAPI contract and `RlsOwnerTablesSpec.scala:708`), where a migration count is
   meaningless. The stated rationale — "spray-json only omits `None`/never-present fields on read, not
   extra fields on write" — does not address this, and a non-`Option` `Int` cannot be omitted at all.
   **Required:** use a distinct response type for PATCH (e.g. wrapping the existing
   `DatasetSchemaResponse` alongside `rowsMigrated`), leaving the GET shape genuinely untouched; or
   justify and own the GET contract change explicitly, including its contract artifacts.

7. **The RLS task, as written, will likely be satisfied by a test that does not exercise
   `dataset_rows`' policy.** The harness is genuinely non-superuser (verified above), but tasks.md 6.1
   only asks that a cross-owner DB-layer attempt "is denied by the existing RLS policy". This repo has
   already learned that the obvious version of this test proves less than it appears: the comments at
   `RlsOwnerTablesSpec.scala:589-631` record that calling the repository as a non-owner returns `None`
   because **`data_sources`' own** RLS denies the schema existence read — the query never reaches
   `dataset_rows`. Only the raw-SELECT contrast at (c) proves `dataset_rows_owner` is doing the
   denying.
   **Required:** pin the task to the (a)/(b)/(c)-style structure already used for `listRows` —
   non-owner direct call, owner positive control, and a raw non-owner `SELECT` on `dataset_rows`
   contrasted against the privileged pool — plus an assertion that a cross-owner *write* leaves the
   owner's rows byte-identical.

8. **Nothing in the plan re-validates the migrated rows against the new declaration before commit.**
   The ticket's central invariant is that no row is left violating the declaration. Every rule in D2
   argues this informally, per case. The decisive, cheap guard — running
   `DatasetRowValidator.validate(newDeclaration, migratedRows)` inside the same transaction and rolling
   back if it returns `Left` — is not specified anywhere in design.md or tasks.md.
   **Required:** mandate that final in-transaction re-validation as an explicit step (and a test that
   it can actually fail, e.g. via a deliberately wrong migration), so the invariant is enforced by
   code rather than by the design's case analysis being exhaustive. Note while specifying it that
   `validateValue(_, JsNull)` rejects (line 75) while `validateRow` treats a `JsNull` cell as *missing*
   (line 123) — the retype rule in D2 checks values with `validateValue` and will therefore reject any
   retype of a column containing nulls unless this is handled deliberately.

### Non-blocking notes

- `rowsMigrated` is ambiguous: spec.md uses `0` both for "dataset was empty" (line 30) and for "rows
  untouched" (line 40), and never defines the value for a combined edit where only some
  transformations touch cells. Worth pinning to a single definition ("number of stored rows rewritten").
- spec.md's "Empty dataset accepts **any** declaration change" (line 23-26) is broader than intended:
  a declaration whose `default` does not satisfy its own declared type should still be rejected —
  `DatasetRowValidator.validateDefault` (line 83) exists precisely for this and applies regardless of
  row count.
- design.md D7 pre-commits to `V107__<name>.sql` as the next free migration number; the repo convention
  cited elsewhere is to re-verify against `origin/main` immediately before committing, which tasks.md
  7.1 does correctly say. No action needed, just don't let D7's number harden.
