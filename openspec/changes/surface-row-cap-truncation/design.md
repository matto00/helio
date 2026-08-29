## Context

Verified against `main` @ `83e99a0e` by enumeration, not by trusting the ticket's line numbers.

- `ConnectorDriver.fetch(config, maxRows, resolveContext): Future[Either[String, Vector[JsValue]]]` (`ConnectorDriver.scala:123`) has **no channel** for count metadata. Truncation information is destroyed at this boundary.
- `grep "extends ConnectorDriver"` returns **five** implementations: two production — `RestApiConnectorDriver` (`:49`, fetch `:342`) and `SqlConnectorDriver` (`:12`, fetch `:149`) — and **three test fixtures** that each define `fetch` and will therefore fail to compile under D1: `RowSupplyingConnector` (`NewConnectorInferenceSpec.scala:25`, fetch `:37`), `FixtureConnector` (`ConnectorSpec.scala:19`, fetch `:36`), `EnvelopeFixtureConnector` (`CreateSourceEnvelopeSpec.scala:31`, fetch `:43`). CSV/static/text/PDF/image are **not** drivers — they carry static `ConnectorMetadata` in `ConnectorRegistry` only, and the engine loads their rows directly with **no cap at all**. So they can never be truncated by `maxRunRows` and need no signal.
- **Exactly two** production call sites of the capped `fetch`: `InProcessPipelineEngine.scala:176` (REST) and `:181` (SQL). `SourceService.scala:335` calls the *different*, uncapped 2-arg REST overload.
- `sourceRowCount` is not computed in the engine. `PipelineRunService` computes it as `sourceRows.size` at `:368` (run) and `:203-212` (step preview) — always the **post**-truncation count, which is precisely why it is indistinguishable from a genuine 1000-row source.
- `RunResultResponse` (`PipelineProtocol.scala:95`) already has four default-valued fields added by HEL-369/HEL-570; extending it by defaulted fields is the established, non-breaking pattern here. Format is `jsonFormat7` at `:153`.
- The UI's `runSourceRowCount` (`pipelinesSlice.ts:98,488`) is a **dead destructure**: `PipelineDetailPage.tsx:70` pulls it out and no non-test source ever renders it. There is no existing surface to hang a warning on — one must be created.
- The MCP `run_pipeline` tool has **no bespoke text formatter**: `tools/write.ts:376` → `guarded(...)` → `jsonResult(...)` stringifies the `RunOutcome` object verbatim (`write.ts:50-60`). Whatever the object carries is exactly what the agent reads.

## Goals / Non-Goals

**Goals:**
- A truncated run is **distinguishable from a complete one** at the API, at the MCP surface, and on screen — not merely a boolean present in a JSON body.
- No false positives: a source with exactly 1000 rows reports **not** truncated.
- The reported information leads a caller acting on it to a correct conclusion, including when the true total is genuinely unknowable.
- `maxRunRows = 1000` is byte-for-byte unchanged.

**Non-Goals:**
- Pagination — HEL-427 owns it. This change makes truncation honest, not absent.
- Raising or making the cap configurable.
- Per-source *pagination* or any attempt to recover the rows a cap discarded, for any source. Reporting is the whole scope.
- Reporting an available **total** for a secondary (join/union/lookup) source. Truncation of a secondary source IS reported (see D8) — only the exact per-source total is limited to whatever the driver measured.
- Changing the inference/preview caps (100 / 10 / 500) or the uncapped REST infer path.

## Decisions

### D1. Widen the SPI return type rather than adding a parallel method

`fetch` returns `Future[Either[String, FetchOutcome]]`, with:

```scala
final case class FetchOutcome(
    rows: Vector[JsValue],
    truncated: Boolean,
    availableRowCount: Option[Long]
)
```

*Rationale:* two production implementations and two production call sites exist, so the widening is contained. Three test fixtures also implement the trait and must be updated (they are implementations, not call sites — see task 1.5). A parallel `fetchWithStats` alongside `fetch` would leave two methods that can silently drift, and the drift would reintroduce exactly this ticket's bug (a caller taking the path that discards the signal). The compiler enforcing that every implementation answers "did you truncate?" is the point.

*`truncated` and `availableRowCount` are separate fields, not one `Option[Long]`.* They answer different questions and one is knowable without the other: SQL can prove truncation without knowing the total. Encoding truncation as `availableRowCount.exists(_ > rows.size)` would make "truncated, total unknown" inexpressible, which is exactly the SQL case.

### D2. REST reports exactly, with a true total

`RestApiConnectorDriver.fetch` (`:343`) already computes the full `Vector[JsValue]` via `toRowsEither` and then `.take(maxRows)`. The pre-`take` `.size` is the true available count, free — the whole body is already parsed and in memory. So:

- `availableRowCount = Some(all.size)`
- `truncated = all.size > maxRows`

Strictly `>`, not `>=`: a source of exactly 1000 rows is **not** truncated. This is the no-false-positives criterion, and it is exact rather than heuristic.

### D3. SQL proves truncation with a `maxRows + 1` probe, and does not guess a total

The SQL cap is `stmt.setMaxRows(maxRows)` (`SqlConnectorDriver.scala:75`) — pushed to the JDBC driver, so rows beyond the cap never arrive and the true total is unknowable without a second `COUNT(*)` query.

Two rejected alternatives:
- *`truncated = rows.size == maxRows`* — a saturation heuristic. A table with exactly 1000 rows would report truncated. **Violates the no-false-positives criterion**; rejected.
- *Issue a `COUNT(*)`* — a second round trip and a second query timeout on every run, for a number the caller does not strictly need. Rejected as disproportionate.

Chosen: `SqlConnectorDriver.fetch` calls `execute(config, maxRows + 1)`, then returns `rows.take(maxRows)` with `truncated = fetched.size > maxRows` and `availableRowCount = None`. If the `(maxRows + 1)`-th row arrives, more rows provably exist; if it does not, the result is provably complete. Exact in both directions, one round trip, and the memory bound moves by exactly one row.

One latent edge to record in scaladoc rather than guard: JDBC defines `setMaxRows(0)` as *unlimited*, so a hypothetical `fetch(config, 0, ...)` would change from "all rows" to "1 row". No such caller exists — `fetch`'s only callers pass 1000 (engine) and 100 (`SqlConnectorDriverSpec:212`).

`execute` itself is **not** changed — its other callers (`inferSchema` at `maxRows = 100`, `previewSql` at `maxRows = 10`) keep their current behaviour unchanged. The `+ 1` lives only inside `fetch`.

### D4. The run result carries structured fields **and** a server-composed notice

`RunResultResponse` gains four defaulted fields (see D8 for `truncatedReads`), taking it from `jsonFormat7` to `jsonFormat11`:

```scala
sourceTruncated: Boolean = false,
sourceAvailableRowCount: Option[Long] = None,
truncationNotice: Option[String] = None,
truncatedReads: Vector[TruncatedReadResponse] = Vector.empty
```

`truncationNotice` is composed **once, server-side**, and is `None` when nothing was truncated.

There are **three** `RunResultResponse` construction sites in `src/main`, not two: `PipelineRunService.scala:135` (`recordUnrunnable`), `:212` (step preview) and `:425` (real run). `:135` records a run that was never attempted, so no source read occurred and the defaulted `sourceTruncated = false` is factually correct there — noted so a later reader does not have to re-derive it.

*Rationale (this is the load-bearing decision for AC 3 and for "wording is behaviour").* The MCP tool has no formatter — it stringifies the object verbatim — so anything not in the object is invisible to an agent. A bare `"sourceTruncated": true` is exactly the "flag nobody renders" the ticket rules out, and `truncated: true` with no count "invites the reader to guess". Composing the sentence server-side means the agent and the human read the *same* correct wording, and the wording cannot drift between the two clients.

Exact notice text, both branches:

- Total known (REST): `Source "<name>" truncated: this run read the first 1000 rows returned, out of 3303 available, because of the 1000-row run cap. Results computed from this run — including any filter, sort, or aggregate — describe only that partial population, not the full source.`
- Total unknown (SQL): `Source "<name>" truncated: this run read the first 1000 rows returned because of the 1000-row run cap, and more rows exist (the total is not known). Results computed from this run — including any filter, sort, or aggregate — describe only that partial population, not the full source.`
- More than one source truncated (D8): the notice names **each** truncated source with its own read/available counts, using the matching branch above per source, followed by the same single consequence sentence.

All branches name the cap, name what was read, distinguish known from unknown totals without ever implying a number that was not measured, and state the consequence a caller must act on. None is a bare flag.

"the first 1000 rows **returned**" is deliberate: a SQL result set without an `ORDER BY` guarantees no particular ordering, so "the first 1000 rows" alone would imply an ordering the system does not provide.

`sourceRowCount` keeps its current meaning — rows actually read — unchanged. Redefining it to mean the available count would silently change an existing field's semantics for every existing consumer.

### D5. `loadRows` keeps its signature; a sibling carries the stats

`InProcessPipelineEngine.loadRows(ds, repo): Future[Seq[Row]]` has ~20 test call sites and one internal re-entry (`:200`, the join right-source `loadSource`). Changing its signature churns all of them for no behavioural gain.

Instead: add `loadRowsWithStats(ds, repo): Future[(Seq[Row], SourceReadStats)]` holding the per-kind dispatch, and redefine `loadRows` as `loadRowsWithStats(...).map(_._1)`. Only `PipelineRunService.scala:203` and `:365` switch to the stats variant directly; the secondary-source re-entry at `:200` is handled by D8.

`SourceReadStats(truncated: Boolean, availableRowCount: Option[Long])` is `SourceReadStats(false, None)` for every uncapped kind (static/CSV/text/PDF/image), which is factually correct: those paths apply no cap.

### D6. Create-time advisory rides on the schema-inference result, not a second fetch

The ticket implies source creation applies the 1000-row cap. **It does not** — creation/inference caps are SQL infer 100 (`SqlConnectorDriver.scala:147`), preview 10, static payload 500 (a rejection, not a truncation), and REST infer **uncapped** (`RestApiConnectorDriver.scala:334-335`).

So the create-time signal is not "creation truncated your data"; it is a forward-looking advisory: *this source already holds more rows than a run will process.*

**Corrected mechanism.** An earlier draft of this design said the advisory would be "populated on the REST create path in `SourceService`". Tracing the actual call path refutes that: `SourceService.createRestWithConfig` (`SourceService.scala:144-161`) fetches nothing — it inserts the source and delegates the entire response to `CreateSourceEnvelope.build` (`:156`), which calls `connector.inferSchema` (`CreateSourceEnvelope.scala:40`) and constructs every `CreateSourceResponse` itself (`:42-46`, `:60+`). `inferSchema` returns `InferredSchema(fields: Seq[InferredField])` (`model.scala:628`) — **no row count**. Populating the notice in `SourceService` would therefore have required an undisclosed **second full REST request on every source creation**. That is exactly the "read a signature without tracing the caller" error this project's standing requirements name, and it is recorded here rather than quietly fixed.

**Chosen mechanism, with no extra request:** add a defaulted field to the domain type that already crosses this boundary —

```scala
final case class InferredSchema(fields: Seq[InferredField], observedRowCount: Option[Long] = None)
```

`InferredSchema` has 11 construction sites and **no** spray-json format of its own (the wire type is the separate `InferredSchemaResponse`, `DataTypeProtocol.scala:33`), so a defaulted field is additive: every existing site keeps compiling and no wire shape changes.

`RestApiConnectorDriver.inferSchema` (`:334-335`) already materializes the full row vector and currently discards its size — it populates `observedRowCount = Some(size)` for free. `SqlConnectorDriver.inferSchema` samples at most 100 rows and cannot distinguish 101 rows from three million, so it leaves `None` and **no advisory is emitted** rather than a guess.

`CreateSourceEnvelope.build` then composes `rowCapNotice` generically from `observedRowCount` — one place, works for any future connector that can measure a total, and no connector-specific branch in `SourceService`.

### D8. A truncated secondary source is reported, never asserted complete

`ctx.loadSource` (`InProcessPipelineEngine.scala:200`) is consumed by **three** step kinds, not one: `JoinStep.scala:57`, `UnionStep.scala:71`, `LookupStep.scala:88`. Every one of them re-enters the same capped read, so a union over a 50,000-row REST source is capped at 1000 exactly like a join.

Deferring this would have been actively worse than today's behaviour: today the run says nothing, whereas a run-level `sourceTruncated: false` computed from the primary source alone is a **positive assertion of completeness that is false**. Turning silence into a confident wrong answer is precisely the defect class this ticket exists to close, so it is not deferred.

**Design:** `loadSource` in `makeContext` (`:200`) routes through `loadRowsWithStats` and appends any truncated read to a per-run accumulator.

The accumulator follows the `assertionSink` precedent **in its actual shape**, which is a *caller-supplied output parameter*, not an engine-internal field: `executeWithStepCounts` (`InProcessPipelineEngine.scala:87`) already takes `assertionSink: AssertionSink = new AssertionSink`, which the caller constructs before the engine call (`PipelineRunService.scala:350`) and reads afterwards. A new defaulted `truncationSink` parameter mirrors it exactly, and is made thread-safe the same way `AssertionSink` is — guarding its `var` with `synchronized`.

**Both** `PipelineRunService` call sites must construct one, pass it, and merge it with the primary read's stats:

- the real-run site (`:365`), which already passes an `assertionSink`; and
- the **step-preview** site (`:205`), which today calls `executeWithStepCounts(sourceRows, slicedSteps, dataSourceRepo)` with **no sink at all**, falling through to the throwaway default.

The preview site is called out explicitly because following the precedent naively would reproduce its gap: a preview whose `union`/`join`/`lookup` read a truncated secondary source would report `sourceTruncated: false` — precisely the false assertion of completeness this decision exists to prevent — while `specs/pipeline-run-execution/spec.md` requires the same fields on the step-preview result. A defaulted parameter that the preview site forgets to pass is a silent wrong answer, so the preview path carries its own verification task (7.6c).

The run result then carries:

```scala
sourceTruncated: Boolean = false,            // ANY source read in this run was truncated
sourceAvailableRowCount: Option[Long] = None, // the PRIMARY source's total, when measured
truncationNotice: Option[String] = None,
truncatedReads: Vector[TruncatedReadResponse] = Vector.empty
```

`TruncatedReadResponse(dataSourceName: String, rowsRead: Long, availableRowCount: Option[Long])` — one entry per truncated read, primary included, so a caller can tell *which* source was cut and by how much. `sourceTruncated` is `truncatedReads.nonEmpty`, which makes the unqualified spec requirement ("a truncated run SHALL be distinguishable from a run that was not") true as written, with no contradicting Non-Goal.

`sourceAvailableRowCount` stays scoped to the primary source (that is what satisfies the ticket's 3303 acceptance criterion) and its scaladoc SHALL say so explicitly, so it is never read as a run-wide total.

`truncatedReads` is deliberately carried on the API body only, and **not** mirrored into the MCP or frontend types. Both of those surfaces render the composed `truncationNotice`, which already names each truncated source with its own counts, so mirroring the structured list there would add a second representation of the same facts with nothing consuming it. This is a decision, not an oversight; revisit it if a surface ever needs per-source detail programmatically.

### D9. The cap value is defined once, in a companion object

The notice must interpolate the cap rather than embed a literal `1000`, and two separate places need it: the run-result composer and `CreateSourceEnvelope.build`.

`InProcessPipelineEngine` is a `class (fileSystem, connector)(implicit ec)` (`:54`) with **no companion object**, and `maxRunRows` is an instance `private val` (`:65`). `PipelineRunService` holds an engine instance, so an instance accessor would serve it — but `CreateSourceEnvelope.build` (`CreateSourceEnvelope.scala:31-39`) takes `(connector, config, source, now, dataTypeRepo, user, overrides)` and has **no engine reference and no way to obtain one** without a signature change. With only an instance accessor available, the path of least resistance in `build` is a hardcoded `1000` — which this design and the capability spec both forbid.

Therefore: introduce `object InProcessPipelineEngine { val MaxRunRows: Int = 1000 }`, and have the instance `private val maxRunRows` refer to it so the value is still defined exactly once. `CreateSourceEnvelope.build` reads `InProcessPipelineEngine.MaxRunRows` directly; the run-result composer takes it as a parameter from the engine as before. The 1000-row bound is unchanged in value and in effect — only its visibility changes, which is this whole ticket's theme.

### D7. UI renders the notice as a warning, not a number

Because `runSourceRowCount` is a dead destructure, a render surface is created rather than modified: a warning banner on the pipeline detail page, shown only when `sourceTruncated` is true, rendering `truncationNotice` verbatim plus the read/available counts. Rendering the server-composed sentence verbatim is what keeps the human's and the agent's information identical.

## Risks / Trade-offs

- **SPI widening touches every `fetch` test and three test fixtures that implement the trait.** Contained (two production implementations, two production call sites, three fixtures), compiler-enforced, and preferable to a drifting parallel method. Mechanical to update — but the fixtures are implementations, not call sites, and must be updated deliberately rather than patched into compiling.
- **SQL fetches one extra row.** Deliberate, and the smallest exact probe available. The alternative that avoids it is a heuristic that produces false positives on exactly-capped tables.
- **Secondary-source (join/union/lookup) truncation is now in scope (D8), which widens the change.** Accepted: the alternative — a run-level `sourceTruncated: false` over a truncated union — would convert today's silence into a false claim of completeness, which is worse than the bug being fixed. The accumulator is small because D5's `loadRowsWithStats` already computes the stats on every read.
- **`sourceAvailableRowCount` is primary-source-scoped while `sourceTruncated` is run-scoped.** A genuine asymmetry, chosen because the ticket's acceptance criterion is a primary-source total and no single number can honestly summarise several sources. Mitigated by `truncatedReads` carrying per-source detail and by scaladoc/spec stating the scope of each field explicitly.
- **A server-composed notice string is a wire-format commitment.** Accepted deliberately: it is the only way an MCP surface with no formatter and a UI can be guaranteed to say the same correct thing, and the structured fields remain available for any consumer that wants to compose its own wording.
- **`truncationNotice` hardcodes the cap value in prose.** It must be interpolated from `maxRunRows`, never written as a literal `1000`, so raising the bound later cannot desynchronise the message from the behaviour.
