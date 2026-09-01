## Skeptic Report — final gate (round 4, skeptic-final-4-wire-diff.md)

Narrow verification of commit `911c697c`'s fix for round 3's `nodeStepId` finding, plus the
requested class-closing sweep across this change's `specs/` deltas. Wire-contract dimension only.

### What I verified (with evidence)

1. **`nodeStepId` spec wording fixed — CONFIRMED.**
   `specs/output-routes-api/spec.md:21-24` (requirement) and `:29-32` (scenario) now both state
   the key is **OMITTED entirely**, "never present as a literal `null`". Grepped every `null`
   occurrence in the file: the only survivors are the request-side line 20 ("`nodeStepId` absent
   or null SHALL bind ... to the pipeline root", correct — the request side genuinely accepts
   both) and the PATCH absent-vs-null idiom at `:110-111` (correct, HEL-362/623).
   Mechanism independently re-verified against ground truth, not taken from the report:
   `OutputProtocol.scala:19` `nodeStepId: Option[String]`, `:54` `jsonFormat10`, and
   `grep -rn "NullOptions" backend/src/main/scala` → **zero hits** (the only two hits repo-wide
   are the explanatory comments in the two test files).

2. **The `nodeStepId` raw-JSON assertion is real — CONFIRMED.**
   `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala:187-189`:
   ```scala
   val rawJson = responseAs[JsObject]
   rawJson.fields.keySet should not contain "nodeStepId"
   rawJson.convertTo[OutputResponse].name shouldBe "My Output"
   ```
   It inspects the raw parsed `JsObject` key set **before** any case-class conversion, so it does
   distinguish omitted from `null`. It is **not vacuous**: the following `convertTo[...].name
   shouldBe "My Output"` on the same object proves the body is genuinely populated (an empty or
   unparsed object would fail there). Ran it fresh:
   `sbt -batch 'testOnly ...OutputRoutesSpec'` → **`Tests: succeeded 34, failed 0`**, exit 0.

3. **Gates re-run — CONFIRMED.**
   - `openspec validate output-routes-api-contracts --strict` → "Change ... is valid"
   - `node scripts/check-schema-drift.mjs` → "schemas in sync with JsonProtocols (73 checked
     across 48 protocol files)", "panel-type enums in sync" (exit 0)

4. **Class-closing sweep — FOUND A THIRD INSTANCE (see Change Requests).**
   I enumerated the class exhaustively rather than grepping for prose. Every **response-side**
   `Option` field in the protocols this change adds/changes:
   | field | format | spec claim | correct? |
   |---|---|---|---|
   | `OutputResponse.nodeStepId` | `jsonFormat10` | omitted | fixed (cycle 12) |
   | `ExpandPipelineShapeResponse.outputs` | `jsonFormat2` | omitted | fixed (cycle 11) |
   | `ShapeStepExpansionResponse.parentStepId` | `jsonFormat4` | **"`null` for the first"** | **WRONG** |

   `OutputProtocol.scala:32/35/46` (`CreateOutputRequest`/`UpdateOutputRequest`) are request-side
   and correctly documented under the absent-vs-null idiom — not part of this class.

   I did not stop at reasoning from the format. **Empirical proof**, via
   `sbt console` with `initialCommands` (no repo files modified):
   ```
   RAWJSON={"steps":[{"clientId":"step-0","config":{},"kind":"aggregate"},
                     {"clientId":"step-1","config":{},"kind":"limit","parentStepId":"step-0"}]}
   ```
   The first entry has **no `parentStepId` key at all**; only the second carries it. (This same
   run also re-confirms the `outputs` key is absent.)

   The `lastRunStatus`/`lastRunAt`/`lastRunRowCount` "null" wording in
   `specs/pipeline-list-api/spec.md:43,58` and `specs/pipeline-create-api/spec.md:37` has the
   same imprecision, but I verified the executor's justification myself against
   `git show main:openspec/specs/...` — the wording is **verbatim pre-existing on `main`** on
   pre-existing routes. Correctly left alone; inherited debt, not introduced here.

### Verdict: REFUTE

Round 3's `nodeStepId` finding is genuinely and well fixed, and the gates are green. But the
sweep I was asked to run to *close the class* turned up the third instance, and unlike the
`lastRun*` wording it is **new in this change** — `git show main:openspec/specs/pipeline-shape-registry/spec.md`
contains no `parentStepId`/`clientId` at all, so this text ships for the first time here. It is
in the same requirement that now correctly explains the omitted-key semantics for `outputs`,
two paragraphs above a scenario that asserts `parentStepId` is `null`.

### Change Requests

1. `specs/pipeline-shape-registry/spec.md:11` — the declared wire shape reads
   `parentStepId: String | null`. It is not nullable: `ShapeStepExpansionResponse.parentStepId`
   is `Option[String]` (`PipelineShapeProtocol.scala:66`) serialized by `jsonFormat4` (`:132`)
   with no `NullOptions`, so the first step's entry **omits the key entirely** (proven above).
   Change to optional-key semantics, e.g. `parentStepId?: String`, matching the `outputs?`
   notation already used on the same line.
2. `specs/pipeline-shape-registry/spec.md:16` — "a `parentStepId` referencing the PRIOR entry's
   `clientId` (`null` for the first)". Reword to "(**the key is OMITTED entirely** for the first
   entry, never present as `parentStepId: null` — same optional-key semantics as `outputs`
   below)".
3. `specs/pipeline-shape-registry/spec.md:41-42` — the "Expand succeeds for a registered shape"
   scenario asserts "whose `parentStepId` is `null`". Reword to assert the key is absent from the
   raw response JSON, mirroring the `outputs` clause in the very same scenario.
4. `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala:94` and
   `:111` — both assert `resp.steps.head.parentStepId shouldBe None`, which is exactly the
   deserialized-case-class assertion that cannot distinguish omitted from null and that let this
   class survive three rounds. Add a raw-`JsObject` assertion on the first step entry, e.g.
   `rawJson.fields("steps").asInstanceOf[JsArray].elements.head.asJsObject.fields.keySet should not contain "parentStepId"`,
   and (to keep it non-vacuous) a positive `should contain("clientId")` on the same key set.
   Line 113's `shouldBe Some("step-0")` for the second entry is fine as-is — a present value is
   unambiguous.

With these four, every response-side `Option` field introduced by this change is documented and
test-guarded correctly, and the class is genuinely closed rather than closed-by-assertion.

### Non-blocking notes

- `specs/pipeline-shape-registry/spec.md:51` ("each entry's (except the first's) `parentStepId`
  set to the PRIOR entry's `clientId`") is already accurate — it describes absence by exclusion
  rather than claiming `null`. No change needed; noting it so it is not "fixed" unnecessarily.
- `PipelineShapeProtocol.scala:60`'s scaladoc says "(`None` for the first)", which is correct
  Scala-side. Only the spec prose, which describes the *wire*, was wrong.
- `scripts/concertino/next-report-number.sh ... skeptic-final` returned `number=1` (path
  `skeptic-final-1.md`) because it does not model this change's dimension-suffixed convention
  (`skeptic-final-1-acl.md`, `-contracts`, `-wire-diff`, ...). I used the coordinator's
  explicitly specified, non-colliding filename instead of the script's colliding suggestion.
