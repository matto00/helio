package com.helio.domain.model

import com.helio.domain.model.TypeChangedColumn
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.PipelineSchemaDrift
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-462: pure diff coverage for `PipelineSchemaDrift.diff` (design D3). */
class PipelineSchemaDriftSpec extends AnyWordSpec with Matchers {

  private def field(name: String, t: String): SchemaField = SchemaField(name, t)

  private val baseline: Vector[SchemaField] = Vector(
    field("order_id",   "string"),
    field("amount",     "number"),
    field("created_at", "string")
  )

  "PipelineSchemaDrift.diff" should {

    "(a) report no drift when there is no baseline (first run)" in {
      PipelineSchemaDrift.diff(None, baseline) shouldBe None
    }

    "report no drift when the current schema exactly matches the baseline" in {
      PipelineSchemaDrift.diff(Some(baseline), baseline) shouldBe None
    }

    "report no drift when the current schema matches the baseline but in a different order" in {
      val reordered = Vector(field("created_at", "string"), field("order_id", "string"), field("amount", "number"))
      PipelineSchemaDrift.diff(Some(baseline), reordered) shouldBe None
    }

    "(b) reports a removed source column in removedColumns" in {
      val current = baseline.filterNot(_.name == "created_at")
      val result  = PipelineSchemaDrift.diff(Some(baseline), current)

      result shouldBe defined
      result.get.removedColumns shouldBe Vector(field("created_at", "string"))
      result.get.addedColumns shouldBe empty
      result.get.typeChangedColumns shouldBe empty
    }

    "reports an added column in addedColumns" in {
      val current = baseline :+ field("region", "string")
      val result  = PipelineSchemaDrift.diff(Some(baseline), current)

      result shouldBe defined
      result.get.addedColumns shouldBe Vector(field("region", "string"))
      result.get.removedColumns shouldBe empty
      result.get.typeChangedColumns shouldBe empty
    }

    "(c) reports a type change in typeChangedColumns" in {
      val current = baseline.map(f => if (f.name == "amount") f.copy(`type` = "string") else f)
      val result  = PipelineSchemaDrift.diff(Some(baseline), current)

      result shouldBe defined
      result.get.typeChangedColumns shouldBe Vector(TypeChangedColumn("amount", previousType = "number", currentType = "string"))
      result.get.addedColumns shouldBe empty
      result.get.removedColumns shouldBe empty
    }

    "reports added, removed, and type-changed columns together in one drift" in {
      val current = Vector(
        field("order_id", "string"),      // unchanged
        field("amount",   "integer"),     // type changed (was "number")
        field("region",   "string")       // added ("created_at" implicitly removed)
      )
      val result = PipelineSchemaDrift.diff(Some(baseline), current)

      result shouldBe defined
      result.get.addedColumns shouldBe Vector(field("region", "string"))
      result.get.removedColumns shouldBe Vector(field("created_at", "string"))
      result.get.typeChangedColumns shouldBe Vector(TypeChangedColumn("amount", previousType = "number", currentType = "integer"))
    }

    "collapses duplicate column names to their positionally-last entry on both sides" in {
      val dupBaseline = Vector(field("id", "string"), field("id", "integer"))
      val dupCurrent  = Vector(field("id", "integer"), field("id", "number"))

      // Last-wins: baseline "id" == "integer", current "id" == "number" -> a type change.
      val result = PipelineSchemaDrift.diff(Some(dupBaseline), dupCurrent)
      result shouldBe defined
      result.get.typeChangedColumns shouldBe Vector(TypeChangedColumn("id", previousType = "integer", currentType = "number"))
    }

    "reports no drift for an empty baseline compared against an empty current schema" in {
      PipelineSchemaDrift.diff(Some(Vector.empty), Vector.empty) shouldBe None
    }
  }
}
