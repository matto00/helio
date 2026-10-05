## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 5ae66fc110fc7b6351ed512694c7bf0319f86f85 (planning artifacts untracked in the change dir).
Cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/output-history-store-summary/HEL-1271`.

### What I verified (with evidence)

- **D-4 is one transaction.** True. `DbContext.scala:63-64` has `withSystemContext(action) = privilegedDb.run(action.transactionally)`. Today `overwriteRows` (`NodeSnapshotRepository.scala:106-137`) already nests `.transactionally` inside it. `(overwriteRowsAction >> andThen).transactionally` inside `withSystemContext` flattens into a single Slick transaction. Sound.
- **D5 exclusions are structural.** True. The routing in `PipelineRunService.scala` goes like this:
  - Dry runs go to `onDryRunSuccess` (:1213).
  - `onRunSuccess` (:1253) branches to `onBlockedRun` (:1338) when there are blocking failures. It branches to `onWriteBackFailure` (:1310) when `applyPendingWriteBacks` returns `Left`. Only the remaining case reaches `onUnblockedRunSuccess` (:1283 → :1366).
  - Engine failures go to `executeRunFailure` (:1093).
  - The only other snapshot writer is the backfill `persistBackfilledRows` (:775 → :779 `overwriteRows`).
  - `grep overwriteRows|INSERT INTO node_snapshots` over `main/` confirms there are no other writers outside the V94 migration.
  - The only `new PipelineRunService(` is in `ApiRoutes.scala:444`. Scheduler, auto-run and hook all reuse `apiRoutes.pipelineRunService` (`Main.scala` ~278, `PipelineSchedulerService.scala:142,220`, `HookTriggerService.scala:74`). So every real trigger path gets history.
- `triggerSource` reaches `executeRun` (:988) but not `executeRunSuccess` (:1141). The threading claim is correct. `val now = Instant.now()` is one value per `onUnblockedRunSuccess`, as the design says.
- `findConfigsByIdsInternal` exists (`OutputRepository.scala:156`), is privileged and runs as one query. The domain `Output` has no `config` (`model.scala:901-915`).
- **Frontend claims.**
  - Metric headline: `Object.values(cfg.fieldMapping)[0]` + `computeAggregate` over `filteredRawRows`, otherwise the first-row cell (`PanelContent.tsx:293-310`).
  - `usePanelData.chartAggregate` is hard `null` (`usePanelData.ts:46,240,269`).
  - `groupAndAggregate` is used only by `OutputPreviewPane.tsx:84-88`, gated on `chartType !== "scatter"`.
  - All of these match the design.
- **V115 / RLS.**
  - The V94 `node_snapshots_{select,insert,update,delete}` policy shape (V94:306-320) is as cited.
  - `outputs.id` / `pipeline_id` are TEXT (V94:207-209).
  - V113 has ENABLE + FORCE (:45-46) and explicit `GRANT ... TO helio_privileged` (:93).
  - `gen_random_uuid()` has migration precedent (V91-V93).
  - The migration inserts no rows, so FORCE at create time is safe under the non-BYPASSRLS Flyway role.
  - `FlywayNonSuperuserMigrationSpec` migrates the whole chain as a non-superuser, so V115 is exercised automatically.
  - Every `TRUNCATE` touching `users`/`pipelines` in tests uses `RESTART IDENTITY CASCADE` (4 sites checked). The UUID PK avoids the sequence landmine.
- **Coercion grammar.** The whitespace set decoded from design.md bytes is TAB/LF/VT/FF/CR/SP/U+00A0/U+1680/U+2000-U+200A/U+2028/U+2029/U+202F/U+205F/U+3000/U+FEFF. That is complete for ES `StrWhiteSpaceChar`. The decimal regex and the hex/binary/octal rules match ES StringToNumber. JDK is 21 (local and CI `java-version: 21`), so shortest `Double.toString` holds.
- **Seam fixture testability: defect found** (CR1). Node probe below. Driving coerce cases through `sum` cannot distinguish "not coercible" (null) from 0. In particular it is blind to treating blank strings as 0, which is the exact bug `coerceNumber`'s `trim() === ""` guard exists to prevent:
  ```
  ""    sum real/buggy: 0 0   max real/buggy: null 0
  "   " sum real/buggy: 0 0   max real/buggy: null 0
  ```
- **Group key `String(number)`: defect found** (CR2). Node: `String(2**63)` → `"9223372036854776000"`, `String(1e20)` → `"100000000000000000000"`, `String(-0)` → `"0"`.
- Wiring: `nodeSnapshotRepoOpt = Option(dbContext).map(new NodeSnapshotRepository(_))` (`ApiRoutes.scala:247`) is the precedent the D-5 fallback copies. There are 19 files with `new ApiRoutes(`, so avoiding constructor churn is the right call.
- Multi-row insert precedent: `++=` is used at `PipelineRunRepository.scala:410` and `DataSourceRepository.scala:350`. There is no `#$`-spliced VALUES precedent.

### Verdict: REFUTE

The design is close and mostly accurate against the tree. Four specific revisions are needed. Two are fidelity/testability defects in the core reducer port and seam, which the ticket's AC "reducer matches aggregate.ts on shared fixtures" depends on.

### Change Requests

1. **design.md D-2 "Shared fixture" + tasks.md 2.2: coerce cases must not be driven through `sum`.** `computeAggregate(sum)` returns 0 both for a non-coercible value and for a value coerced to 0. So the Jest oracle cannot express `expected: null` for `""`, `"   "`, `"abc"`, `"1e400"`, `"-0x1"`, and so on. A Scala port that coerces blank/whitespace strings to 0 would pass the seam (probe above). Specify that the Jest test drives each coerce case through `computeAggregate([{f: value}], "f", "max")` (or `min`/`avg`), which returns `null` when nothing coerces. `expected` is then exactly the coerced value or `null`. Add an explicit mutation to task 2.4: make Scala `coerceNumber` treat a blank string as 0, and the seam spec must go red.

2. **design.md D-2 group key: the `Number::toString` port is mis-specified for large integral doubles.** "integral and |d| < 1e21 → no decimal point" implies printing the exact integer value. ECMAScript instead prints the shortest round-trip digits padded with zeros: `String(2**63)` is `"9223372036854776000"`, while `BigDecimal(d).toBigInteger` gives `...808` and `d.toLong` gives `...807`. This affects any groupBy over a large ID column (e.g. 19-digit snowflake IDs, which `PipelineRowJson` emits as `JsNumber`). Respecify the whole algorithm per ES Number::toString:
   - Take the shortest digits `s` (k digits) and exponent `n` from `Double.toString` (JDK 21) for every finite double.
   - k ≤ n ≤ 21 → digits followed by n−k zeros.
   - 0 < n ≤ 21 → decimal point inside.
   - −6 < n ≤ 0 → `0.` + zeros.
   - Otherwise use exponent form with an explicit `+`.
   - `-0` → `"0"`.

   Add fixture group-key cases for `2**63`, `1e20`, a 19-digit integer above 2^53, `-0`, `1.5e-7` and `123.456`, alongside the existing `1.0`/`2.5`/`1e21`/`1e-7`.

3. **tasks.md 4.2: the named red mutation "run without `.transactionally`" is a no-op.** `withSystemContext` already applies `.transactionally` (`DbContext.scala:64`), so removing it from `overwriteRowsWith` leaves the rollback test green. That is exactly the kind of mutation that exercises nothing, and it would block a C2-compliant red. Name the mutation that actually breaks atomicity: run `overwriteRowsAction` and `andThen` in two separate `ctx.withSystemContext` calls. Apply the same correction to the service-level rollback in 4.4.

4. **design.md D-3 `insertAction`: pin the mechanism to bound parameters.** "ONE multi-row `INSERT`" with variable arity pushes a Slick plain-SQL implementer toward building a `VALUES (...),(...)` string with `#$`. The summary JSONB carries user-controlled column names and string x-values (series points), so splicing would be an SQL-injection vector on the privileged BYPASSRLS pool. Specify a lifted-table `++=` (JDBC batch, one round trip, repo precedent `PipelineRunRepository.scala:410`) or a fully parameterized statement, and forbid `#$` interpolation of any entry field. Adjust D-6's "extra SQL statements" expectation to match the chosen mechanism (a JDBC batch is one round trip but N statements unless `reWriteBatchedInserts` is on).

### Non-blocking notes

- **Output deleted mid-run.** An Output deleted between `listByPipelineInternal` and its node transaction now makes the history insert hit an FK violation. That fails the node transaction, so the snapshot is not replaced and the run future errors. Before this change, `updateSchemaInternal` silently updated 0 rows. This is a D9 consequence, but it is not in Risks. Either record it there or narrow the window with `INSERT ... SELECT ... WHERE EXISTS (SELECT 1 FROM outputs WHERE id = ...)`.
- **Run marked succeeded despite materialization failure.** In `onUnblockedRunSuccess`, `updateMeta`/`updateRun` are eager `val` Futures (:1505-1509) that mark the run `succeeded` regardless of `materializedWrites`. A node-2 failure therefore leaves node-1 history from a run the API reports as an error while `pipeline_runs` says succeeded. This is pre-existing (HEL-905 D3) and only worth one line in Risks.
- **Thinning partitions include `age_class`.** A 1h/1d bucket straddling the 24h or 7d boundary can briefly keep two points. This is self-healing on later passes, but the repository test should not assert "≤1 per hour" across a class boundary. Also flag for L2/L3: within 24h, keeping the newest point per 5-min bucket means D6's `previous_run` (second-newest) is "previous retained point", not literally the previous run, after a thinning pass.
- **Previews not listed.** D5 names "previews", but the design and spec exclusion lists do not. Previews never reach `executeRun`, so they are structurally excluded. Say so in one line so the spec's exclusion list matches D5.
- **Metric field resolution for multi-key `fieldMapping`.** The design prefers `fieldMapping.value`, but the dashboard uses `Object.values(fieldMapping)[0]` (insertion order, which a spray `JsObject` cannot reproduce). Record this as a deliberate divergence alongside the L3/L5 notes.
- **D-5 redundancy.** D-5 both adds a Main constructor param and keeps an `Option(dbContext)` fallback. The fallback alone matches the `nodeSnapshotRepoOpt` precedent. Either is fine; pick one and justify it.
- **RlsPrivilegedDmlSpec seeding.** `RlsPrivilegedDmlSpec` currently has no `outputs`/`node_snapshots` coverage (its own comment at :208-212). The new block must seed a parent `outputs` row, and `cleanDb()`'s table list should include the new table.
