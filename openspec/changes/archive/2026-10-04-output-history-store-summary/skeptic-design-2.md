## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 5ae66fc110fc7b6351ed512694c7bf0319f86f85 (the planning artifacts are untracked in the change dir).
Cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/output-history-store-summary/HEL-1271`.

### Round-1 change requests: were they fixed in substance?

1. **CR1 (coerce cases driven via `max`, not `sum`): fixed.**
   - design.md D-2 "Shared fixture" now drives each case through `computeAggregate([{f: value}], "f", "max")`. tasks.md 2.4(a) adds the blank-as-0 mutation.
   - Against the live `frontend/src/utils/aggregate.ts`, `max` returns `null` when `nums.length === 0`. So `expected` is exactly "coerced value or null", and a blank-as-0 port gives `0 ≠ null`, which turns the seam red.
2. **CR2 (ES `Number::toString` port): fixed for every normal double. A residual inaccuracy remains for subnormals** (CR2 below).
   - The k/n case analysis now matches ES: k≤n≤21 zero-pad, 0<n≤21, −6<n≤0, exponent with an explicit sign, and −0 → "0".
   - All the required fixture cases are listed. Mutation 2.4(b) names the `2**63` case.
3. **CR3 (real two-transaction mutation): fixed.**
   - tasks 4.2 and 4.4 now name "two separate `ctx.withSystemContext` calls".
   - Re-verified: `DbContext.scala:63-64` is `privilegedDb.run(action.transactionally)`, so the two-call split really does break atomicity, while removing `.transactionally` would not.
4. **CR4 (bound parameters, no `#$`): fixed.**
   - D-3 pins the lifted `++=` (or a fully parameterized statement) and forbids `#$` on any entry field.
   - The JSONB binding is sound. `OutputRepository.scala:304-308` maps `JsObject` to `String` via `MappedColumnType`, and `application.conf:32,109` sets `stringtype = "unspecified"`, so a String bound into a JSONB column is accepted, exactly as `outputs.config` (V94:213 JSONB) already works.
   - D-6's statement-count expectation was updated to match.

The round-1 non-blocking notes were all absorbed into design.md: Risks covers the FK race, the eager `succeeded`, the age-class straddle, `previous_run` semantics and multi-key `fieldMapping`. D-4 adds the preview line, and D-5 now justifies keeping both the Main param and the fallback.

### What I verified independently (with evidence)

- **Write-path claims.**
  - `NodeSnapshotRepository.overwriteRows` (:106-137) matches D-4's description.
  - In `onUnblockedRunSuccess` (`PipelineRunService.scala:1366-1430`), `val now = Instant.now()` is single-valued (:1381). The node loop derives `(nodeStepIdOpt, explicitRootIdOpt)` from `StepKey`/`RootKey`, so a root-bound node always carries an explicit root id. D-4's "use the explicit root id" is therefore always available.
  - The per-node sequencing and the `listByPipelineInternal` placement are as described.
- **Frontend reference.**
  - `computeAggregate`/`groupAndAggregate` (aggregate.ts) match D-2's port spec: `count` is `!= null`, `sum` is 0 when empty, avg/min/max are null when empty, the key is `String(row[groupBy])`, categories use default `.sort()`, and values use `?? 0`.
  - The metric headline is at `PanelContent.tsx:293-308`.
  - `MetricAggregation {value, agg}` and `ChartAggregation {groupBy, agg, yField}` (`panel.ts:73-82`) match D-2's config field names.
- **RLS.**
  - The V94 `node_snapshots_*` policy shape (V94:306-320) is as cited.
  - `outputs.owner_id UUID REFERENCES users(id)` (V94:210) and `users.tier` (V88) exist, so `thinAndPurge`'s tier join is feasible.
  - `RlsPolicyGuardSpec.rlsTables`, `RlsPrivilegedDmlSpec` and `FlywayNonSuperuserMigrationSpec` all exist.
  - The existing `SET ROLE helio_app_test` specs (e.g. `RlsSharingAwareTablesSpec.scala:79-92`, `ApiTokenAuthSpec.scala:110-116`) run migrations as `postgres` and GRANT DML on all tables to `helio_app_test`. So `helio_app_test` is a **non-owner** role there, which matters for CR1 below.
- **Group-key port vs JDK 21, probed live** (openjdk 21.0.12, node):
  ```
  value         JS String()   JDK Double.toString
  2**63         9223372036854776000   9.223372036854776E18   (port → ok)
  1e23          1e+23         1.0E23                         (ok)
  0.1+0.2       0.30000000000000004  0.30000000000000004     (ok)
  5e-324 (MIN)  5e-324        4.9E-324                       (MISMATCH)
  1e-323        1e-323        9.9E-324                       (MISMATCH)
  ```
  JDK 19+ `Double.toString` is *not* unconditionally shortest. Its spec selects among length-2 decimals when the minimal length is 1, so for subnormals it emits a 2-digit decimal where ES emits 1 digit. D-2's claim "shortest since JDK 19" is false at this edge.

### Verdict: REFUTE

All four round-1 requests are fixed in substance. One new defect is the same class as round-1 CR3: a named red mutation that cannot go red. It sits in the C1/C2-critical RLS proof, so it blocks. A second, small correction is bundled with it.

### Change Requests

1. **tasks.md 1.3: the RLS proof's red mutation "dropping FORCE" is a no-op, and the insert-rejection assertion is unpinned.**
   - The proof runs under `SET ROLE helio_app_test` (C1). In every existing harness of that kind, `helio_app_test` is not the table owner (tables are created by `postgres`; `helio_app_test` only gets GRANTs, see `RlsSharingAwareTablesSpec.scala:79-92`). Postgres applies RLS to non-owners regardless of `FORCE`, so dropping FORCE leaves every assertion green.
   - "policy `USING (true)`" turns only the SELECT/non-grantee case red. It does nothing for "INSERT without context is rejected", which is gated by the INSERT policy's `WITH CHECK`.
   - Also, SQLSTATE 42501 is shared by "permission denied for table" and "new row violates row-level security policy". An insert assertion that only checks "an exception was thrown"/42501 would pass vacuously on a missing GRANT.

   Required revisions:
   - (a) Strike "dropping FORCE" as a mutation for the `helio_app_test` proof. If FORCE itself is to be proven, do it in an owner-role harness like `ProductTelemetryDbHarness` (non-superuser table owner), or by asserting `relforcerowsecurity` in `FlywayNonSuperuserMigrationSpec`/`RlsPolicyGuardSpec`.
   - (b) Name one red mutation per assertion: SELECT policy `USING (true)` for non-grantee-sees-0, and INSERT policy `WITH CHECK (true)` for insert-without-context. The grantee-visible case needs a mutation that makes it red, e.g. a policy keyed on direct ownership instead of `helio_can_access_pipeline`.
   - (c) The insert-rejection test must assert the message contains `row-level security policy` (not just a thrown exception or 42501).

2. **design.md D-2 group key: correct the "shortest since JDK 19" premise for subnormals.** The probe above shows that JDK 21 gives `4.9E-324` and `9.9E-324` where JS gives `5e-324` and `1e-323`. Either option is acceptable:
   - (a) After extracting digits from `Double.toString`, when k = 2, test whether a 1-digit candidate (the two neighbouring 1-significant-digit decimals) parses back to the same double, and use it if so (ES requires minimal k). Add `5e-324` and `1e-323` group-key fixture cases.
   - (b) Record the subnormal divergence explicitly in Risks and remove the "shortest" claim.

   (a) is cheap and keeps the fidelity claim true. Either is acceptable; the design must not assert a property the JDK does not have.

### Non-blocking notes

- **D-2 `columns.count` semantics.** "Stats use `coerceNumber`" implies count = coercible cells. That differs from `computeAggregate`'s `count` (non-null cells). Name it explicitly in the spec so L3 does not conflate the two.
- **Metric field fallback to `aggregation.value`.** The dashboard (PanelContent.tsx:298) never reads `aggregation.value`; it uses only `Object.values(fieldMapping)[0]`. The fallback is harmless, because it is reached only when `fieldMapping` is empty, where the dashboard shows nothing. It is still a divergence; add it to the existing multi-key Risks line.
- **Natural RLS home.** Consider extending `RlsSharingAwareTablesSpec` (which already has the sharing fixtures) rather than a fresh spec. This is the implementer's choice.
- **Hex grammar.** `0x` with no digits must be null (JS `Number("0x")` is NaN). D-2 says "hex digits"; make it "one or more", and consider adding `"0x"` to the fixture.
