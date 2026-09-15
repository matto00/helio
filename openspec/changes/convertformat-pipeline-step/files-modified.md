## New files

- `backend/src/main/scala/com/helio/domain/steps/ConvertFormatConfig.scala` — `ConvertFormatConfig` (tolerant `decode`, custom wire format, `pairError` write-path pair check).
- `backend/src/main/scala/com/helio/domain/steps/ConvertFormatStep.scala` — `ConvertFormatStep`, `SupportedPairs`, the CSV<->JSON and text<->Markdown conversion functions (D4/D5), and the `PipelineStep.Companion` (`validateRawConfig`, `requiredConfigProblems`).
- `backend/src/test/scala/com/helio/domain/steps/ConvertFormatStepSpec.scala` — round-trip tests (CSV<->JSON, text<->Markdown), one failure test per D3 reason code, row-shape tests, one engine-level `StepExecutionException` test, config-validation tests.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeConvertFormatSpec.scala` — persisted-row analyze 200 (mirrors `PipelineAnalyzeUpsertSourceSpec`).

## Modified files

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — registers `ConvertFormatStep.Kind -> ConvertFormatStep.companion` in `Registry`; adds `PipelineStepKind.ConvertFormat`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exports `ConvertFormatStep`/`ConvertFormatConfig` from `com.helio.domain.steps` into `com.helio.domain`, matching every other step's alias.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala` — `encodeConfig` case for `ConvertFormatConfig`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — `rowToDomain` case for `ConvertFormatConfig` (so a persisted row loads instead of 500ing).
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — `inferConvertFormat` (D6: field-existence/string-body/pair validation, appends `outputField` as `string-body`) + dispatch entry.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` — `ConvertFormatAnalyzeStepResponse` + format wiring (read/write dispatch).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala` — `ConvertFormatStepResponse` + format wiring (regular, non-analyze step response).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `toAnalyzeStepResponse` case for `ConvertFormatConfig`.
- `backend/src/main/scala/com/helio/domain/engine/PipelineCostEstimator.scala` — new `ContentConversionOps = Set("convertformat")`, its own `content-conversion` deny reason (checked after AI/write-back, before the cheap allowlist); corrected the `AiOps` comment from "HEL-1105/1106" to "HEL-1106/1107" (C3).
- `schemas/pipelines/pipeline-analyze-response.schema.json` — `CostReason.code` enum gains `content-conversion`.
- `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` — section 6 corrected: `convertformat` no longer grouped with the two `ClaudeClient` steps; states it is deterministic/local, denied auto-run via its own `content-conversion` code, not because it's an AI step.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — six new `convertformat` analyze-inference cases (mirrors `splittext`'s own block) + `convertformat` entry in the registry-vs-dispatch coverage guard's `probesByKind`.
- `backend/src/test/scala/com/helio/domain/engine/PipelineCostEstimatorSpec.scala` — new `content-conversion` verdict test; op-coverage partition test widened to four sets (`CheapOps`/`AiOps`/`WriteBackOps`/`ContentConversionOps`); the `unclassified-op` example steps changed from `"convertformat"` (now itself classified) to `"notarealop"` (design.md D8).
- `backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala` — adds `ConvertFormatStep` to `allSubtypes`, `PipelineStepKind.All`'s expected set, and the sealed-trait pattern-match exhaustiveness check.
- `backend/src/test/scala/com/helio/domain/steps/PipelineStepRequiredConfigSpec.scala` — the registry-size drift guard bumped from 24 to 25 kinds, `convertformat` added to the expected `keySet` (this is the mechanical guard the ticket's own tasks.md 4.8/1.4 gate relies on; it was the one pre-existing test this change broke and required updating).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` — `convertformat` removed from the "rejected until wired" op loop (now `analyzewithai`/`generatetext` only, C4); new "accept a convertformat step" case mirroring the `upsertsource` flip (design.md D8).
- `openspec/changes/convertformat-pipeline-step/tasks.md` — all tasks marked complete.

## Root-cause notes (systematic-debugging.md)

None — this ticket is new-feature implementation, not a bug fix; no pre-existing defect was diagnosed or fixed. The one broken pre-existing test (`PipelineStepRequiredConfigSpec`'s registry-size drift guard) was an EXPECTED mechanical trip (its own scaladoc documents this is exactly what it's for when a 25th kind is registered), not a defect — fixed by updating its expected count/set, confirmed via `sbt test` (full 4436-test suite green before and after, see below).

## C6 mutation evidence (failure-arm tests, `ConvertFormatStepSpec` "failure reasons" block)

Each named D3 reason code was proven failable by a targeted single-site mutation of `ConvertFormatStep.scala`, run via `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec -- -z "<substring>"`, confirmed red, then reverted (file diffed byte-identical to the pre-mutation copy after each revert). All mutations and their red output:

1. **`field-missing`** — mutated `case None | Some(null) => fail(...)` to `case None | Some(null) => ""`. Red: `field-missing when the field is absent` and `...is null` both failed — "Expected exception ... but no exception was thrown".
2. **`field-not-string`** — mutated `case Some(_) => fail(...)` to `case Some(other) => other.toString`. Red: `field-not-string when the field holds a non-string value` failed — no exception thrown.
3. **`csv-malformed` (unterminated quote)** — mutated `if (inQuotes) fail(...)` to a no-op comment. Initial mutation was masked by the ragged-row check on a 2-column fixture (a real vacuous-pass risk the mutation step itself caught) — the test's fixture was corrected to a single-column CSV (`"a\n\"unterminated"`) so removing only the unterminated-quote check is the sole path to green; re-verified red: "Expected exception ... but no exception was thrown".
4. **`csv-malformed` (empty header name)** — mutated the empty-header check to a no-op comment. Red: `csv-malformed on an empty header name` failed — no exception thrown.
5. **`csv-malformed` (duplicate header name)** — mutated the duplicate-header check to a no-op comment. Red: `csv-malformed on a duplicate header name` failed — no exception thrown.
6. **`csv-malformed` (ragged row)** — removed the `if (r.length != header.length) fail(...)` guard entirely. Red: `csv-malformed on a ragged row (column count mismatch)` failed — no exception thrown.
7. **`json-malformed`** — mutated the `catch` arm from `fail(...)` to `JsArray()`. Red: `json-malformed on unparseable JSON` failed — no exception thrown.
8. **`json-not-array-of-objects` (top-level)** — mutated `case _ => fail(...)` to `case _ => Vector.empty`. Red: `...when the top-level value is not an array` failed — no exception thrown.
9. **`json-not-array-of-objects` (element)** — mutated `items.map { ...; case _ => fail(...) }` to `items.collect { case o: JsObject => o }`. Red: `...when an array element is not an object` failed (raised `NoSuchElementException` downstream instead — still fails the `intercept[IllegalArgumentException]` assertion, proving the check is load-bearing).
10. **`json-inconsistent-keys`** — removed the key-set equality check. Red: failed with a downstream `NoSuchElementException`, still failing the `IllegalArgumentException` intercept.
11. **`json-nested-value` / `json-non-string-value`** — mutated `cell(...)`'s match to `case other => other.toString` for both arms at once. Red: all five of `json-nested-value` (object, array) and `json-non-string-value` (number, boolean, null) failed — no exception thrown.

Each mutation was applied in isolation from a saved pristine copy, the targeted test(s) re-run, output captured, then reverted before the next mutation (`cp` from `/tmp/ConvertFormatStep.scala.orig`). Final `diff` against the pristine copy after the last revert was empty. Full `ConvertFormatStepSpec` (54 tests) and the full backend suite (4436 tests) both green post-revert.

## Verification

- `sbt compile` — clean.
- `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec` — 54/54 passed.
- `sbt testOnly com.helio.domain.engine.PipelineAnalyzeServiceSpec com.helio.domain.engine.PipelineCostEstimatorSpec com.helio.domain.model.PipelineStepSpec` — 146/146 passed.
- `sbt testOnly com.helio.services.pipelines.PipelineAnalyzeConvertFormatSpec com.helio.services.pipelines.PipelineCreateTransactionalSpec` — 26/26 passed.
- `sbt testOnly com.helio.domain.steps.PipelineStepRequiredConfigSpec` — 29/29 passed (after the registry-size guard update).
- `sbt test` (full suite) — 4436/4436 passed, 0 failed.
- `npm run check:schemas` — schemas in sync.
- `npm run check:scala-quality` — clean (soft file-size warnings only, pre-existing repo-wide pattern).

## Cycle 2 (skeptic-final-1.md non-blocking notes 1 and 2, promoted to required)

### Modified files (cycle 2)

- `backend/src/test/scala/com/helio/domain/steps/ConvertFormatStepSpec.scala` — added a module-level `toMarkdown` helper (hoisted out of the round-trip `should` block so a new sibling block can share it) and a new `"textToMarkdown (intermediate Markdown output)"` block (7 tests) asserting directly on the intermediate Markdown STRING itself, not just the round-tripped-back-to-text value: two/three adjacent non-empty lines get a `\` + `\n` hard break, a blank line between lines stays bare `\n`, leading/trailing spaces and tabs become `&#32;`/`&#9;` tokens, a Markdown-significant character and a heading-like line are backslash-escaped.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeConvertFormatSpec.scala` — extended the persisted-row analyze test with assertions on `response.costVerdict`: `autoRunnable shouldBe false` and a `content-conversion` reason present naming the persisted step's own id (`cfReason.stepId shouldBe Some(cfStep.id)`) — proves the persisted-row analyze path and the HEL-1092 cost classification together, end-to-end, in one test.

No production code changed in cycle 2 (tests only, per the reviewer's explicit instruction).

### Mutation evidence (cycle 2)

**Note 1 — D5 hard-break join rule, re-applied exactly as the skeptic ran it, now against the new tests:**

- Mutated `ConvertFormatStep.scala`'s `sb.append(if (bothNonEmpty) "\\\n" else "\n")` (the line implementing the hard-break join rule) to always append a bare `"\n"`, from a pristine copy (`/tmp/ConvertFormatStep.scala.orig2`).
- Ran `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec` (61 tests). **Result: RED**, exactly 2 failures, both in the new intermediate-markdown block:
  ```
  - should two adjacent non-empty lines are joined with a backslash hard break (\ + \n) *** FAILED ***
    "a[]\nb" was not equal to "a[\]\nb" (ConvertFormatStepSpec.scala:211)
  - should three non-empty lines each get their own hard break *** FAILED ***
    "a[\nb]\nc" was not equal to "a[\\\nb\]\nc" (ConvertFormatStepSpec.scala:219)
  ```
  All 59 other tests — including every pre-existing text↔Markdown round-trip test — stayed GREEN under this exact mutation, reproducing the skeptic's finding precisely (the round-trip suite is blind to this rule; the new intermediate-markdown tests are not).
- Reverted via `cp /tmp/ConvertFormatStep.scala.orig2 ...`; `diff` confirmed byte-identical; re-ran the same test class: 61/61 passed.

**Note 1 (extended) — leading/trailing whitespace tokenization, as the change request also required:**

- Mutated the leading/trailing whitespace-token branch (`if (i < lead || i >= n - trail) sb.append(...)`) to `if (false) sb.append(...)` — the whitespace-token encoding never fires.
- Ran the same test class. **Result: RED**, exactly 2 failures, both new:
  ```
  - should leading and trailing spaces become &#32; tokens *** FAILED ***
    "[ a ]" was not equal to "[&#32;a&#32;]" (ConvertFormatStepSpec.scala:223)
  - should leading and trailing tabs become &#9; tokens *** FAILED ***
    "[<TAB>a<TAB>]" was not equal to "[&#9;a&#9;]" (ConvertFormatStepSpec.scala:227)
  ```
  Notably, every pre-existing round-trip test — including `"leading and trailing spaces and tabs"` and `"a line of only spaces and tabs is fully encoded and round-trips"` — ALSO stayed green under this mutation: with whitespace tokenization disabled, a leading/trailing space/tab is simply copied literally into the Markdown output (space/tab are not in the punctuation-escape set), and `markdownToText`'s fallback copies it straight back, so the round trip holds by coincidence even though the documented encoding rule is gone. This confirms the same class of gap the skeptic found for the hard-break rule also applies here, and that only an assertion on the intermediate string (not the round trip) catches it.
- Reverted; `diff` confirmed byte-identical; re-ran: 61/61 passed.

**Note 2 — `ContentConversionOps` cost classification, mutated in the production file (not a scratch copy, since the check must exercise the real `PipelineCostEstimator` the analyze route calls) and reverted before commit:**

- Mutated `PipelineCostEstimator.scala`: emptied `ContentConversionOps` to `Set.empty[String]` and added `"convertformat"` to `CheapOps` instead (from a pristine copy, `/tmp/PipelineCostEstimator.scala.orig`) — simulates "convertformat moved into CheapOps".
- Ran `sbt testOnly com.helio.services.pipelines.PipelineAnalyzeConvertFormatSpec`. **Result: RED**:
  ```
  - should succeed (not 500) for a persisted pipeline containing a convertformat step, and reports it in the analyze response *** FAILED ***
    expected a content-conversion cost reason, got: Vector(CostReasonResponse(row-estimate-unavailable,No row estimate is available for this pipeline,None))
  ```
  (The pipeline is still correctly denied auto-run for an unrelated reason — no row estimate — but the specific `content-conversion` classification this test exists to prove is gone, exactly the defect the mutation simulates.)
- Reverted via `cp /tmp/PipelineCostEstimator.scala.orig ...`; `diff` confirmed byte-identical; re-ran `PipelineAnalyzeConvertFormatSpec` + `PipelineCostEstimatorSpec` together: 19/19 passed.

### Verification (cycle 2)

- `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec` — 61/61 passed (54 cycle-1 + 7 new).
- `sbt testOnly com.helio.services.pipelines.PipelineAnalyzeConvertFormatSpec com.helio.domain.engine.PipelineCostEstimatorSpec` — 19/19 passed.
- `sbt test` (full suite, fresh) — **4443/4443 passed**, 0 failed (4436 cycle-1 total + 7 new tests; no regressions, no pre-existing test needed re-updating this cycle since no production code changed).

## Cycle 3 (skeptic-final-2.md: key-order defect)

### Root cause (systematic-debugging.md)

- **Root cause, one sentence, layer:** in `ConvertFormatStep.scala`'s D4 CSV<->JSON conversion layer, both directions built/read JSON objects through spray-json's `JsObject`, whose `apply(members: JsField*)` and `JsonParser`'s object-accumulator both construct the backing map as a `scala.collection.immutable.TreeMap` — **alphabetically sorted, unconditionally**, not merely an insertion-order-preserving structure and not a >4-entry small-map artifact.
- **Probe (before any fix):** added a throwaway `ZZZProbeSpec` exercising both directions with a non-alphabetical, 5-column header (`z,y,x,w,v`), ran `sbt testOnly com.helio.domain.steps.ZZZProbeSpec`, printed the actual output, then deleted the probe file (never committed).
- **Probe output (confirms the hypothesis, both directions):**
  ```
  PROBE csv->json: [{"v":"5","w":"4","x":"3","y":"2","z":"1"}]
  PROBE json->csv: v,w,x,y,z
  5,4,3,2,1
  PROBE csv->json->csv: original=z,y,x,w,v
  1,2,3,4,5 back=v,w,x,y,z
  5,4,3,2,1
  ```
  Confirms the skeptic's hypothesis exactly: the reordering happens in BOTH directions (not just json->csv), so AC1's core CSV<->JSON round trip was broken by this defect for any non-alphabetical header, not merely the "json->csv emits headers alphabetically" symptom originally reported. Also read spray-json 1.3.6's own source (`spray/json/JsValue.scala:58`: `def apply(members: JsField*): JsObject = new JsObject(TreeMap(members: _*))`; `spray/json/JsonParser.scala`'s `` `object` `` method: `members(TreeMap.empty[String, JsValue])`) to confirm the mechanism directly rather than only inferring it from the probe's output.

### Fix

- `ConvertFormatStep.scala`'s `csvToJson`/`jsonToCsv` now build/read JSON through Jackson's `ObjectMapper`/`ObjectNode` (`com.fasterxml.jackson.databind`, already a `build.sbt`-pinned backend dependency — no new dependency added) instead of spray-json's `JsObject`/`text.parseJson`. Jackson's `ObjectNode` is `LinkedHashMap`-backed and preserves literal JSON-text/insertion key order in both directions. All D3 reason codes, their messages, and the `json-inconsistent-keys` "same key SET, order may differ across rows, header order comes from the first object" contract are unchanged — confirmed against `pipeline-convertformat-op/spec.md`'s wording ("same keys, key order and string values" for json->csv->json; csv->json's own scenarios say nothing about a per-row key SET requirement beyond the header, consistent with keeping `json-inconsistent-keys` a set-equality check). `design.md` D4's existing wording ("keys in header order", "same keys, order, strings") already matches the fixed behavior exactly — **no wording change was needed**; the defect was a compliance gap against the existing text, not a spec gap.
- No production behavior changed beyond restoring key order (D3 failure codes/messages, the D2 1:1 row-shape contract, and every other conversion rule are untouched).

### New/modified files (cycle 3)

- `backend/src/main/scala/com/helio/domain/steps/ConvertFormatStep.scala` — `csvToJson`/`jsonToCsv` rewritten on Jackson `ObjectMapper`/`ObjectNode`/`JsonNode` instead of spray-json `JsObject`/`parseJson`; new `jsonMapper` field; new imports (`com.fasterxml.jackson.databind.ObjectMapper`, `com.fasterxml.jackson.databind.node.ObjectNode`, `scala.jdk.CollectionConverters._`). `spray.json._` import retained (still used by the `ConvertFormatConfig` wire-format companion methods, unrelated to this fix).
- `backend/src/test/scala/com/helio/domain/steps/ConvertFormatStepSpec.scala` — 3 new tests, existing fixtures NOT rewritten (per the reviewer's instruction, since audit showed all existing json/csv fixtures used pre-sorted keys, e.g. `a,b`/`x,y`, which never could have caught this):
  - `"header follows the first object's own key order, not alphabetical, with more than 4 keys"` (json->csv direction, 5 keys, non-alphabetical).
  - `"csv -> json -> csv reproduces a non-alphabetical, more-than-4-column header exactly"` (the exact `z,y,x,w,v` shape the skeptic's probe used, 2 data rows).
  - `"json -> csv -> json preserves a non-alphabetical, more-than-4-key order"`.

### Mutation evidence (cycle 3)

**Mutation 1 — csvToJson direction (reintroduce alphabetical sorting on write):**

- Mutated `header.zip(r).foreach { case (k, v) => obj.put(k, v) }` to `header.zip(r).sortBy(_._1).foreach { case (k, v) => obj.put(k, v) }`, from a pristine copy (`/tmp/CFS.cycle3.orig.scala`).
- Ran `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec`. **Result: RED**, exactly 2 failures, both new round-trip tests:
  ```
  - should csv -> json -> csv reproduces a non-alphabetical, more-than-4-column header exactly *** FAILED ***
    "[v,w,x,y,z\n5,4,3,2,1\n10,9,8,7,6]" was not equal to "[z,y,x,w,v\n1,2,3,4,5\n6,7,8,9,10]"
  - should json -> csv -> json preserves a non-alphabetical, more-than-4-key order *** FAILED ***
    "[{\"v\":\"5\",\"w\":\"4\",\"x\":\"3\",\"y\":\"2\",\"z\":\"1\"}]" was not equal to "[{\"z\":\"1\",\"y\":\"2\",\"x\":\"3\",\"w\":\"4\",\"v\":\"5\"}]"
  ```
- Reverted via `cp /tmp/CFS.cycle3.orig.scala ...`; `diff` confirmed byte-identical.

**Mutation 2 — jsonToCsv direction (reintroduce alphabetical sorting on read):**

- Mutated `val keys = objs.head.fieldNames().asScala.toVector` to `.toVector.sorted`, from the same pristine copy.
- Ran the same test class. **Result: RED**, exactly 3 failures:
  ```
  - should header follows the first object's own key order, not alphabetical, with more than 4 keys *** FAILED ***
    "[a,b,m,q,z\n3,5,2,4,1]" was not equal to "[z,m,a,q,b\n1,2,3,4,5]"
  - should csv -> json -> csv reproduces a non-alphabetical, more-than-4-column header exactly *** FAILED ***
    "[v,w,x,y,z\n5,4,3,2,1\n10,9,8,7,6]" was not equal to "[z,y,x,w,v\n1,2,3,4,5\n6,7,8,9,10]"
  - should json -> csv -> json preserves a non-alphabetical, more-than-4-key order *** FAILED ***
    "[v,w,x,y,z\n5,4,3,2,1]" was not equal to "[z,y,x,w,v\n1,2,3,4,5]"
  ```
- Reverted; `diff` confirmed byte-identical against `/tmp/CFS.cycle3.orig.scala`.

Both mutations were applied and reverted independently (one at a time, from the same pristine copy), each confirmed red before reverting.

### Verification (cycle 3)

- `sbt compile` — clean.
- `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec` — 64/64 passed (61 cycle-1/2 + 3 new), including every pre-existing csv/json fixture (proving Jackson's compact serialization format matches spray-json's exactly for these cases — e.g. `[{"a":"1","b":"2"}]`, no extra whitespace).
- `sbt test` (full suite, fresh) — **4446/4446 passed**, 0 failed (4443 cycle-2 total + 3 new tests; no regressions, no other pre-existing test needed updating).
- `npm run check:scala-quality` — clean (soft file-size warnings only, unchanged from prior cycles).
- `npm run check:schemas` — schemas in sync (this fix touches no wire schema; `ConvertFormatConfig`'s own wire format is untouched).

## Cycle 4 (evaluation-3.md CR1: trailing-content leniency regression, owner-authorized extension cycle)

### Root cause (systematic-debugging.md)

- **Root cause, one sentence, layer:** in `jsonToCsv`'s parse layer, cycle 3's `jsonMapper.readTree(text)` (the `ObjectMapper.readTree(String)` overload) parses only the first JSON value in the input and silently stops, with no equivalent of spray-json's `JsonParser`'s `value ~ EOI` end-of-input requirement — so `[{"a":"1"}] garbage`, `[] ]`, and `[{"a":"1"}] // comment` all "succeeded" with truncated, wrong output instead of the named `json-malformed` failure the pre-cycle-3 implementation (and AC2/D4) require.
- **Probe (verification, not re-derivation):** the evaluator (evaluation-3.md) independently probed the actual production entry point (`ConvertFormatStep.apply`) against both the pre-cycle-3 (spray-json, checked out from `edbf71a7`) and cycle-3 (Jackson) implementations side by side and published the before/after table reproduced above CR1 in that report; this cycle re-verified the CONFIRMED regression by applying the fix and re-running the exact three inputs plus a clean-input control through `ConvertFormatStepSpec`.
- **A second root cause found DURING this fix (not in the original CR), caught by actually running the tests rather than trusting the evaluator's verified snippet:** applying the evaluator's own independently-probed replacement snippet verbatim (`val node = jsonMapper.readTree(parser)`, unannotated) caused **17 of 64** existing `ConvertFormatStepSpec` tests to fail — every json->csv test, including previously-passing clean-input ones. Root cause: `ObjectMapper.readTree(JsonParser p)` has a second, GENERIC overload (`def readTree[T <: TreeNode](p: JsonParser): T`) in addition to the non-generic `readTree(JsonParser p): JsonNode` one; with no target-type annotation on `val node = ...`, Scala's overload resolution silently picked the generic one and inferred `T = Nothing` (since nothing constrains it), producing a runtime `ClassCastException` on every call (an `ArrayNode` cannot be cast to `Nothing`) that my own `catch { case _: Exception => fail("json-malformed", ...) }` then swallowed and remapped to `json-malformed` UNCONDITIONALLY — masking the real failure as a plausible-looking but wrong error for every single json->csv call, clean input included. Confirmed via a throwaway probe spec (never committed) printing `parser.currentToken()`/`parser.nextToken()` directly, which surfaced the `ClassCastException` explicitly once instrumented. **Fix: annotate the local val's type** (`val node: JsonNode = jsonMapper.readTree(parser)`), which pins overload resolution to the non-generic `JsonNode`-returning method. This is exactly why "the executor's own verification (fresh evidence)" cannot be skipped even when a reviewer hands over an "independently probed" snippet — the snippet was correct in isolation (probed against a hand-rolled script, not the full spec suite) but broke on `ConvertFormatConfig`'s real usage pattern until this cycle's own full-suite run caught it.

### Fix

- `ConvertFormatStep.scala`'s `jsonToCsv` now parses via an explicit `jsonMapper.createParser(text)` (`com.fasterxml.jackson.core.JsonParser`, imported aliased as `JacksonJsonParser` to avoid a name clash with `spray.json.JsonParser` brought into scope by the pre-existing `import spray.json._`), reads the tree with an explicit `JsonNode` type annotation, and requires end-of-input via `parser.nextToken() == null` immediately after. Every failure path — a genuine Jackson parse exception, a `null`/missing tree (empty or whitespace-only input), or a non-null trailing token — folds into the same `fail("json-malformed", "input is not valid JSON")` call, and the parser is always closed via `finally`.
- No other reason code, message, or behavior changed: `json-not-array-of-objects`/`json-nested-value`/`json-non-string-value`/`json-inconsistent-keys` and their exact message strings are untouched (confirmed unchanged in the diff); `csvToJson`, the D5 text<->Markdown functions, `ConvertFormatConfig`, BOM handling, and duplicate-key behavior are all untouched, per scope.
- Side effect matching evaluation-3.md note 2 (non-blocking, confirmed as a side effect of CR1's own fix, not separately implemented): empty/whitespace-only `json->csv` input now again reports `json-malformed` (the pre-cycle-3 code path) instead of cycle-3's `json-not-array-of-objects` drift, since a `null`/missing tree is now folded into the parse-failure branch directly rather than falling through to the array-shape check.

### New/modified files (cycle 4)

- `backend/src/main/scala/com/helio/domain/steps/ConvertFormatStep.scala` — `jsonToCsv` rewritten on an explicit `JacksonJsonParser` + end-of-input check; new import (`com.fasterxml.jackson.core.{JsonParser => JacksonJsonParser}`, `com.fasterxml.jackson.databind.JsonNode` added to the existing `ObjectMapper` import).
- `backend/src/test/scala/com/helio/domain/steps/ConvertFormatStepSpec.scala` — 5 new tests, all under the existing `"json-malformed on unparseable JSON"` neighborhood: trailing garbage after a valid array, an extra trailing `]`, a trailing `//` comment, an empty string, and a whitespace-only string — each asserting `json-malformed`. Existing clean-input and key-order tests untouched.

### Mutation evidence (cycle 4)

**Mutation 1 — remove only the end-of-input check (keep null/missing-tree handling):**

- Mutated `if (node == null || parser.nextToken() != null)` to `if (node == null)`, from a pristine copy (`/tmp/CFS.cycle4.orig.scala`).
- Ran `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec`. **Result: RED**, exactly the 3 trailing-content tests failed, empty/whitespace stayed green (still caught by the retained null check):
  ```
  - should json-malformed on trailing garbage after an otherwise-valid array *** FAILED ***
    Expected exception java.lang.IllegalArgumentException to be thrown, but no exception was thrown
  - should json-malformed on an extra trailing closing bracket *** FAILED ***
    Expected exception java.lang.IllegalArgumentException to be thrown, but no exception was thrown
  - should json-malformed on a trailing comment after an otherwise-valid array *** FAILED ***
    Expected exception java.lang.IllegalArgumentException to be thrown, but no exception was thrown
  ```
  66/69 passed.
- Reverted via `cp /tmp/CFS.cycle4.orig.scala ...`; `diff` confirmed byte-identical.

**Mutation 2 — remove only the null/missing-tree handling (keep the end-of-input check):**

- Mutated `if (node == null || parser.nextToken() != null)` to `if (parser.nextToken() != null)`, from the same pristine copy.
- Ran the same test class. **Result: RED**, exactly the 2 empty/whitespace tests failed (with a `NullPointerException` downstream from the now-unguarded `null` node reaching `parsed.isArray`, rather than the intended `IllegalArgumentException` — still a clean test failure, proving the check is load-bearing), trailing-content tests stayed green (still caught by the retained end-of-input check):
  ```
  - should json-malformed on an empty string *** FAILED ***
    Expected exception java.lang.IllegalArgumentException to be thrown, but java.lang.NullPointerException was thrown
  - should json-malformed on a whitespace-only string *** FAILED ***
    Expected exception java.lang.IllegalArgumentException to be thrown, but java.lang.NullPointerException was thrown
  ```
  67/69 passed.
- Reverted; `diff` confirmed byte-identical against `/tmp/CFS.cycle4.orig.scala`.

Both mutations applied and reverted independently (one at a time, from the same pristine copy), each confirmed red before reverting, cleanly demonstrating the two checks are independently load-bearing and jointly necessary.

### Verification (cycle 4)

- `sbt compile` — clean.
- `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec` — 69/69 passed (64 cycle-3 + 5 new).
- `sbt test` (full suite, fresh) — **4451/4451 passed**, 0 failed (4446 cycle-3 total + 5 new tests; no regressions).
- `npm run check:scala-quality` — clean (soft file-size warnings only, unchanged from prior cycles).
- `npm run check:schemas` — schemas in sync (this fix touches no wire schema).
