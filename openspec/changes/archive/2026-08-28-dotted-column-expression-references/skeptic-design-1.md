## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

1. **Tokenizer branch line numbers and disjointness (D5/ticket description).** Read
   `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala:85-160`. `$` branch: 127-133,
   number branch: 135-142, bare-identifier branch: 144-152 — matches the citations in ticket.md/design.md
   within a line or two. Confirmed by inspection that the three cases are mutually exclusive on first
   character (`'$'` is a distinct literal char; the number-branch guard fires only on `isDigit`/`.`; the
   identifier-branch guard fires only on `isLetter`/`_`) — no character can dispatch to two branches, and
   nothing inside the `$` scan can re-enter either sibling branch. The disjointness claim in D5 holds as
   written for the *current* code; design.md is correct to still discharge it by test rather than trust
   the argument.

2. **`evaluate` signature.** `ExpressionEvaluator.scala:419` — `def evaluate(expr: String, row: Map[String, JsValue])`. Matches design.md's citation.

3. **JsonFlattener dedup (D3).** Read `JsonFlattener.scala` in full. `leaves()` (lines 52-63) does
   `walk(...).foldLeft(ListMap.empty[String, JsValue]) { case (acc, (path, value)) => acc.updated(path, value) }`
   — a real fold-to-map dedup, last-write-wins, exactly as D3/correction 3 claim. Not asserted-only; the
   dedup is genuine code, not just a doc comment.

4. **`FilterStep` does not use `ExpressionEvaluator` (correction 1).** Read `FilterStep.scala` in full —
   no import of, or reference to, `ExpressionEvaluator`; the operator dispatch resolves fields via
   `row.getOrElse(field, null)` (line 78) against `FilterCondition(field, operator, value)` (line 15).
   Confirmed by `grep -n "ExpressionEvaluator"` returning nothing in that file.

5. **Six entry points, enumerated independently (correction 2).** Ran
   `grep -rn "ExpressionEvaluator\." backend/src/main/scala` excluding the evaluator's own file and
   excluding comment-only hits. Got exactly: `ComputeStep.scala:59` (evaluate), `SourceService.scala:404`
   (evaluate), `PipelineAnalyzeService.scala:270` (validate), `:275` (inferType), `DataTypeService.scala:70`
   and `:107` (both validateTolerant — one logical entry point per the ticket's own grouping),
   `PatchSetPreviewProjection.scala:257` (validateTolerant). That is 6 call-site groups across 5 files
   (ComputeStep, SourceService, PipelineAnalyzeService, DataTypeService, PatchSetPreviewProjection) —
   matches the ticket's count and file citations exactly, derived by my own enumeration, not by trusting
   the stated count.

6. **`SourceService:329` JDBC-flat claim (Planner Notes).** Read `SourceService.scala:290-410`. Line 329
   is `val rawRows = SqlConnectorDriver.toRows(rows)` inside `previewSql`, fed by JDBC `ResultSet` rows —
   inherently tabular/flat, no nested-JSON path exists on this branch. `previewRest` (the sibling branch,
   :332+) explicitly calls `JsonFlattener.flattenJsObject` before `applyComputedFields`. Confirmed no
   asymmetry: both branches reach `applyComputedFields` with flat rows, one because JDBC rows have no
   nesting to flatten, the other by an explicit flatten call.

7. **Central design question — is there any unflattened-nested-row path into `evaluate()`?** Traced the
   one shared row-materialization seam: `PipelineRowJson.jsRowToRow` (PipelineRowJson.scala:94-96) is the
   *only* JsValue→pipeline-row conversion and it does
   `JsonFlattener.leaves(obj).map { case (k, fv) => k -> jsValueToAny(fv) }.toMap` — i.e. every pipeline
   row, from first ingestion onward, is built via the same flattening traversal that also drives schema
   inference. `ComputeStep.apply` converts that already-flat `Row` back to a `JsValue` map via
   `PipelineRowJson.rowToJsMap` (a straight per-value conversion, no re-nesting), so a later `compute`
   step cannot reintroduce nesting. `SourceService.previewRest`/`previewSql` were checked directly above.
   `PipelineAnalyzeService`/`DataTypeService`/`PatchSetPreviewProjection` operate on `validate`/`inferType`/
   `validateTolerant` against a `fieldNames`/`fieldTypes` map derived from the persisted `DataType.fields`
   schema (itself produced by the same `JsonFlattener.leaves` traversal per the class doc at
   `JsonFlattener.scala:5-13`), never against a raw nested row. I could not find any code path that hands
   `evaluate`/`validate`/`inferType`/`validateTolerant` a row or field-map built by any route other than
   `JsonFlattener.leaves`. D3's claim — the literal-vs-nested ambiguity is already decided upstream and
   does not need a fresh tie-break — holds on every one of the six entry points as they exist today.

8. **Documentation staleness claim (task 5.1).** `docs/compute-expression-grammar.md:3` cites the path
   `backend/src/main/scala/com/helio/domain/ExpressionEvaluator.scala`; the real path is
   `.../domain/engine/ExpressionEvaluator.scala` (missing `engine`). Confirmed stale, matches the task's
   claim, and the task correctly schedules a fix.

9. **spec.md delta and tasks.md test list.** Read both in full. Scenarios in the ADDED/MODIFIED
   requirements map 1:1 onto tasks 3.1-3.8 and 4.1-4.7. In particular: 3.2 asserts a mistyped/partial
   dotted reference `$stats.pts_ppr` over `{"stats": 5}` produces an unknown-field error and explicitly
   does **not** silently return `5` — a real behavioural assertion that would catch a wrongly-implemented
   prefix-fallback, not just a name check. 3.8 requires driving the collision scenario through the real
   `JsonFlattener` rather than a hand-built row — correctly refuses to let the ambiguity test prove
   nothing. 4.6 pins the `isDollarPrefixError` legacy-retry gate so a dotted parse failure cannot
   accidentally trigger the legacy fallback — this is exactly the kind of test that would catch the
   quiet-regression class this epic has been burned by before. 4.7 is correctly labeled a
   characterization test, matching correction 1's "already works" framing. Test list is not name-only;
   each one asserts a specific value or specific error content, satisfying standing requirement 3.

10. **D4 wording is treated as behaviour, not decoration.** Task 2.2 requires verifying the wording
    end-to-end at the actual surface a user reads (`PipelineAnalyzeService.scala:270`'s
    `validationError`), not only at the evaluator's raw return value — correctly scoped per standing
    requirement 4.

### Verdict: CONFIRM

Every audited file:line citation in ticket.md and design.md checked out against the actual code, not
just against each other. The central design question (does an unflattened nested row ever reach
`evaluate`/`validate`/`inferType`/`validateTolerant`?) traces to "no" on every one of the six entry
points via the single shared `JsonFlattener.leaves` seam — D3's inherit-and-document choice is
substantively correct, not asserted. The three ticket corrections and the one design self-correction
(JDBC-flat vs. REST-flattened symmetry) are all verified true. The test plan asserts specific values
and specific error content rather than merely naming behaviour, and explicitly covers the collision
case through the real flattener rather than a fabricated flat row.

### Non-blocking notes

- D2's segment grammar (`[A-Za-z0-9_]` runs joined by interior dots) permits a segment to start with a
  digit, e.g. `$a.5` would tokenize as `Ref("a.5")` rather than `Ref("a")` followed by a number. This is
  a real column name the flattener could legitimately produce only if a JSON key itself starts with a
  digit (uncommon but not impossible for API-sourced data) — not a defect, just worth a one-line note in
  the grammar doc if it isn't already implied by the `[A-Za-z0-9_]+` segment regex in spec.md (it is —
  spec.md's `(\.[A-Za-z0-9_]+)*` already documents this precisely). No action needed.
