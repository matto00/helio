package com.helio.services.sources

import com.helio.services.sources.SchemaInferenceFacade
import com.helio.api.protocols.sources.FieldOverridePayload
import com.helio.domain.model.{DataFieldType, InferredField, InferredSchema}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class SchemaInferenceFacadeSpec extends AnyWordSpec with Matchers {

  private val schema = InferredSchema(Seq(
    InferredField("id", "Id", DataFieldType.IntegerType, nullable = false),
    InferredField("label", "Label", DataFieldType.StringType, nullable = true)
  ))

  "SchemaInferenceFacade.toSchemaFields" should {

    // HEL-904: projects straight to SchemaField {name, type} — no more DataField
    // displayName/nullable, which had no equivalent on a bare inferred schema.
    "produce SchemaFields matching the inferred values when no overrides are supplied" in {
      val fields = SchemaInferenceFacade.toSchemaFields(schema)
      fields should have size 2

      val byName = fields.map(f => f.name -> f).toMap
      byName("id").`type`    shouldBe "integer"
      byName("label").`type` shouldBe "string"
    }

    "apply a matching override's dataType" in {
      val overrides = Map("id" -> FieldOverridePayload(name = "id", displayName = "Order ID", dataType = "string"))
      val fields    = SchemaInferenceFacade.toSchemaFields(schema, overrides)

      val idField = fields.find(_.name == "id").getOrElse(fail("expected an 'id' field"))
      idField.`type` shouldBe "string"

      val labelField = fields.find(_.name == "label").getOrElse(fail("expected a 'label' field"))
      labelField.`type` shouldBe "string"
    }

    "canonicalize a non-canonical legacy override dataType (double/long/date) (HEL-906 cycle 4)" in {
      val overrides = Map("id" -> FieldOverridePayload(name = "id", displayName = "Order ID", dataType = "double"))
      val fields    = SchemaInferenceFacade.toSchemaFields(schema, overrides)
      fields.find(_.name == "id").get.`type` shouldBe "float"
    }

    "ignore an override whose field name doesn't match any inferred field (no-op)" in {
      val overrides = Map("nonexistent" -> FieldOverridePayload(name = "nonexistent", displayName = "X", dataType = "boolean"))
      val fields    = SchemaInferenceFacade.toSchemaFields(schema, overrides)

      fields.map(_.name) should contain theSameElementsAs Seq("id", "label")
      fields.find(_.name == "id").get.`type`    shouldBe "integer"
      fields.find(_.name == "label").get.`type` shouldBe "string"
    }

    "return an empty Vector for an empty schema" in {
      SchemaInferenceFacade.toSchemaFields(InferredSchema(Seq.empty)) shouldBe empty
    }
  }
}
