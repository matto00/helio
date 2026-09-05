## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **D1 (CSV → StringType for every column) matches runtime materialization exactly.**
   Read `SchemaInferenceEngine.fromCsv` (backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala:35-67).
   Confirmed the header-only branch (line 44) and the empty-dataRows branch both already return
   `StringType`, and the spec/design's plan to seed `StringType` for every column (replacing
   `IntegerType` seed + `widenType`) makes every scenario in the spec delta true against the code
   as currently written, once `widenType`'s call site is removed. Nullability logic (empty-cell,
   ragged-row) is untouched and correctly retained per D1/HEL-868. No placeholder/gap found here.

2. **D2's static-source mapping matches `PipelineRowJson.parseStaticRows`/`jsValueToAny` exactly.**
   Read `PipelineRowJson.scala:53-59` and `:102-112`. `jsValueToAny` maps `JsNumber(n) => n.toDouble`
   unconditionally (no int/float distinction) and `parseStaticRows` zips column names against
   `jsValueToAny`-converted cells with no read of `columns[].type`. D2's `JsNumber → float` mapping
   is the only correct choice given `Double` is what materializes for every JSON number, whole or
   not — verified directly against code, not the design's paraphrase.

3. **Group 6 test tasks are genuine runtime-type proofs.** 6.1/6.2 assert `isInstanceOf`/runtime
   class of materialized cells, not just "inference ran without error"; 6.3 pins the retained
   JSON/REST divergence with an assertion that fails if it's later silently closed; 6.4/6.5 are
   real regression/no-change proofs. This is the central demand the ticket makes and the task list
   satisfies it in substance, not just in form.

4. **No Flyway migration, no touch on sibling-owned files.** Grepped proposal/design/tasks for
   `migration`, `RestApiConnectorDriver`, `LocalFileSystem`, `queryParams` — none touched; D4
   explicitly forbids a migration/backfill. Confirmed clean.

### Problems found

**Finding 1 — D4's refresh promise is false for static sources; tasks.md never wires the fix into the static refresh path.**

D4 states: "`data_sources.inferred_schema` for existing CSV/static sources keeps its stale types
until that source is next created **or refreshed**, at which point the corrected projection is
written." The ticket's AC5 makes the same promise explicitly for both kinds.

Task 2.2 only wires the new materialized-type helper into "`DataSourceService`'s static **create**
path" (`createStatic`, DataSourceService.scala:98ff). I read the static **refresh** path,
`applyStaticRefresh` (DataSourceService.scala:611-638), and it is a structurally separate method
that still projects the schema straight from `payload.columns` — the caller-declared type
(`DataFieldType.validateAndCanonicalize(col.\`type\`).getOrElse(col.\`type\`)` at line 631) — never
from the resubmitted rows' materialized `JsValue` kinds. Nothing in tasks.md touches this method.

Concretely: a static source declared `{"name":"count","type":"integer"}` with numeric cells, after
this change ships, still reports `count` as `integer` (not `float`) the next time a user refreshes
it with new rows via `PATCH .../refresh` — the exact declared-vs-runtime defect this ticket exists
to close, reachable through a path the design promised was fixed and the tasks never touch.

**Finding 2 — D3 misidentifies `SchemaInferenceFacade.toSchemaFields` as a CSV override-application site; it is not, and "fixing" it there would break REST/SQL/JSON overrides.**

D3 says the override-rejection guard is needed at "`SchemaInferenceFacade.toSchemaFields` AND the
un-migrated inline duplicates in `DataSourceService`" (plural sites in `DataSourceService`).
I traced every call site of `toSchemaFields`: it is called exactly once, from
`CreateSourceEnvelope.build` (CreateSourceEnvelope.scala:48), which is the shared envelope for the
generic `ConnectorDriver[Config]` SPI — i.e. REST/SQL/JSON sources, not CSV. CSV has no route
through `toSchemaFields` at all; CSV's only override-application site is the inline block in
`DataSourceService.createCsv` (DataSourceService.scala:187-194). `createCsvUrl` takes no overrides
parameter, and `finishCsvRefresh` (the CSV refresh path) also applies no override — both are
already override-free and need no guard. `toSchemaFields` has no source-kind parameter to
distinguish "this call originated from a CSV path" from "this call originated from REST/SQL" — it
cannot correctly host a CSV-only constraint without a signature change the design never proposes.

If task 3.1 is implemented literally against D3's text (add the string-only rejection inside
`toSchemaFields`), it will reject legitimate non-string type overrides on REST/SQL/JSON sources —
a functional regression outside this ticket's scope, and a violation of "no runtime/behavior
change for JSON/REST/SQL" (D5, Non-Goals). The fix belongs solely in `DataSourceService.createCsv`'s
inline block; `toSchemaFields` must be left alone.

Task 3.1's own text ("both the CSV create and CSV infer/upload paths") also does not match the
routes I found: `DataSourcePreviewRoutes.scala:68` calls `dataSourceService.infer(bytes)` with no
overrides parameter at all (pure preview, nothing to reject), so there is only one real
override-application site for CSV, not two. This should be corrected so the task doesn't send the
implementer looking for a second site that doesn't exist, or misapplying the guard to the wrong
function.

### Verdict: REFUTE

### Change Requests

1. **design.md D4 / tasks.md group 2**: Add a task wiring the materialized-type helper (from task
   2.1) into `DataSourceService.applyStaticRefresh` (DataSourceService.scala:611-638), replacing its
   current `payload.columns`-declared-type projection with the same derivation used at create time.
   Without this, AC5's "corrected on next refresh" promise is false for static sources, and D4
   should be corrected to either state this limitation explicitly (if intentionally deferred, which
   would need its own product sign-off since it contradicts the ticket's stated AC) or the task
   added to actually make the promise true.

2. **design.md D3**: Correct the file/site list. Drop `SchemaInferenceFacade.toSchemaFields` as a
   guard location — it serves the generic `ConnectorDriver` (REST/SQL/JSON) path, not CSV, and has
   no source-kind signal to condition on; adding the CSV-only string constraint there would
   regress REST/SQL/JSON overrides, which this change (D5/Non-Goals) explicitly must not touch. The
   guard belongs solely in `DataSourceService.createCsv`'s inline override-application block
   (DataSourceService.scala:187-194).

3. **tasks.md 3.1**: Correct "on both the CSV create and CSV infer/upload paths" — verified there is
   exactly one CSV override-application site (`createCsv`); the preview/infer route
   (`DataSourcePreviewRoutes.scala` → `DataSourceService.infer`) takes no overrides and needs no
   guard, and `createCsvUrl`/`finishCsvRefresh` likewise apply no override. State the single real
   site explicitly so 3.2's verification isn't chasing a second path that doesn't exist.

### Non-blocking notes

- D1/D2's mappings are exactly right against the code as measured; no changes needed there.
- The escalated option-1-vs-option-2 decision and its rationale are not re-litigated here, per
  instructions — this review is confined to the design's faithfulness to that decision.
