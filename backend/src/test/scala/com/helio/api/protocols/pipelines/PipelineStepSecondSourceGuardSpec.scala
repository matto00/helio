package com.helio.api.protocols.pipelines

import com.helio.domain.model.PipelineStep
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Automated guard proving `PipelineStepConfigCodec.secondaryDataSourceId` cannot silently
 *  drift out of sync with the set of step-config kinds that carry a second, separately-owned
 *  DataSource id -- the risk design.md's Decision 7 names explicitly: the extractor's
 *  parameter is `Any` (the 23 `*Config` case classes share no sealed parent), so the compiler
 *  gives NO exhaustiveness check when a future op adds a second-source field and forgets to
 *  extend the extractor's match. HEL-386/HEL-620/HEL-950.
 *
 *  Adopted form (design.md Decision 7, round 3 of the design gate): RUNTIME, type-agnostic,
 *  location-agnostic. A regex source-scan (the form round 3 rejected) silently misses a field
 *  declared `Option[String]`/`Seq[String]`/a `DataSourceId` value class, never specifies how a
 *  scanned field NAME becomes an actual `secondaryDataSourceId` invocation (risking two
 *  hardcoded lists compared to each other), and can pass vacuously if a path/cwd change makes
 *  the scan find nothing. This spec instead iterates `PipelineStep.Registry` -- the single
 *  source of truth every op is registered in -- decodes a default config per kind, and calls
 *  the REAL extractor against it, so a kind whose second-source field the extractor doesn't
 *  handle fails this test, not a comparison of two string lists.
 *
 *  Modeled on `RlsPolicyGuardSpec`'s runtime-enumeration-against-the-real-mechanism shape, not
 *  on `SchemaFieldStructuralGuardSpec`/`RestConnectorEgressGuardSpec` (neither of which reads a
 *  source file, despite an earlier draft of design.md citing them as source-scanning
 *  precedent -- corrected there rather than silently, per that document's own review lesson). */
class PipelineStepSecondSourceGuardSpec extends AnyWordSpec with Matchers {

  // The three fields this change closes the class for (design.md Decision 5's enumeration,
  // recorded in proposal.md): exactly these three kinds carry a `*DataSourceId` field among
  // all 23 registered step-config case classes.
  private val expectedSecondSourceFields: Map[String, String] = Map(
    "join"   -> "rightDataSourceId",
    "union"  -> "otherDataSourceId",
    "lookup" -> "referenceDataSourceId"
  )

  "secondaryDataSourceId, exercised via PipelineStep.Registry" should {
    "find exactly three second-source fields across all registered kinds, and extract both legs for real" in {
      var foundSecondSourceFields = 0

      PipelineStep.Registry.foreach { case (kind, companion) =>
        // Tolerant decode of "{}" yields a default-valued typed config for every kind
        // (per Companion.decodeConfig's own contract).
        val defaultDecoded = companion.decodeConfig("{}")

        // A decode that is NOT a Product MUST fail this guard loudly -- a silent skip would
        // reopen the exact vacuity hole this guard exists to close for that kind.
        val defaultProduct = defaultDecoded match {
          case p: Product => p
          case other =>
            fail(s"kind '$kind': decodeConfig(\"{}\") produced a non-Product (${other.getClass.getName}); " +
              "the guard cannot reflect its fields")
        }

        val secondSourceFieldNames =
          defaultProduct.productElementNames.zip(defaultProduct.productIterator.toSeq)
            .collect { case (name, _) if name.endsWith("DataSourceId") => name }
            .toVector

        secondSourceFieldNames.foreach { fieldName =>
          foundSecondSourceFields += 1

          // Leg 1: the default (empty) decode's second-source id extracts to None.
          withClue(s"kind '$kind', field '$fieldName', default decode: ") {
            PipelineStepConfigCodec.secondaryDataSourceId(defaultDecoded) shouldBe None
          }

          // Leg 2: setting that field to a real id (via the SAME tolerant decode path a real
          // caller's JSON goes through) extracts to Some(the id). Let a decode failure here be
          // LOUD (never wrapped in a swallowing Try) -- a future op declaring this field as
          // something a bare JSON string can't populate (e.g. Seq[String]) is drift correctly
          // detected, not a false pass.
          val populated = companion.decodeConfig(s"""{"$fieldName":"real-id"}""")
          withClue(s"kind '$kind', field '$fieldName', populated decode: ") {
            PipelineStepConfigCodec.secondaryDataSourceId(populated) shouldBe Some("real-id")
          }
        }
      }

      // Positive baseline: the enumeration actually visited all 23 registered kinds and found
      // exactly three second-source fields -- a guard that silently visited zero kinds (e.g.
      // because Registry was empty in this test's classloading context) would otherwise pass
      // vacuously.
      PipelineStep.Registry.size shouldBe 23
      foundSecondSourceFields shouldBe 3
    }

    "match the expected (kind -> field) pairing exactly, not merely the count" in {
      val actual = PipelineStep.Registry.flatMap { case (kind, companion) =>
        companion.decodeConfig("{}") match {
          case p: Product =>
            p.productElementNames.filter(_.endsWith("DataSourceId")).map(kind -> _)
          case other =>
            fail(s"kind '$kind': decodeConfig(\"{}\") produced a non-Product (${other.getClass.getName})")
        }
      }.toMap

      actual shouldBe expectedSecondSourceFields
    }
  }
}
