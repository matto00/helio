## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Root cause, verified independently of any report.** `SchemaInferenceEngine.scala:101-107` —
  `case nested: JsObject => flattenObject(nested, fullKey)`, sorted by key, dotted paths, typed via
  `inferJsonType`. `PipelineRowJson.jsRowToRow` — `case JsObject(fields) => fields.map { case (k, fv) => k -> jsValueToAny(fv) }`,
  one level only. The disagreement in the ticket is real and at the cited lines.
- **Premise-validation "selector already shipped" finding: CONFIRMED.** `RestApiConnectorDriver.toRows(json, rootSelector)`
  exists with the full dotted walk, and its own Scaladoc says a miss "yields `Vector.empty` (curated-empty, not a
  500) plus a server-side warn log — HEL-599 owns the real user-facing error envelope." Not rebuilding it is correct.
- **D9 claim 1 (lexer rejects `.`): CONFIRMED by reading `ExpressionEvaluator.scala:127-142`.** After `$` the
  scanner consumes `isLetterOrDigit || '_'` only, so `$stats.pts_ppr` yields `Ref("stats")`, then `.` enters the
  number branch (`case d if d.isDigit || d == '.'`), consumes just `"."`, and `".".toDoubleOption` is `None` →
  `Left("Invalid number literal: .")`. Matches the field report's "compute config error" exactly.
- **D9 claim 2 (`select`/`lookup` work): CONFIRMED.** `SelectStep.scala:50` is
  `rows.map(row => row.view.filterKeys(fieldSet.contains).toMap)` — exact-key intersection, so a dotted column
  works the moment it exists.
- **D8 seam is real, not wishful.** `mergeObjects` (`SchemaInferenceEngine.scala:82-99`) merges raw `JsObject`s
  *before* `flattenObject` runs, keeping the first non-null per top-level key — so nested sub-keys present only in a
  later row are genuinely invisible today. A pure per-object `leaves` gives HEL-858 a path-level merge point that
  does not exist now. Task 2.2 pins `mergeObjects` as untouched, so this change neither implements nor blocks 858.
- **D2/D3/D4 are decided, not asserted.** D2 is a no-op-on-code contract (`inferJsonType`'s catch-all already gives
  arrays `StringType`; `jsValueToAny`'s `other` already gives compact JSON) with index-expansion rejected on a
  stated, correct ground (row-order-dependent column sets — the same failure mode HEL-858 exists to remove). D3's
  degrade-to-leaf-at-bound is symmetric by construction because it lives in the one shared traversal. D4's
  "sorted pairs, last wins, both projections consume the same `Seq`" is a genuine determinism argument, not a shrug.
- **D7 does close the flat-fixture trap.** Task 5.2 requires confirming the symmetry test is *red* on pre-fix code;
  5.3 is a negative control that the pre-fix shape is absent (not merely that the new column exists); 5.4 forbids a
  hand-written fixture. That is the right shape of evidence for this specific trap.
- **`openspec validate nested-json-row-flattening --strict` → "Change 'nested-json-row-flattening' is valid"**, and
  the `REMOVED` requirement name matches `openspec/specs/rest-api-connector/spec.md:339` verbatim.
- **Scope:** no over-scoping found. The change is a traversal extraction plus one error envelope; expression-lexer
  work is correctly pushed to a spinoff.

### Where the design is factually wrong

`grep -rn "toRows(" backend/src/main/scala` returns **four** REST call sites, not three:

```
RestApiConnectorDriver.scala:320   inferSchema
RestApiConnectorDriver.scala:325   fetch(config, maxRows, …)
RestApiConnectorDriver.scala:387   inferSchemaEphemeral
SourceService.scala:342            previewRest — connector.toRows(json, source.config.rootSelector).take(10)
```

D5 and task 4.1–4.4 enumerate only the first three. `previewRest` is the surface where a user *configures* a
`rootSelector` and immediately looks at the result, so it is the single most likely place the silent empty success
is observed — and it is the one place the design leaves it in place. It already has the right error channel
(`ServiceError.BadGateway(err)` with the HEL-311 curated pass-through, `SourceService.scala:336-340`), so covering
it is one call site, not scope creep.

The same omission has a second consequence the design never addresses: `previewRest` stays in `JsValue` space
(`applyComputedFields(rows: Vector[JsValue], …)`, `SourceService.scala:379-382`) and never touches `jsRowToRow`.
So after this change the preview table still renders `stats` as a nested/JSON value while the DataType and the
executed pipeline rows carry `stats.pts_ppr`. That is a *new* three-way disagreement created by this fix, on a
user-facing surface, and D6's "blast radius / what deliberately does not change" enumerates static sources, the
image connector, SQL, and the non-object fallback — but not preview.

### Verdict: REFUTE

### Change Requests

1. **`design.md` D5 and `tasks.md` 4.4 — correct the call-site enumeration to four.** Add
   `SourceService.previewRest` (`SourceService.scala:342`). Decide and state how a `Left` from `toRowsEither`
   surfaces there; `ServiceError.BadGateway` with the existing HEL-311 curated pass-through is the obvious fit.
   Without this, the acceptance criterion "a missing/invalid selector path … not a silent empty success" is
   unmet on the surface where it matters most.
2. **`design.md` D6 — add the source-preview path to the blast-radius list and decide it explicitly.** State
   whether `previewRest` flattens (so preview, schema, and rows agree) or deliberately does not (with the
   resulting preview-vs-rows divergence named as an accepted, documented limitation). Either answer is
   defensible; leaving it unstated is not, because the divergence is *created* by this change. If the decision is
   to flatten, add the corresponding task and a test; if not, add it to the PR-body risk list beside the
   `stats`-column-shape risk.
3. **`specs/pipeline-run-execution/spec.md` — disambiguate the snapshot scenario.** "Registered schema snapshot
   matches the executed rows / every field in the snapshot corresponds to a column present in the run's rows" is
   false per-row for heterogeneous rows (inference unions across sampled rows via `mergeObjects`; a field present
   only in row 5 is absent from row 1). Reword to the union across the run's rows, matching the per-object scoping
   already used correctly in `nested-json-flattening`'s "Schema and rows agree on the same input" scenario.

### Non-blocking notes

- `tasks.md` 8.2's command is wrong: `openspec validate --change nested-json-row-flattening` errors with
  `unknown option '--change'`. The working invocation is `openspec validate nested-json-row-flattening --strict`
  (verified: exits 0).
- D9 frames the lexer limitation as affecting `compute`/`filter` steps. It equally affects **source computed
  fields** (`SourceService.applyComputedFields` → `ExpressionEvaluator.evaluate`). Task 7.2's documentation should
  name that surface too, and the spinoff ticket should scope both.
- D3's `MaxDepth = 10` is arbitrary but adequately justified (finite, far beyond real API shapes, degrade-not-fail).
  No change requested.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree (`scripts/concertino/` there has only
  assert-phase/cleanup/lib/README/setup-worktree/start-servers). I used the main-repo copy at
  `/home/matt/Development/helio/scripts/concertino/next-report-number.sh`, which returned
  `READY number=1`. Not a gate failure, but the executor should expect the same gap.
