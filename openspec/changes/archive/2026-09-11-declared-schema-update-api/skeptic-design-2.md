## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed cold at `HEAD = 4e313d49b83fed424217cbb7d44b87fab4e2b754` (change dir is untracked:
`?? openspec/changes/declared-schema-update-api/`). Every finding below was derived from the current
artifacts and live source read in this round, not from round 1's narrative.

### What I verified (with evidence)

Round-1 items, re-checked against the revised artifacts and live source:

1. **Retype coercion premise — RESOLVED.** `DatasetRowValidator.validateValue` is still a pure
   predicate (`Either[String, Unit]`, `DatasetRowValidator.scala:62`), `validateRow` still stores the
   cell verbatim (line 126). design.md D2 "kept, retyped" is now explicitly validation-only,
   spec.md:104-111 states no conversion, proposal.md:18-19 agrees ("Retype performs no value
   conversion"), tasks.md 2.2 says "No new coercion table anywhere". The old contradiction is gone.
2. **Add-optional at a non-trailing index — RESOLVED.** spec.md:73-87 now requires insertion at the
   field's declared position in every row; tasks.md 4.1 tests the non-trailing case explicitly.
3. **Drop of an all-null column — RESOLVED, and the two documents now agree.** design.md:112-119 and
   spec.md:130-141 both state `confirmDrop` is required unconditionally on a non-empty dataset;
   tasks.md 4.5 tests the all-null case as still-409.
4. **Collision cases — PARTIALLY resolved.** Step A now enumerates the cases, but its own rule is
   self-contradictory (CR2 below).
5. **Transform-order rationale — RESOLVED.** The fixed rename->retype->drop order is gone; migration
   is an index mapping (Steps B/D), which is the correct frame for a positional `JsArray` store.
6. **`DatasetSchemaResponse` GET contract — RESOLVED, confirmed against live source.**
   `DatasetSchemaResponse(fields: Vector[DatasetFieldResponse])` at
   `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala:316`, still
   `jsonFormat1` at line 646 — untouched. `DatasetFieldResponse` (line 315) genuinely exists and is
   reusable as the new `DatasetSchemaUpdateResponse`'s element type, as Decision 6 claims.
7. **RLS task — RESOLVED.** tasks.md 6.1 now pins the (a)/(b)/(c) raw-`SELECT`-on-`dataset_rows`
   structure plus the byte-identical assertion; design.md D7 matches.
8. **Final in-transaction re-validation — SPECIFIED** (design.md D8, tasks.md 4.12, spec.md:164-173),
   but it introduces two new problems (CR1, CR4 below).

New checks this round:

- `grep -n "required" design.md` returns matches **only** at lines 4, 102-111 (all under "Added
  field") and 137/141 (wire shape). `grep` for a required-flag change in spec.md returns only the
  two "adds a `required: true` field" scenarios. No artifact classifies a `required`/`default`
  change on a **kept** field — see CR1.
- `DatasetFieldDeclaration` confirmed at `DataSource.scala:165`.
- `DatasetRowValidator.validate` (line 104-115) returns `Right(rows to persist)` with
  **default-substituted** cells (`validateRow` line 130-135), not merely a pass/fail — see CR4.

### Verdict: REFUTE

The revision genuinely fixes all eight round-1 items in substance; the index-mapping reframe
(Decision 2 Steps A-D) is the right model and is a clear improvement. But Step C's case analysis is
not exhaustive over what a full-replacement payload can express, and that gap routes an ordinary
caller edit into a `500`. Two further contradictions would send an implementer down the wrong path.

### Change Requests

1. **Step C never classifies a `required` or `default` change on a KEPT field — and the omission is
   caller-reachable, data-corrupting, and lands on a `500`.** Step C's exhaustive-looking list is
   {kept same type, kept retyped, added, dropped}. `required` is discussed **only** for added fields
   (design.md:102-111; verified by grep — no other occurrence classifies it). But the request is a
   **full replacement declaration** (proposal.md:52-53), so a caller can submit the same field, same
   type, same position, with `required` flipped `false -> true`, or with a `default` added/removed.
   That edit is classified as "Kept, same type — **always allowed at any row count**"
   (design.md:89-91). If the column contains `JsNull` in any row (entirely legal while the field was
   optional — `validateRow` line 134 returns `Right(JsNull)` for a missing optional cell), the edit
   is admitted, Step D copies the nulls across unchanged, and Decision 8's final
   `DatasetRowValidator.validate` then fails on `FieldError(name, "required")` (line 133). Per
   Decision 8 that failure is mapped to **`500`/`ServiceError.Internal`** on the stated grounds that
   it "indicates a bug in Steps A-D, not a caller error" — but here it is precisely a caller error,
   and the caller gets a 500 with no actionable reason instead of the `409` this ticket's whole
   rubric exists to produce. This is the same class of defect as round-1 CR2, in the one edit kind
   the revision did not re-examine.
   **Required:** add an explicit "Kept, `required`/`default` changed" case to Decision 2 Step C with
   a stated rule (at minimum: tightening `required` `false -> true` on a non-empty dataset is
   allowed only if no row has a `JsNull`/absent value in that column **or** a `default` is supplied,
   else `409` naming the field and the offending row count — mirroring the added-required rule), a
   matching spec.md requirement + scenario, and a test task. Note the interaction with the retype
   rule's null exemption: a field that is simultaneously retyped and tightened must satisfy both.

2. **Decision 2 Step A's identity rule contradicts itself in consecutive sentences, so the
   structural-400 set is undefined.** design.md:73-76 first states the mapping must be a partial
   injection with the carve-out "*no two old names collide onto one new name **unless one of them is
   being dropped***" — which **permits** rename-to-a-dropped-name — and then immediately states
   "**a rename TO a name that is simultaneously being dropped is a `400`**", which **forbids** it.
   These cannot both hold, and it is the exact case round-1 CR4(a) flagged as destroying the wrong
   column. spec.md:35-39 takes the "400" side, so design.md's carve-out clause is also a fresh
   design/spec contradiction. Separately, the preceding clause — "a `previousName` also equals
   another payload field's plain `name` with no `previousName` of its own targeting a different old
   field" — is not parseable into a decision procedure; round-1 CR4(f) is not actually answered by
   it.
   **Required:** delete the "unless one of them is being dropped" carve-out (or the 400 rule —
   spec.md says keep the 400), and restate Step A as a flat, checkable list of reject conditions in
   terms of the **old-index -> new-index** mapping rather than names, e.g.: build `sourceIndex(j)`
   for every new position; reject `400` if any `previousName` matches no old field, if any old index
   is the source of two different new positions, if two payload fields share a `name`, or if a new
   `name` equals an old field's name that is not the source of that position. That formulation
   decides CR4(f) mechanically and needs no prose carve-outs.

3. **`rowsMigrated` is defined two incompatible ways for a successful retype.** design.md:171-174
   pins it as "the number of stored rows rewritten", explicitly `0` "for an edit that touches no
   existing cell". A successful retype touches **no cell** — Decision 2 states the value "carries
   over UNCHANGED" and the resulting `JsArray` is byte-identical — so design.md's definition yields
   `0`. But spec.md:119-123 says for that same case "the response is `200`, **`rowsMigrated` equals
   the row count**, and every row's value for that field is unchanged". The binding spec delta and
   the design disagree on the value returned for the retype scenario, and the ticket calls this
   number out as what HEL-1079's UI renders.
   **Required:** pick one definition and make design.md Decision 6 and spec.md's retype scenario
   agree. (Recommend defining it as "rows whose stored `JsArray` was written", which is unambiguous,
   implementation-checkable, and makes pure-rename `0` and retype/reorder/add/drop the row count —
   then fix design.md's "touches no existing cell" phrasing, which is the clause that conflicts.)

4. **Decision 8 does not say which row vector is persisted, and `validate`'s return value silently
   rewrites data.** `DatasetRowValidator.validate` does not return a boolean — it returns
   `Right(Vector[Vector[JsValue]])` whose cells have been **default-substituted** for any `JsNull`
   (`DatasetRowValidator.scala:114`, via `validateRow` lines 130-135). Decision 8 says only to run it
   and roll back on `Left`. An implementer who persists the `Right` payload (the natural reading —
   it is the function's whole output, and `appendRows` uses it that way) will silently backfill
   defaults into every pre-existing null cell of any defaulted column, on **every** schema edit —
   including a pure rename, directly violating spec.md:57-66 ("Rename and reorder never modify row
   data" / "rowsMigrated: 0") and the retype guarantee of "carried over unchanged".
   **Required:** state explicitly in Decision 8 that the re-validation is used as a **check only** —
   Step D's rows are what get written, `validate`'s `Right` value is discarded — or, if
   default-substitution is intended, say so and reconcile it with the rename/retype no-change
   requirements. Add an assertion to tasks.md 4.12 (or 4.3) that a pre-existing `JsNull` in a
   defaulted column is still `JsNull` after an unrelated edit.

### Non-blocking notes

- design.md:94 claims the retype null-exemption matches "`DatasetRowValidator.validateRow`'s own
  missing-cell semantics". That is accurate as far as it goes (line 123 treats `JsNull` as missing),
  but `validateRow` then applies `required`/`default` to that missing cell — the exemption is only
  truly equivalent for optional-or-defaulted fields. CR1's fix should make this precise.
- tasks.md 4.10 tests four structural cases but not round-1 CR4(f) (a `previousName` target that is
  also another payload field's plain `name`); worth adding once CR2's restatement decides it.
- Decision 9 correctly refuses to harden the `V107` number. Good.
- The 400 (structural, Step A) / 409 (data-integrity, Step C) / 500 (internal, Decision 8) split is
  coherent in principle, and precedence is properly pinned (tasks.md 2.1(a): structural errors are
  rejected "before any data-integrity classification"), so a request that is both a structural
  collision and an unconfirmed drop is deterministically a 400. CR1 and CR2 are what currently
  break it, not the split itself.
