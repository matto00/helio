## 1. Implementation

- [x] 1.1 In `SchemaInferenceEngine.scala`, add the private JSON widening join
      `widenJson(a: DataFieldType, b: DataFieldType): DataFieldType` per design D3 (equal → self;
      `Integer ∨ Float = Float`; `Timestamp ∨ String = String`; any other distinct pair → `String`).
      Comment it with WHY it diverges from the CSV `widenType` order.
- [x] 1.2 Rewrite `fromJson`'s `JsArray` branch to fold `JsonFlattener.leaves` over every `JsObject`
      element into a per-path accumulator of `(type, nullable, sawNonNull)`, emitting one
      `InferredField` per path in sorted path order (design D1, D4). `JsNull` sets `nullable` and does
      not participate in the join (D3); an all-null path emits `StringType, nullable = true`.
- [x] 1.3 Route the root-`JsObject` branch through the same accumulator (single-element case) so there
      is one code path (D1).
- [x] 1.4 Delete `mergeObjects` and its now-unused null-tracking pass. Confirm by grep that `fromJson`
      was its only caller before deleting.
- [x] 1.5 Update the two prose references that `mergeObjects`' deletion leaves dangling:
      `JsonFlattener.scala`'s scaladoc contract block (~line 36) and
      `NestedJsonFlatteningSymmetrySpec.scala` (~line 15). A deleted symbol named in a contract doc is
      confidently-false documentation.
- [x] 1.6 Leave `JsonFlattener`, `inferJsonType`, `displayName`, and the whole CSV path untouched. A
      diff touching `JsonFlattener.scala` beyond the 1.5 comment fix means the approach went wrong.

## 2. Fixtures

- [x] 2.1 Capture a mixed-position slice of the live Sleeper projections endpoint
      (`position[]=QB&position[]=RB&position[]=WR&position[]=TE`, ordered by `pts_ppr`) into
      `backend/src/test/resources/hel858/sleeper-mixed-projections-slice.json`.
- [x] 2.2 Record the fetch command, timestamp and a checksum in `evidence/live-probe-transcript.md` for
      provenance — but do NOT treat that record as proof of adequacy (design D6: it is
      self-referential, and a later re-fetch legitimately will not byte-match because projections
      recompute continuously). Adequacy is asserted in code by task 3.9 instead.

## 3. Tests

Each test is classified **[RED]** (must fail when the source fix is reverted) or **[CHAR]**
(characterisation — must be GREEN both before and after; going red on revert is itself a finding to
report). The committed revert transcript must show exactly this split (design D6).

- [x] 3.1 **[RED]** Order-independence (CENTRAL, AC2): `fromJson(rows) == fromJson(rows.reverse)` and
      against a seeded shuffle, over a heterogeneous fixture whose elements differ in BOTH nested shape
      and numeric precision. Compare whole `InferredSchema` values, not field-name sets.
- [x] 3.2 **[RED]** Position-independence of a nested field (AC1): rows deliberately ordered so element
      0 lacks a nested path a later element carries; assert the path is present.
- [x] 3.3 **[RED]** Widening (AC3): integral-then-fractional and fractional-then-integral both infer
      `float`; number+boolean infers `string` (NOT boolean); timestamp-string + non-timestamp-string
      infers `string`; null + fractional infers nullable `float`; null + integral infers nullable
      `integer` (design D7 — pre-fix a single null forced `string`). The "all-null infers nullable
      `string`" clause is green pre-fix; keep it in a separate **[CHAR]** test (3.3b) so 3.11's
      transcript reads one outcome per artifact.
- [x] 3.4 **[RED]** End-to-end truncation (AC3, design D6). The declared column type MUST be derived
      by calling `SchemaInferenceEngine.fromJson` over JSON rows whose values are `3` then `2.5`; feed
      the resulting type into a `StaticSource` config and run it through `SparkJobSubmitter.loadDataFrame`
      in local Spark mode (as `SparkJobSubmitterSpec`'s existing tests do). Pre-fix, inference declares
      `integer`, `SparkJobSubmitter.jsValueToAny`'s `case (JsNumber(n), IntegerType) => n.toInt`
      truncates `2.5` to `2`, and the test FAILS. Post-fix it declares `float` and `2.5` survives. A
      version of this test that HAND-declares the column `integer` is green on revert and proves
      nothing — the declared type must come from the inference under test. Do NOT test this through
      `PipelineRowJson.jsValueToAny`, which maps `JsNumber` to `toDouble` unconditionally.
- [x] 3.5 **[CHAR]** Nullability unchanged (AC5): explicit `JsNull` ⇒ nullable; mere absence ⇒ NOT
      nullable.
- [x] 3.6 **[RED]** Cross-row leaf-vs-subtree collision (design D5): `{"a":1}` then `{"a":{"b":2}}`
      yields BOTH `a` and `a.b`, and reversing the two rows yields the same schema.
- [x] 3.7 **[CHAR]** Within-object collision (`{"a.b":1,"a":{"b":2}}`) still yields exactly one `a.b`
      field — green since HEL-599 and must stay green.
- [x] 3.8a **[CHAR]** Agreement property over inputs where it already holds pre-fix: single-shape rows,
      dots inside keys, unicode keys, empty-string keys, depth at and beyond `JsonFlattener.MaxDepth`,
      non-object array elements, and the within-object collision. Assert all three clauses (design D6):
      (1) each row's key set ⊆ schema field-name set; (2) schema field-name set == union of all rows'
      key sets; (3) the schema's field-name `Seq` has no duplicates — asserted on the `Seq`, never on a
      fold the schema side does not perform. Must be GREEN both before and after.
- [x] 3.8b **[RED]** The same three clauses over inputs where the fix is what makes them hold:
      heterogeneous shapes (a row carrying `stats.rec` whose key is absent from the pre-fix schema) and
      the cross-row leaf-vs-subtree collision of D5. Both the subset and the union clause fail pre-fix
      on these inputs; a separate test so 3.11's transcript can check one outcome per artifact.
- [x] 3.9 **[RED]** Sleeper regression (AC4): the mixed fixture yields a schema containing `stats.rec`,
      `stats.rec_yd`, `stats.rec_td`. In the SAME test, first assert the fixture's adequacy — at least
      one earlier element lacking the `stats.rec*` family and at least one later element carrying all
      three — so a degenerate or resampled fixture fails loudly rather than passing for the wrong
      reason (design D6).
- [x] 3.10 Characterise the existing WR-only fixture's schema field-by-field against its
      pre-fix schema. Any difference must be REPORTED explicitly in the delivery report, classified as
      either legitimate widening across non-null values (e.g. `integer → float`) or a D7 null-rule flip
      (`string → numeric`, which is a NARROWING and must never be described as widening). Absorbing a
      `string → numeric` flip as "legitimate" is the specific failure this task exists to prevent.
      Split across two tests, reclassified in cycle 3 (evaluation-2.md Finding A / CR1) once
      strengthening the field-by-field pin made the combined test fail on revert:
      **3.10a [CHAR]** — the field-NAME set alone (63 names, same order), which genuinely holds
      both pre-fix and post-fix on this single-shape fixture.
      **3.10b [RED]** — the full pinned `(name, type, nullable)` triple for all 63 fields, which
      is necessarily red on revert (4 of the 63 pinned values are post-fix answers:
      `player.injury_body_part`/`player.injury_status` nullable flips, `stats.pts_half_ppr`/
      `stats.rec_fd` widening). See `evidence/wr-fixture-characterisation.md` and
      `evidence/red-verification.md` for the actual revert transcript reflecting this split.
- [x] 3.11 Produce `evidence/red-verification.md` by ACTUALLY reverting the source change (stash the
      edit, run the suite, capture real output), never by asserting what would happen. The transcript
      must show every [RED] test failing and every [CHAR] test still passing.

## 4. Verification

- [x] 4.1 `sbt "testOnly *SchemaInferenceEngineSpec *JsonFlattenerSpec *NestedJsonFlatteningSymmetrySpec *SparkJobSubmitterSpec"`
      green, then the full `sbt test` suite green.
- [x] 4.2 Confirm no unrelated spec regressed — in particular the CSV inference scenarios and any
      existing REST-source preview test that pins an inferred type.
- [x] 4.3 Note in the delivery report that `inferJsonType` types `2.0` as `IntegerType`, so a
      fractional-valued column sampling only whole floats still infers `integer` — deliberately out of
      scope, stated so it is not mistaken for a miss of this ticket.
- [ ] 4.4 Update `openspec/specs/schema-inference/spec.md` via archive, not by hand. (Deferred — the
      openspec archive step is a separate delivery-phase action, not run by this executor pass.)
