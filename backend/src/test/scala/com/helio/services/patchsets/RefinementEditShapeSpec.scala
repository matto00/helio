package com.helio.services.patchsets

import com.helio.services.patchsets.RefinementEditShape
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.patchsets.{Edit, PatchSetProtocol}
import com.helio.domain.steps.{AggregateConfig, GroupByConfig, JoinConfig, PivotConfig, StepConfigTypeMismatch, UnpivotConfig, WindowConfig}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Regression coverage for `RefinementEditShape`'s worked JSON examples (evaluation-1.md cycle-1 +
 *  evaluation-2.md cycle-3 findings, design.md D2a) — each panel-update/-create example is REAL,
 *  valid JSON that decodes to a valid `Edit` via the actual `PatchSetProtocol.editFormat` reader,
 *  AND its `config` decodes through the matching real `*PanelConfig.Patch.decode`/`.decodeCreate`
 *  with the SEMANTICALLY complete fields real consumers (e.g. `usePanelData.ts`'s
 *  `computeAggregate(rows, metricAggregation.value, ...)`) actually require — not merely
 *  structurally-valid JSON. Nothing downstream (`PatchSetPreviewService.preview` included)
 *  validates `aggregation`'s internal shape, so this is the only guardrail against a
 *  hand-maintained prompt example silently drifting out of sync with what the real config types
 *  need — exactly the class of defect cycle 1 caught in the UPDATE example, and cycle 3 caught
 *  again (live, via two real Claude calls) in the CREATE path the cycle-1 fix never touched. */
class RefinementEditShapeSpec extends AnyWordSpec with Matchers with PatchSetProtocol {

  private def parseEdit(json: String): Edit = json.parseJson.convertTo[Edit]

  // ── pipelineStep UPDATE path (skeptic-final-1.md, D2a's pipelineStep gap) — decodes the SAME way
  //    `PatchSetApplyResolvers.resolvePipelineStepUpdate`/`validateEmbeddedStepReferences` do
  //    (`UpdatePipelineStepRequest.config` -> `*Config.decode(rawJsonText)`), and — critically —
  //    asserts the decoded `groupBy`/`aggregations` are NON-EMPTY and match the example's own
  //    requested values, not just "decodes without throwing". `AggregateConfig.decode`/
  //    `GroupByConfig.decode` silently DROP a shape-mismatched item rather than raising (see their
  //    own doc comments), so a merely-decodes-successfully assertion would NOT have caught the live
  //    defect this suite exists to guard against — only a non-empty/content check does. ─────────

  "RefinementEditShape's worked pipelineStep-update examples" should {

    "rename: decodes to a valid Edit + UpdatePipelineStepRequest carrying a non-empty renames map" in {
      val edit = parseEdit(RefinementEditShape.RenameStepExample)
      edit.target.kind shouldBe "pipelineStep"
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      request.config shouldBe defined
      request.config.get.fields.keySet should contain("renames")
    }

    "aggregate: config round-trips through the REAL AggregateConfig.decode with non-empty groupBy/aggregations matching the example's own values" in {
      val edit = parseEdit(RefinementEditShape.AggregateStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = AggregateConfig.decode(request.config.get.compactPrint)

      decoded.groupBy should not be empty
      decoded.groupBy.map(_.name) should contain("region")
      decoded.aggregations should not be empty
      decoded.aggregations.map(_.alias) should contain("total_amount")
      decoded.aggregations.map(_.fn) should contain("avg")
      decoded.aggregations.map(_.field) should contain("amount")
    }

    "groupby: config round-trips through the REAL GroupByConfig.decode with a non-empty groupBy matching the example's own values (a DIFFERENT shape from aggregate)" in {
      val edit = parseEdit(RefinementEditShape.GroupByStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = GroupByConfig.decode(request.config.get.compactPrint)

      decoded.groupBy should contain("region")
      decoded.aggColumn shouldBe "amount"
      decoded.aggFunction shouldBe "avg"
    }

    // HEL-671: join/pivot/window/unpivot decode-and-assert-actual-values coverage (design.md D2,
    // tasks 3.2) — mirrors the aggregate/groupby tests above exactly: decode through the REAL config
    // decoder and assert non-empty/matching field values, never a bare "decodes without throwing"
    // assertion (that assertion shape would NOT catch a wrong-shape edit that silently decodes to a
    // degraded/defaulted config).

    "join: config round-trips through the REAL JoinConfig.decode with non-empty rightDataSourceId/joinKey/joinType matching the example's own values" in {
      val edit = parseEdit(RefinementEditShape.JoinStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = JoinConfig.decode(request.config.get.compactPrint)

      decoded.rightDataSourceId should not be empty
      decoded.rightDataSourceId shouldBe "src_456"
      decoded.joinKey should not be empty
      decoded.joinKey shouldBe "customerId"
      decoded.joinType shouldBe "left"
    }

    "pivot: config round-trips through the REAL PivotConfig.decode with a non-empty index matching the example's own column/values/agg" in {
      val edit = parseEdit(RefinementEditShape.PivotStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = PivotConfig.decode(request.config.get.compactPrint)

      decoded.index should not be empty
      decoded.index should contain("region")
      decoded.column shouldBe "quarter"
      decoded.values shouldBe "revenue"
      decoded.agg shouldBe "sum"
    }

    "unpivot: config round-trips through the REAL UnpivotConfig.decode with non-empty idVars/valueVars matching the example's own columns" in {
      val edit = parseEdit(RefinementEditShape.UnpivotStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = UnpivotConfig.decode(request.config.get.compactPrint)

      decoded.idVars should not be empty
      decoded.idVars should contain("region")
      decoded.valueVars should not be empty
      decoded.valueVars should contain allOf ("q1", "q2")
      decoded.varName shouldBe "quarter"
      decoded.valueName shouldBe "revenue"
    }

    "window: config round-trips through the REAL WindowConfig.decode with orderBy/partitionBy both reflecting every intended entry (no item silently dropped)" in {
      val edit = parseEdit(RefinementEditShape.WindowStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = WindowConfig.decode(request.config.get.compactPrint)

      decoded.partitionBy should not be empty
      decoded.partitionBy should contain("region")
      decoded.orderBy should not be empty
      decoded.orderBy.map(_.field) should contain("revenue")
      decoded.orderBy.map(_.direction) should contain("desc")
      decoded.function shouldBe "row_number"
      decoded.outputColumn shouldBe "rank"
    }
  }

  // HEL-671 skeptic-final-1.md CR-1: a discriminating NEGATIVE control. Every assertion above
  // decodes a CORRECT worked example and checks it stays correct — that alone cannot distinguish
  // "the tolerant decode-time defaulting is real" from "these examples just happen to be
  // well-formed". Each test below hand-constructs a WRONG-SHAPE config (never one of the worked
  // examples above), decodes it through the SAME real decoder, and asserts the decoded VALUE is
  // silently degraded (empty vector / `""` default) — never a bare "decodes without throwing"
  // assertion. This is what makes "the tolerance HEL-671 exists to reason about is real" a tested
  // fact rather than a code-read/doc-comment inference.

  // HEL-814 UPDATE — the outcome of the warning below, recorded so the counts
  // are not read as a shortfall. HEL-814 landed and **3 of these 4 tests
  // flipped**; the `join` one did not, deliberately.
  //
  //  * `pivot`, `unpivot`, `window` supply a key that is PRESENT but of the
  //    WRONG JSON TYPE (a string where an array is declared, a bare string
  //    where an order-key object is declared). D1 makes exactly that raise.
  //    Those three are now PROOF that the hardening worked.
  //  * `join` hinges on `joinKey` being ABSENT, not mistyped. Absence stays
  //    tolerant on read (D1) and is deliberately not rejected on write (D2),
  //    because a step added and not yet configured is a legitimate,
  //    currently-occurring production state and `rowToDomain` turns a decode
  //    failure into a 500 — making absence raise would break opening the
  //    pipeline editor. Its completeness is enforced instead at RUN and
  //    ANALYZE time (D3), which is where an unconfigured `joinKey` now fails.
  //    It keeps its original assertion and is relabelled a GUARD below.
  //
  // The lost flip is replaced by a NEW proof in `PatchSetPreviewServiceSpec`:
  // preview rejects a `join` edit whose `joinKey` is present but of the wrong
  // JSON type. Three honest flips and one correctly-labelled guard is the
  // accurate outcome; contriving a fourth would be worse than not having it.
  //
  // ── Original HEL-671 note, kept verbatim for provenance ────────────────
  // CHARACTERIZATION-TEST WARNING (added post skeptic-final-2.md CONFIRM): the 4 tests below
  // deliberately assert the CURRENT silently-tolerant decoder behavior (`joinKey shouldBe ""`,
  // `index shouldBe empty`, `orderBy shouldBe empty`, etc.) as EXPECTED for HEL-671's scope
  // (decoder hardening is explicitly deferred — see design.md D3). HEL-814 (filed, High priority)
  // will make these decoders RAISE on shape mismatch instead of silently defaulting. When HEL-814
  // lands, ALL FOUR of these tests SHOULD FAIL — that failure is the correct signal the hardening
  // fix worked, NOT a regression in HEL-814's own change. The correct response to that failure is
  // to INVERT each assertion (e.g. assert `JoinConfig.decode(wrongShape)` raises, rather than that
  // it returns a degraded value) — never to weaken the assertion or revert the hardening just to
  // turn these tests green again.
  "The real config decoders' behavior on a hand-constructed WRONG-SHAPE config (negative control)" should {

    // GUARD (HEL-814 task 6.3) — NOT a reverted hardening, and not a weakened
    // assertion. `joinKey` is ABSENT here, not mistyped, and D1 keeps absence
    // tolerant on the read path by design: every read of a stored step decodes
    // its config, so raising here would 500 the pipeline editor for any step a
    // user added and has not finished configuring (20 such rows measured live
    // across dev and prod). The corruption this value used to cause is closed
    // at run and analyze time instead — see `PipelineStepRequiredConfigSpec`,
    // which proves a `join` step with an empty `joinKey` now fails the run
    // naming the step and the field.
    //
    // Failable by mutation, not by reverting the fix: make `StepCodecUtil.str`
    // raise on an absent key and this goes red.
    "GUARD: join — an edit OMITTING joinKey still decodes to joinKey = \"\" (absence is deliberately tolerant on read)" in {
      val absentKey = """{"rightDataSourceId": "src_456", "joinType": "inner"}"""
      val decoded = JoinConfig.decode(absentKey)

      decoded.rightDataSourceId shouldBe "src_456"
      decoded.joinKey shouldBe ""
      decoded.joinType shouldBe "inner"
    }

    // PROOF (HEL-814 task 6.1) — flipped. `index` is declared as an array of
    // source column names; a bare string cannot represent it. This used to
    // decode to an EMPTY index, which pivots every row into one group — a
    // plausible-looking result that is not what was configured.
    "PROOF: pivot — a non-array index FAILS the config rather than decoding to an empty index vector" in {
      val wrongShape = """{"index": "region", "column": "quarter", "values": "revenue", "agg": "sum"}"""
      val thrown = intercept[StepConfigTypeMismatch] { PivotConfig.decode(wrongShape) }
      thrown.getMessage should include("index")
      thrown.getMessage should include("an array of strings")
      thrown.getMessage should include("got a string")
    }

    // PROOF (HEL-814 task 6.1) — flipped. A bare-string `valueVars` used to
    // decode to an EMPTY vector, which makes unpivot emit
    // `(rows * 0) == 0` output rows: the whole dataset silently vanishes.
    //
    // Note this test can no longer also assert `varName shouldBe "variable"`,
    // because `valueVars` now raises first. That absence-default assertion is
    // not lost — it moved into the task-2.5 guard immediately below.
    "PROOF: unpivot — a bare-string valueVars FAILS the config rather than decoding to an empty vector" in {
      val wrongShape = """{"idVars": ["region"], "valueVars": "q1", "valueName": "revenue"}"""
      val thrown = intercept[StepConfigTypeMismatch] { UnpivotConfig.decode(wrongShape) }
      thrown.getMessage should include("valueVars")
      thrown.getMessage should include("got a string")
    }

    // GUARD (HEL-814 task 2.5) — the assertion displaced from the unpivot
    // proof above, re-sited so the coverage is not lost. An ABSENT `varName`
    // still takes its documented default (`pipeline-unpivot-op:11`, named
    // scenario "Default varName/valueName apply when omitted from config"),
    // and an EMPTY-but-correctly-typed array is still an empty array rather
    // than a failure. Failable by mutation: make `str`/`stringArray` raise on
    // an absent or empty value and this goes red.
    "GUARD: unpivot — an absent varName still defaults to \"variable\", and empty-but-correctly-typed arrays still decode" in {
      val absentAndEmpty = """{"idVars": [], "valueVars": [], "valueName": "revenue"}"""
      val decoded = UnpivotConfig.decode(absentAndEmpty)

      decoded.varName shouldBe "variable"
      decoded.valueName shouldBe "revenue"
      decoded.idVars shouldBe empty
      decoded.valueVars shouldBe empty
    }

    // PROOF (HEL-814 task 6.1) — flipped, and it covers BOTH mechanisms in
    // one config. `partitionBy` is a non-array (whole-value mismatch) and
    // `orderBy` holds a bare string where an order-key object is declared
    // (ELEMENT mismatch). The element case is the more important half: the
    // old `flatMap(...).toOption` DROPPED the bad element and kept its
    // siblings, producing a PARTIALLY decoded collection, which is strictly
    // worse than a total failure because it looks plausible.
    "PROOF: window — a non-array partitionBy and a plain-string orderBy element each FAIL the whole config rather than being defaulted or dropped" in {
      val wrongPartitionBy =
        """{"partitionBy": "region", "orderBy": [], "function": "row_number", "outputColumn": "rank"}"""
      val partitionByFailure = intercept[StepConfigTypeMismatch] { WindowConfig.decode(wrongPartitionBy) }
      partitionByFailure.getMessage should include("partitionBy")
      partitionByFailure.getMessage should include("got a string")

      val droppedOrderByElement =
        """{"partitionBy": ["region"], "orderBy": ["revenue"], "function": "row_number", "outputColumn": "rank"}"""
      val orderByFailure = intercept[StepConfigTypeMismatch] { WindowConfig.decode(droppedOrderByElement) }
      orderByFailure.getMessage should include("orderBy")
      orderByFailure.getMessage should include("{field, direction}")
    }
  }
}
