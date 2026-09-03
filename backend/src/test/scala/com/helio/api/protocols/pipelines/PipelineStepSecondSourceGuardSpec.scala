package com.helio.api.protocols.pipelines

import com.helio.domain.model.PipelineStep
import com.helio.domain.steps.SecondaryInput
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Automated guard proving `PipelineStepConfigCodec.secondaryDataSourceId` /
 *  `secondaryLaneStepId` cannot silently drift out of sync with the set of step-config kinds
 *  that carry a second, separately-owned input -- the risk design.md's Decision 7 names
 *  explicitly: both extractors' parameter is `Any` (the config case classes share no sealed
 *  parent), so the compiler gives NO exhaustiveness check when a future op adds a
 *  `secondaryInput` field and forgets to extend the extractors' match. HEL-386/HEL-620/HEL-950,
 *  reworked for HEL-911's discriminated `secondaryInput` (design.md Decisions 1/1a).
 *
 *  Adopted form (design.md Decision 7, round 3 of the design gate): RUNTIME, type-agnostic,
 *  location-agnostic. This spec iterates `PipelineStep.Registry` -- the single source of truth
 *  every op is registered in -- decodes a default config per kind, and calls the REAL
 *  extractors against it, so a kind whose `secondaryInput` field the extractors don't handle
 *  fails this test, not a comparison of two string lists.
 *
 *  HEL-911 reflects on the field's TYPE (`SecondaryInput`), not a name-suffix convention --
 *  the pre-HEL-911 version keyed on `name.endsWith("DataSourceId")`, which is exactly the
 *  legacy shape this ticket deletes. Keying on the type is what makes this guard still close
 *  the same class of drift under the new shape. */
class PipelineStepSecondSourceGuardSpec extends AnyWordSpec with Matchers {

  // The three kinds this change closes the class for (mirrors the pre-HEL-911 enumeration,
  // now naming the ONE shared field name every one of them carries post-cutover).
  private val expectedSecondSourceFields: Map[String, String] = Map(
    "join"   -> "secondaryInput",
    "union"  -> "secondaryInput",
    "lookup" -> "secondaryInput"
  )

  "secondaryDataSourceId/secondaryLaneStepId, exercised via PipelineStep.Registry" should {
    "find exactly three secondaryInput fields across all registered kinds, and extract both legs for real" in {
      var foundSecondSourceFields = 0

      PipelineStep.Registry.foreach { case (kind, companion) =>
        // Tolerant decode of "{}" yields a default-valued typed config for every kind
        // (per Companion.decodeConfig's own contract) -- absent secondaryInput decodes to
        // SecondaryInput.Default (Decision 1b), not a decode failure.
        val defaultDecoded = companion.decodeConfig("{}")

        val defaultProduct = defaultDecoded match {
          case p: Product => p
          case other =>
            fail(s"kind '$kind': decodeConfig(\"{}\") produced a non-Product (${other.getClass.getName}); " +
              "the guard cannot reflect its fields")
        }

        val secondSourceFieldNames =
          defaultProduct.productElementNames.zip(defaultProduct.productIterator.toSeq)
            .collect { case (name, _: SecondaryInput) => name }
            .toVector

        secondSourceFieldNames.foreach { fieldName =>
          foundSecondSourceFields += 1

          // Leg 1 (source, empty): the default (empty) decode's secondaryDataSourceId extracts
          // to None (HEL-950's empty-id incomplete-draft guard), and secondaryLaneStepId is
          // ALSO None -- guarding BOTH legs independently (task 11.14/11.11's "break each leg
          // independently" requirement; a conjunction-only guard here would miss a kind whose
          // extractor got source-only or lane-only support).
          withClue(s"kind '$kind', field '$fieldName', default (empty source) decode: ") {
            PipelineStepConfigCodec.secondaryDataSourceId(defaultDecoded) shouldBe None
            PipelineStepConfigCodec.secondaryLaneStepId(defaultDecoded) shouldBe None
          }

          // Leg 2 (source, populated): a source-kind secondaryInput with a real id extracts via
          // secondaryDataSourceId; secondaryLaneStepId stays None (never falls through).
          val populatedSource = companion.decodeConfig(
            s"""{"$fieldName":{"kind":"source","dataSourceId":"real-id"}}"""
          )
          withClue(s"kind '$kind', field '$fieldName', populated source decode: ") {
            PipelineStepConfigCodec.secondaryDataSourceId(populatedSource) shouldBe Some("real-id")
            PipelineStepConfigCodec.secondaryLaneStepId(populatedSource) shouldBe None
          }

          // Leg 3 (lane, populated) -- HEL-911 new leg, Engine contract item 10's "lane-kind
          // has NO data-source ACL to apply" -- proves secondaryDataSourceId is None for a
          // lane-kind config (the lane branch must not fall through into the source-kind
          // check), and secondaryLaneStepId correctly extracts the referenced stepId.
          val populatedLane = companion.decodeConfig(
            s"""{"$fieldName":{"kind":"lane","stepId":"real-step"}}"""
          )
          withClue(s"kind '$kind', field '$fieldName', populated lane decode: ") {
            PipelineStepConfigCodec.secondaryDataSourceId(populatedLane) shouldBe None
            PipelineStepConfigCodec.secondaryLaneStepId(populatedLane) shouldBe Some("real-step")
          }
        }
      }

      // Positive baseline: the enumeration actually visited all registered kinds and found
      // exactly three secondaryInput fields -- a guard that silently visited zero kinds (e.g.
      // because Registry was empty in this test's classloading context) would otherwise pass
      // vacuously.
      PipelineStep.Registry.size should be > 0
      foundSecondSourceFields shouldBe 3
    }

    "match the expected (kind -> field) pairing exactly, not merely the count" in {
      val actual = PipelineStep.Registry.flatMap { case (kind, companion) =>
        companion.decodeConfig("{}") match {
          case p: Product =>
            p.productElementNames.zip(p.productIterator.toSeq)
              .collect { case (name, _: SecondaryInput) => name }
              .map(kind -> _)
          case other =>
            fail(s"kind '$kind': decodeConfig(\"{}\") produced a non-Product (${other.getClass.getName})")
        }
      }.toMap

      actual shouldBe expectedSecondSourceFields
    }
  }
}
