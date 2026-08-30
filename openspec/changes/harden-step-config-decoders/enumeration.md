# Field enumeration — HEL-814 (tasks 1.1, 1.2, 1.2b)

## Method and scope

Walked every file in `backend/src/main/scala/com/helio/domain/steps/`. The directory holds 25 files:
`README.md`, `StepCodecUtil.scala`, and **23 step-kind files**. Verified in both directions:

* **No step kind omitted** — the 23 files each export exactly one `object <X>Step { val companion }`, and
  `PipelineStep.Registry` (`domain/model/PipelineStep.scala:122-146`) has exactly 23 entries. `Registry.size == 23`
  is asserted by a new test (`PipelineStepRequiredConfigSpec`), so the enumeration cannot silently drift.
* **None wrongly included** — `README.md` and `StepCodecUtil.scala` declare no `Config`/`companion` and are
  excluded; both are named here so their exclusion is a recorded decision rather than an oversight.

`SortKey` (`SortStep.scala:13`), `FilterCondition` (`FilterStep.scala:15`), `AggregateField`/`Aggregation`
(`AggregateStep.scala:14/21`) and `AssertRule` (`AssertStep.scala:21`) are *element* types reached through an
array-valued key; they are enumerated under their owning key rather than as step kinds.

## Requiredness rule applied (stated once, applied uniformly)

`required` in the table below means **required at RUN and ANALYZE time** — the D3 runtime-completeness
declaration. It never means "rejected on write" (D2 rejects wrong **type** only) and never means "raises on
decode" (D1 raises on wrong **type** only).

A field is marked `required` only when **both** hold:

1. Its missing/empty value makes the step emit output that **misrepresents the configuration** — a fabricated
   column name, an unmatched join, or an annihilated row set — rather than a pass-through no-op. (D3's own
   rationale: "legitimate to save is not legitimate to run", motivated by `compute` writing a field named `""`.)
2. **No shipped spec statement blesses the absent or empty value**, per the per-field citation column below.

Where a spec already prescribes a *different, graded* response to the empty value (a failed assertion result, an
existing descriptive run error, an existing analyze `validationError`), the field is `optional-with-legitimate-default`
**for this declaration** and the citation records where the guarantee is already discharged. Adding a second,
blunter response would contradict the shipped behaviour, not harden it.

## Tolerance mechanisms (task 1.2)

* **M1 — item-level drop.** `items.flatMap(it => Try(it.convertTo[T]).toOption)`: a mismatched *element* is
  dropped and its siblings kept, producing a partially-decoded collection.
  `AggregateStep:39,44`, `SortStep:30`, `FilterStep:36`, `WindowStep:42`.
* **M2 — array/scalar default.** `collect { case JsString(s) => s }` (drops non-string elements) and
  `StepCodecUtil.stringOr` (a present-but-wrong-typed scalar silently takes the default).
  `collect`: `DedupeStep:28`, `SelectStep:20`, `FillNullStep:29`, `GroupByStep:23`, `WindowStep:38`,
  `UnpivotStep:30,34`, `LookupStep:31`, `StringOpsStep:49`, `PivotStep:26`.
  `stringOr`/`intOr`: 41 call sites across 17 step files.
* **M3 — enum/numeric coercion with no validation.** `filter.combinator` (any value yields `AND` at runtime),
  `dedupe.keep` (anything but the literal `"last"` yields `"first"`), `splittext.mode` (anything but `"heading"`
  behaves as `"paragraph"`), `chunkbytokencount.encoding` (`KnownEncodings` miss rewrites to `"o200k_base"`),
  `StepCodecUtil.intOr` / `WindowStep:49` / `StringOpsStep:45` (`toIntExact` failure silently takes the default),
  `LimitStep:21` (a non-representable count becomes `0`, which **means unlimited**).
* **M4 — `asObject` non-object fallback.** `StepCodecUtil.asObject:19-22` turns a stored top-level scalar
  (`"42"`) into `JsObject.empty`, so the whole config becomes all-defaults. See task 2.4 below.
* **M5 — object-valued key fallback (found during this enumeration; not in the ticket's list).**
  `AssertStep:65-68` (`params`) and `CastStep:23` / `RenameStep:~` (`Try(...).getOrElse(Map.empty)`) replace a
  present-but-wrong-typed **object-valued** key with an empty object/map. Distinct from M2 (scalar/array) and from
  M4 (top-level). Named here so the extractor set in task 2.1 covers it.

## Task 2.4 — `asObject`'s non-object fallback: COVERED by D1, not exempted

`asObject` is the top-level analogue of M5: a stored `"42"` is a value present at the config position whose JSON
type cannot represent an object. Exempting it would leave the one case where *every* key silently defaults, which
is strictly the worst instance of the class. It therefore raises.

The test this moves is **`AssertStepSpec.scala:55-58`** (`AssertConfig.decode("42") shouldBe AssertConfig(Vector.empty)`)
— named here rather than discovered. It is re-pointed at the raise. The `pipeline-assert-op` delta covers it:
its narrowing is scoped to "a value **present but whose JSON type cannot represent the declared shape**", and a
top-level scalar in place of the config object is exactly that.

## The table

Columns: **how read** / **default** / **JSON type** / **requiredness** / **spec citation (requirement text read)** /
**conclusion**. The citation and conclusion columns are mandatory for every `required` field (task 1.2b) and are
filled in for the pinned-optional traps as well.

### 1. `aggregate` (`AggregateStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `groupBy` | M1 | `Vector.empty` | array of `{name,type}` | optional-with-legitimate-default | `pipeline-aggregate-op:7-8` "select **zero or more** group-by fields"; scenario `:47-49` "created and persisted with config `{"groupBy":[],"aggregations":[]}`" | Spec blesses empty. Optional. |
| `groupBy[].name`/`.type` | `convertTo` | — (M1 drops element) | string | n/a (element) | same | Element becomes strict per 2.3; requiredness not applicable. |
| `aggregations` | M1 | `Vector.empty` | array of `{alias,fn,field}` | optional-with-legitimate-default | `pipeline-aggregate-op:47-49` named scenario persists `{"aggregations":[]}` as the step's **initial** config | Spec blesses empty explicitly as a persisted state; empty yields group keys only, no fabricated name. Optional. |
| `aggregations[].fn` | `convertTo` | — | string enum | already validated | `pipeline-aggregate-op` + `pipeline-step-config-validation` (shipped) | Already rejected at run (`AggregateStep:95`) and analyze (`validateAggregate`). Not re-declared. |

### 2. `assert` (`AssertStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `rules` | M2-ish (`case Some(JsArray)`) | `Vector.empty` | array of objects | optional-with-legitimate-default | `pipeline-assert-op:20-23` + scenario `:25-27` "Missing rules key decodes to an empty rule vector"; restated in this change's own `pipeline-assert-op` delta `:4-7` | Spec blesses absence. Optional. |
| `rules[].kind` | `stringOr` (M2) | `""` | string enum | optional-with-legitimate-default **for D3** | `pipeline-assert-op:11-13` "At execute time the engine SHALL return the input rows unchanged"; `:45-50` analyze SHALL emit a `validationError` when a rule's `kind` is not allow-listed; `pipeline-assert-fail-policy:7-11` an error-severity failed result blocks the DataType update | **Already discharged, twice, in a graded way.** Analyze reports it (`inferAssert`); run records a failed `AssertionResult` (`AssertStep:139-140`) which the fail-policy escalates to a blocked run for `severity: error` and deliberately does **not** for `warn`. A blunt run-abort would contradict `:11-13` and collapse the warn/error grading. Optional here. |
| `rules[].field` | scalar-opt (M2) | `None` | string | optional-with-legitimate-default **for D3** (conditionally required, **already** enforced) | `pipeline-assert-op:10` "`field` (**optional** string)"; `:45-50` analyze SHALL flag an absent `field` on `notNull`/`unique`/`range`/`regex` and SHALL NOT for `rowCountMin`/`rowCountMax`, with named scenario `:71-74` | Same as `kind`: the element-level conditional requiredness this task calls out is **already** specified and implemented at analyze (`inferAssert`) and at run (`AssertStep.requireField:153-157` → malformed result → fail-policy). Re-declaring it in D3's run-abort would double-report and override the specced grading. Optional here; see the "conditional support" note under §24. |
| `rules[].params` | M5 | `JsObject.empty` | object | optional | delta `pipeline-assert-op:4-7,39-42` "`params` contents are deliberately open" | Optional; contents stay open, but a non-object **type** now raises (delta `:9-11`). |
| `rules[].severity` | `stringOr` (M2) | `"warn"` | string enum | optional-with-legitimate-default | `pipeline-assert-op:10-11`, `:59-63` analyze flags an invalid severity | Default is specced; invalid values already reported. Optional. |

### 3. `cast` (`CastStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `casts` | M5 | `Map.empty` | object of string→string | **optional-with-legitimate-default (PINNED, design.md D8)** | `pipeline-cast-op:35` "Empty casts map is a no-op"; `pipeline-step-config-rejection:67-70` "An omitted key is not rejected" | Spec blesses empty AND absent. Optional. Not re-decided. |

### 4. `chunkbytokencount` (`ChunkByTokenCountStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `field` | `stringOr` (M2) | `""` | string | **required** | `pipeline-chunk-by-token-count-op:10-14` — the requirement enumerates every key **with its default** (`targetTokenCount` "defaults to `500`", `encoding` "defaults to …", `indexField` "defaults to …", `tokenCountField` "defaults to …") and declares `field` alone with **no default**: "`field` (string, the source column name)" | No spec statement blesses an absent or empty `field`. Empty `field` makes `:14-16` ("if the value of `field` is `null` or the field is absent, the row SHALL be dropped") annihilate the entire row set while reporting success. Required. |
| `targetTokenCount` | `intOr` (M2/M3) | `500` | integer | optional | `:11` "defaults to `500`" | Spec states the default. Optional. |
| `encoding` | M3 | `"o200k_base"` | string enum | optional-with-legitimate-default, **unknown value rejected at analyze/run (D4)** | `:12-13` (shipped) "falls back to `o200k_base` for any other value" — **contradicted deliberately**; this change carries a MODIFIED `pipeline-chunk-by-token-count-op` delta (`:7-9`, `:47-52`) | Absence stays blessed; the *fallback for an unknown value* is the guarantee being narrowed, and it has a delta. |
| `indexField` | `stringOr` | `"chunkIndex"` | string | optional | `:13` "defaults to `\"chunkIndex\"`" | Optional. |
| `tokenCountField` | `stringOr` | `"tokenCount"` | string | optional | `:13-14` "defaults to `\"tokenCount\"`" | Optional. |

### 5. `compute` (`ComputeStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `column` | `stringOr` (M2) | `""` | string | **required** | Shipped `pipeline-compute-op:70-72` (UI requirement) "An empty `column` or `expression` SHALL be **permitted during editing** but SHALL be persisted as-is" — a **write/edit** blessing only, not a run/analyze one. This change's `pipeline-compute-op` delta `:21-25` supplies the run/analyze rule and `:70-73` the scenario | The only shipped blessing is scoped to editing/persisting, which D2 preserves. Required at run/analyze, with a MODIFIED delta in this change (D7). |
| `expression` | `stringOr` (M2) | `""` | string | **required** | Same citation; delta `:25` "The same applies to a missing or empty `expression`" | Same conclusion. |
| `type` | scalar-opt | `None` | string | optional | `pipeline-compute-op:11` "The `type` key on the wire SHALL be tolerated but ignored" | Optional. |

### 6. `datebucket` (`DateBucketStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `field` | `stringOr` (M2) | `""` | string | **required** | `pipeline-date-bucket-op:9-11` declares `outputColumn` as "an **optional** `outputColumn`" and declares `field` and `granularity` without that qualifier and without a default | Nothing blesses an empty `field`. With `outputColumn` absent, `DateBucketStep:119` sets `outputCol = field = ""`, writing a **field named `""`** into the output DataType — the exact HEL-888 corruption `compute` exhibits. Required. |
| `granularity` | `stringOr` (M2) | `""` | string enum | already validated at run | `pipeline-date-bucket-op:23-24` "If `granularity` is not one of the five supported values, step execution SHALL fail with a descriptive error identifying the invalid value and the supported set" | Already discharged at run (`DateBucketStep.floorFn:107-111`); `""` is not one of the five, so it already fails loudly with a specced message. Not re-declared — doing so would replace a specced message with a different one. |
| `outputColumn` | scalar-opt | `None` | string | optional | `:11` "an **optional** `outputColumn`" | Optional. |

### 7. `dedupe` (`DedupeStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `keys` | M2 | `Vector.empty` | array of strings | **optional-with-legitimate-default (PINNED, design.md D8)** | `pipeline-dedupe-op:9` "When `keys` is empty, rows are compared as whole rows"; UI requirement `:52` "Leaving the key multi-select empty SHALL be a valid configuration (whole-row distinct)"; scenario `:59`; and this change's own delta restates it at `:5` | Empty is **behaviour-defining** (whole-row distinct), not a no-op. Marking it required would change an algorithm and contradict this change's own delta. Optional. Not re-decided. |
| `keep` | M3 | `"first"` | string enum | optional-with-legitimate-default, **unknown value rejected at analyze/run (D4)** | `pipeline-dedupe-op:10-11` (shipped) "`keep` SHALL default to `"first"` when omitted **or any value other than the literal `"last"`**" — deliberately narrowed; this change carries a `pipeline-dedupe-op` delta (`:7-11`, `:61-64`) | Absence stays blessed. The "any other value" half has a delta. |

### 8. `extractheadings` (`ExtractHeadingsStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `field` | `stringOr` (M2) | `""` | string | **required** | `pipeline-extract-headings-op:9-11` declares `indexField` "defaults to `\"headingIndex\"`" and `levelField` "defaults to `\"headingLevel\"`", and `field` with **no default**: "`field` (string, the source column name)" | No blessing. `:11-12` drops every row whose `field` is absent, so an empty `field` annihilates the row set while reporting success. Required. |
| `indexField` | `stringOr` | `"headingIndex"` | string | optional | `:10` "defaults to" | Optional. |
| `levelField` | `stringOr` | `"headingLevel"` | string | optional | `:11` "defaults to" | Optional. |

### 9. `fillnull` (`FillNullStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `columns` | M2 | `Vector.empty` | array of strings | optional-with-legitimate-default | `pipeline-fillnull-op:9-12` "Only cells in `columns` whose value is null SHALL be replaced; non-null cells and **cells in columns not listed SHALL pass through unchanged**"; "The output schema SHALL equal the input schema (pass-through, **no column added or removed**)" | The requirement text specifies the not-listed case as pass-through, and guarantees the step adds no column. An empty `columns` is therefore a **specified pass-through no-op** — it cannot fabricate a name or drop rows, so criterion 1 of the requiredness rule fails as well. Optional. **This is a trap-shaped field** (`columns` is the principal config of `fillnull`); the spec check is what settles it. |
| `strategy` | `stringOr` (M2) | `""` | string enum | already validated | `pipeline-fillnull-op:13-14` "An unsupported `strategy` SHALL fail at execute time with a descriptive error naming the invalid value and the supported set" | Already discharged at run and at analyze (`validateFillNull`). `""` is unsupported and already fails. Not re-declared. |
| `value` | scalar-opt | `None` | string | conditionally required — **already enforced** | `pipeline-fillnull-op:26-29` named scenario "Constant strategy without a value fails" | Already discharged at run and analyze (`validateFillNull`'s `strategy == "constant" && value.isEmpty`). Not re-declared. |

### 10. `filter` (`FilterStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `combinator` | M3 | `"AND"` | string enum | optional-with-legitimate-default, **unknown value rejected at analyze/run (D4)** | `pipeline-filter-op:9-10` states the shape `"AND"|"OR"` and stops — it never blesses a fallback for an unrecognised value | Absence keeps `AND`. An unknown-but-string value was unspecced silent coercion (M3), so rejecting it reverses no shipped guarantee and needs no delta. Handled by `pipeline-step-config-validation`'s delta `:127-131`. |
| `conditions` | M1 | `Vector.empty` | array of `{field,operator,value}` | **optional-with-legitimate-default (PINNED, design.md D8)** | `pipeline-filter-op:11` requirement text "An empty `conditions` array SHALL pass all rows"; named scenario `:13-15` | Spec blesses empty. Optional. Not re-decided. |
| `conditions[].field`/`.operator` | `convertTo` (M1) | — | string | n/a (element) | `pipeline-filter-op:9-10` | Element becomes strict per 2.3. `FilterStep:74` already skips an empty `field` for that condition only. |

### 11. `groupby` (`GroupByStep.scala`)

**No governing spec.** Checked `openspec/specs/` in full: there is **no `pipeline-groupby-op` directory** (the 21
`pipeline-*-op` specs are listed in `spec-tolerance-enumeration.md`; `groupby` is absent). The nearest governing
statement is `pipeline-step-config-validation:12-13`, which names "`aggregate` / `groupby` / `pivot` aggregation
functions" among the analyze-validated enum options.

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `groupBy` | M2 | `Vector.empty` | array of strings | optional-with-legitimate-default | **no governing statement** (checked: no `pipeline-groupby-op` spec exists) | Empty `groupBy` collapses to a single group — the same specced semantics `pipeline-aggregate-op:7` blesses for its sibling. Optional, by parity, conservatively. |
| `aggColumn` | `stringOr` (M2) | `""` | string | optional-with-legitimate-default | **no governing statement** (as above) | Empty yields a `sum` over a nonexistent field (`0`) under the alias the engine derives; no fabricated *name*, no dropped rows. With no spec text either way, the conservative reading preserves behaviour. Flagged in the report as the one place a future spec should settle. |
| `aggFunction` | `stringOr` (M2) | `"sum"` | string enum | already validated | `pipeline-step-config-validation:12-13` names `groupby` aggregation functions in the validated set | Already discharged at run (`GroupByStep`) and analyze (`validateGroupBy`). Not re-declared. |

### 12. `join` (`JoinStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `rightDataSourceId` | `stringOr` (M2) | `""` | string | already fails the run | `pipeline-joinstep-right-source-acl:8` governs **ownership on write**; `JoinStep.evaluate:51-54` already fails the run with "DataSource not found for join: " for an empty id | Already discharged at run with a descriptive error. Not re-declared — a second declaration would replace that message. |
| `joinKey` | `stringOr` (M2) | `""` | string | **required** | No shipped `pipeline-*-op` spec for `join` exists (checked: no `pipeline-join-op` directory); the only `join` statements are `pipeline-joinstep-right-source-acl` (ownership, write-path) and `pipeline-step-config-validation:13-14` (`join.type` enum). **No statement blesses an absent or empty `joinKey`.** This change's `pipeline-step-config-runtime-completeness:27-31` supplies the requirement and its named scenario | Empty `joinKey` makes both sides index on `getOrElse("", null)` → every row keys to `null` → an inner join becomes a full cross-product-by-null and a left join silently mis-matches. Corruption, not a no-op. Required. |
| `joinType` | `stringOr` (M2) | `"inner"` | string enum | already validated | `pipeline-step-config-validation:13-14` names `join.type` | Already discharged at run (`JoinStep:60-63`) and analyze (`validateJoin`). Not re-declared. |

### 13. `limit` (`LimitStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `count` | M3 (`toIntExact` → `0`) | `0` | integer | **optional-with-legitimate-default (PINNED, design.md D8)**; **non-representable value rejected at analyze/run (D4)** | `pipeline-limit-op:9` "When `count` is missing, zero, or negative, the engine SHALL return all rows (safe no-op)" + named scenario `:19-21` | Missing/zero/negative is spec-blessed → optional, no delta. The **separate** case — a correctly-typed number that cannot be represented as `Int` and is silently narrowed to `0`, i.e. **widened to unlimited** — is unspecced coercion and is rejected at analyze/run. Split made explicit here per task 5.2: D1 covers a wrong-**type** `count` at decode; D4 covers the non-representable one. |

### 14. `lookup` (`LookupStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `referenceDataSourceId` | `stringOr` (M2) | `""` | string | already fails the run | `pipeline-lookup-op:63` execution SHALL fail for an id that is "missing, invalid, or unresolvable (**including the tolerant-decode default of an empty string**)", scenario `:69`; write-path emptiness explicitly blessed at `:130`, `:152`, `:157` | Already discharged at run, and its **write** tolerance is explicitly specced (the picker's default seed). Not re-declared. This is the in-repo precedent D3 generalises. |
| `sourceKey` | `stringOr` (M2) | `""` | string | **required** | `pipeline-lookup-op:8-11` declares `sourceKey` and `lookupKey` with no default and no optional qualifier; `:63` blesses only the *reference id*'s empty default, and only by making it **fail the run** | No statement blesses an empty `sourceKey`. Empty makes `:17-19`'s index lookup key on `getOrElse("", null)` for every row, so every row either matches one arbitrary reference row or is null-filled — corruption presented as a successful enrichment. Required. |
| `lookupKey` | `stringOr` (M2) | `""` | string | **required** | Same citation | Same conclusion. |
| `columns` | M2 | `Vector.empty` | array of strings | optional-with-legitimate-default | `pipeline-lookup-op:17-19` "Only the fields named in `columns` SHALL be brought into the output row … every other left-row field SHALL be preserved unchanged" | Empty `columns` is a specified pass-through (nothing brought in, nothing lost). `LookupStep.scala:24-27`'s own comment records the same conclusion, citing `select`'s precedent. Optional. |

### 15. `pivot` (`PivotStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `index` | M2 | `Vector.empty` | array of strings | optional-with-legitimate-default | `pipeline-pivot-op:16-17` "Rows SHALL first be grouped by the tuple of `index` field values" and `:10-11` declares `index` as the group-by list, mirroring `aggregate`'s `groupBy`, which `pipeline-aggregate-op:7` blesses as "zero or more" | Empty `index` groups everything into one group — a specified, non-fabricating outcome. Optional. |
| `column` | `stringOr` (M2) | `""` | string | **required** | `pipeline-pivot-op:10-13` declares `column` as "`string`: source column whose **distinct values become new output columns**", with no default and no optional qualifier. No statement blesses empty | Empty `column` means every row's `column` value is `null`, so `:21-22` excludes every row from value-column computation: the pivot emits index groups with **none of the value columns it was configured to produce**, reporting success. Required. |
| `values` | `stringOr` (M2) | `""` | string | **required** | Same citation (`:12-13`, "`values` (`string`: source column whose values are aggregated into each new output column)") | Empty `values` makes `:19-21` fabricate output columns named `_<v>` (the `<values>_<v>` template with an empty `values`) carrying an aggregate of a nonexistent field. Fabricated column name — the HEL-888 class. Required. |
| `agg` | `stringOr` (M2) | `""` | string enum | already validated | `pipeline-pivot-op:28-30` "If `agg` is not one of the six supported functions, step execution SHALL fail with a descriptive error" | Already discharged at run (`PivotStep:80-83`) and analyze (`validatePivot`). Not re-declared. |

### 16. `rename` (`RenameStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `renames` | M5 | `Map.empty` | object of string→string | **optional-with-legitimate-default (PINNED, design.md D8)** | `pipeline-rename-op:25` "Empty renames map is a no-op"; `pipeline-step-config-rejection:67-70` | Spec blesses empty and absent. Optional. Not re-decided. |

### 17. `select` (`SelectStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `fields` | M2 | `Vector.empty` | array of strings | **optional-with-legitimate-default (PINNED, design.md D8)** | `pipeline-select-op:24-26` named scenario "Select with empty fields list produces empty rows" — "**THEN** each output row is an empty map (`{}`)" | Empty is **behaviour-defining** (a specified non-identity result), not a no-op. Marking it required would silently change an algorithm. Optional. Not re-decided. |

### 18. `sort` (`SortStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `sortBy` | M1 | `Vector.empty` | array of `{field,direction}` | **optional-with-legitimate-default (PINNED, design.md D8)** | `pipeline-sort-op:10` "An empty `sortBy` array SHALL be treated as a no-op (all rows returned in original order)"; named scenario `:24`; plus `:76` "New sort step has empty sortBy" | Spec blesses empty. Optional. Not re-decided. Task 2.3's item-level strictness is orthogonal: a malformed **element** fails, an **empty array** stays a no-op. |

### 19. `splittext` (`SplitTextStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `field` | `stringOr` (M2) | `""` | string | **required** | `pipeline-split-text-op:9-12` declares `headingLevel` "defaults to `1`" and `indexField` "defaults to `\"segmentIndex\"`", and declares `field` with **no default**: "`field` (string, the source column name)" | No blessing. `:12-13` drops every row whose `field` is absent, so an empty `field` annihilates the row set while reporting success. Required. |
| `mode` | M3 | `"paragraph"` | string enum | optional-with-legitimate-default, **unknown value rejected at analyze/run (D4)** | `pipeline-split-text-op:10` states `"paragraph"` or `"heading"` and stops; it never blesses a fallback for an unrecognised value | The code's silent default to `"paragraph"` for an unknown value is **unspecced** behaviour being removed, not a spec reversal — no delta needed (recorded in `spec-tolerance-enumeration.md`). Absence keeps `"paragraph"`. |
| `headingLevel` | `intOr` | `1` | integer | optional | `:11` "defaults to `1`" | Optional. |
| `indexField` | `stringOr` | `"segmentIndex"` | string | optional | `:11-12` "defaults to `\"segmentIndex\"`" | Optional. |

### 20. `stringops` (`StringOpsStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `operation` | `stringOr` (M2) | `""` | string enum | already validated | `pipeline-string-ops-op:16-18` "If `operation` is not one of the six supported values, step execution SHALL fail with a descriptive error" | Already discharged at run and analyze (`validateStringOps`). Not re-declared. |
| `field` | `stringOr` (M2) | `""` | string | **required, CONDITIONALLY** — required unless `operation == "concat"` | `pipeline-string-ops-op:10-11` declares `field` as "(string: source column name)" with no default; the code's own contract at `StringOpsStep.scala:16-17` says `field` "is the source column for the five single-field operations (**unused by `concat`**, which reads `fields` instead)" | No statement blesses an empty `field` for the five single-field operations; empty makes every row read `getOrElse("", null)` and write a transform of `null`. But `concat` genuinely ignores it, so an unconditional declaration would fail every valid `concat` step. **This is the top-level conditional case task 4.1 requires the declaration's shape to express.** |
| `outputColumn` | `stringOr` (M2) | `""` | string | **required** | `pipeline-string-ops-op:11-12` "`outputColumn` (string: destination column name — if equal to `field`, the op overwrites the source column in place; otherwise it writes a distinct column)", no default, no optional qualifier | Empty `outputColumn` writes a **field named `""`** onto every row — the HEL-888 class, identical to `compute.column`. Required, for all six operations. |
| `pattern`/`separator`/`index` | scalar-opt (M2/M3) | `None` | string/string/int | conditionally required — **not** re-declared | `pipeline-string-ops-op:13-15` "`pattern` (string, **required for** `extractRegex` …), `separator` (string, required for `split`), `index` (integer, required for `split`)" | Genuinely conditionally required by the spec, and already enforced at run by `StringOpsStep`'s own per-operation validation. Left where it is rather than duplicated; recorded so the omission is deliberate. |
| `fields` | M2 | `None` | array of strings | optional | `:15` "`fields` (array of strings, **used by** `concat`)" — no requiredness language; `StringOpsStep:123` defaults it to `Vector.empty` | Optional. |

### 21. `union` (`UnionStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `otherDataSourceId` | `stringOr` (M2) | `""` | string | already fails the run | `pipeline-union-op:37` execution SHALL fail for an id that is "missing, invalid, or unresolvable (including the tolerant-decode default of an empty string)", scenario `:44` | Already discharged at run. Not re-declared. The other in-repo precedent for D3. |
| `mode` | `stringOr` (M2) | `"byPosition"` | string enum | already validated | `pipeline-step-config-validation:13` names `union.mode` | Already discharged at run and analyze (`validateUnion`). Not re-declared. |

### 22. `unpivot` (`UnpivotStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `idVars` | M2 | `Vector.empty` | array of strings | optional-with-legitimate-default | `pipeline-unpivot-op:17-19` "Each emitted row SHALL carry the `idVars` field values unchanged (a **missing** `idVars` field on the source row SHALL yield `null`, not drop the row)"; scenario `:44-45` | Carrying nothing forward is a specified, non-fabricating outcome. Optional. |
| `valueVars` | M2 | `Vector.empty` | array of strings | optional-with-legitimate-default | `pipeline-unpivot-op:15-16` requirement text: "the engine SHALL emit exactly one output row per entry in `valueVars` … for a **total output row count of `(input row count) * (valueVars length)`**"; scenario `:34-37` restates the product | **A trap field, and the spec settles it against intuition.** An empty `valueVars` annihilates the row set, which looks exactly like the corruption D3 targets — but the requirement text specifies the output row count as a product, which *defines* the empty case as zero rows rather than leaving it undefined. Per design.md D8's rule ("if a spec blesses the empty value, mark it optional or carry a MODIFIED delta"), and since this change carries no `pipeline-unpivot-op` delta: **optional**. Recorded here as the enumeration's own eighth trap field, which design.md D8 predicted would exist. |
| `varName` | `stringOr` (M2) | `"variable"` | string | optional | `pipeline-unpivot-op:11` "`varName` (`string`, **default** `\"variable\"`)"; named scenario `:39-42` "Default varName/valueName apply when omitted from config" | Optional. This is the assertion displaced from task 6.1 into the task-2.5 guard. |
| `valueName` | `stringOr` (M2) | `"value"` | string | optional | `:12` "`valueName` (`string`, **default** `\"value\"`)"; same scenario | Optional. |

### 23. `window` (`WindowStep.scala`)

| field | how read | default | type | requiredness | spec citation | conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `partitionBy` | M2 | `Vector.empty` | array of strings | optional-with-legitimate-default | `pipeline-window-op:18-19` "Rows SHALL be partitioned by the tuple of `partitionBy` field values … mirroring the `aggregate` op's `groupBy` semantics", which `pipeline-aggregate-op:7` blesses as "zero or more" | Empty means one partition — specified. Optional. |
| `orderBy` | M1 | `Vector.empty` | array of `{field,direction}` | optional-with-legitimate-default | `pipeline-window-op:20-24` orders "using the same comparator semantics as the `sort` op", whose `pipeline-sort-op:10` blesses an empty key list as a no-op, "with ties broken by each row's original position" — which fully defines the empty case | Optional by the same reading D8 pins for `sort.sortBy`. Item-level strictness (2.3) still applies to a malformed element. |
| `function` | `stringOr` (M2) | `""` | string enum | already validated | `pipeline-step-config-validation:12-13` names `window.function` "including its per-function `field` and `offset` requirements" | Already discharged at run and analyze (`validateWindow`). Not re-declared. |
| `field` | scalar-opt (M2) | `None` | string | conditionally required — **already enforced** | `pipeline-window-op:13-14` "`field` (`Option[String]`: source column **required by** `running_sum`/`lag`/`lead`, **ignored by the rank family**)"; named scenario `:49-51` "Running_sum without a field fails with a descriptive error" | Already discharged at run (`WindowStep`) and analyze (`validateWindow`'s `WindowStep.FieldRequired`). Not re-declared. |
| `outputColumn` | `stringOr` (M2) | `""` | string | **required** | `pipeline-window-op:14-15` "`outputColumn` (`string`: name of the appended column)", declared with **no default** and no `Option[...]`, unlike the two keys immediately around it (`field` is `Option[String]`, `offset` is `Option[Int]` "defaulting to `1` when absent") | Empty `outputColumn` makes `:28-29` ("appending `outputColumn` to each row with its computed value") append a **field named `""`** to every row — the HEL-888 class. Required. |
| `offset` | M3 (`toIntExact`) | `None` | integer | optional | `:15-16` "`offset` (`Option[Int]`: used by `lag`/`lead`, **defaulting to `1` when absent**)" | Optional; the positive-value check is already discharged by `validateWindow`. |

## Summary of the D3 required declaration

Eleven fields across eight step kinds, one of them conditional:

| kind | required fields |
| --- | --- |
| `chunkbytokencount` | `field` |
| `compute` | `column`, `expression` |
| `datebucket` | `field` |
| `extractheadings` | `field` |
| `join` | `joinKey` |
| `lookup` | `sourceKey`, `lookupKey` |
| `pivot` | `column`, `values` |
| `splittext` | `field` |
| `stringops` | `field` (**unless `operation == "concat"`**), `outputColumn` |
| `window` | `outputColumn` |

The other 13 step kinds declare no new required field, each for a cited reason above: either a shipped spec
blesses the empty value (`aggregate`, `assert`, `cast`, `dedupe`, `fillnull`, `filter`, `rename`, `select`,
`sort`, `unpivot`), or the guarantee is already discharged by an existing run/analyze check whose message is
itself specced (`union`, and `groupby` for `aggFunction`).

## Fields marked `required` — the 1.2b citation audit, restated as a checklist

Every one of the eleven was checked by opening the named spec file and reading the requirement text. Where a
requirement declares sibling keys **with** an explicit default or an `optional`/`Option[...]` qualifier and
declares the field in question **without** one, that contrast is the evidence, and it is quoted above rather than
asserted:

| field | spec file:line read | does it bless absent/empty? |
| --- | --- | --- |
| `chunkbytokencount.field` | `openspec/specs/pipeline-chunk-by-token-count-op/spec.md:10-14` | no |
| `compute.column` | `openspec/specs/pipeline-compute-op/spec.md:70-72` (edit-time only) | only for editing/persisting; delta supplies run/analyze |
| `compute.expression` | `openspec/specs/pipeline-compute-op/spec.md:70-72` | same |
| `datebucket.field` | `openspec/specs/pipeline-date-bucket-op/spec.md:9-11` | no (`outputColumn` is the one marked optional) |
| `extractheadings.field` | `openspec/specs/pipeline-extract-headings-op/spec.md:9-11` | no |
| `join.joinKey` | no `pipeline-join-op` spec exists; checked `pipeline-joinstep-right-source-acl/spec.md` and `pipeline-step-config-validation/spec.md:13-14` | **no governing statement**; this change supplies one |
| `lookup.sourceKey` | `openspec/specs/pipeline-lookup-op/spec.md:8-11`, `:63` | no (only the *reference id*'s empty default is addressed, and by failing the run) |
| `lookup.lookupKey` | same | no |
| `pivot.column` | `openspec/specs/pipeline-pivot-op/spec.md:10-13`, `:19-22` | no |
| `pivot.values` | same | no |
| `splittext.field` | `openspec/specs/pipeline-split-text-op/spec.md:9-12` | no |
| `stringops.field` | `openspec/specs/pipeline-string-ops-op/spec.md:10-11` + `StringOpsStep.scala:16-17` | not blessed, but genuinely **inapplicable to `concat`** → conditional |
| `stringops.outputColumn` | `openspec/specs/pipeline-string-ops-op/spec.md:11-12` | no |
| `window.outputColumn` | `openspec/specs/pipeline-window-op/spec.md:14-15` | no |

## Task 1.3 — ambiguity review

Two fields were genuinely close calls and are recorded rather than silently decided. Neither was resolved by
guessing: both were resolved **conservatively toward preserving shipped behaviour**, which is the direction that
cannot introduce a new failure, and both are called out in the delivery report.

* **`unpivot.valueVars`** — an empty value annihilates the row set (looks like corruption), but
  `pipeline-unpivot-op:15-16`'s output-row-count product defines the empty case. Marked optional per D8's rule.
  Overturning this needs a `pipeline-unpivot-op` MODIFIED delta, not an execution-time judgement call.
* **`groupby.aggColumn`** — no governing spec exists at all (`pipeline-groupby-op` does not exist). Marked
  optional to preserve behaviour. A future ticket writing that spec should settle it.

Neither meets the escalation bar (a *contradiction* between ticket and spec, or a decision that cannot be made
without guessing): both have a defensible, spec-grounded, behaviour-preserving answer that is recorded with its
citation and is falsifiable by pointing at a spec line that says otherwise.
