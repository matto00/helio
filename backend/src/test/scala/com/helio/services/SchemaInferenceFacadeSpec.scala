package com.helio.services

import com.helio.api.protocols.FieldOverridePayload
import com.helio.domain.{DataFieldType, InferredField, InferredSchema}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class SchemaInferenceFacadeSpec extends AnyWordSpec with Matchers {

  private val schema = InferredSchema(Seq(
    InferredField("id", "Id", DataFieldType.IntegerType, nullable = false),
    InferredField("label", "Label", DataFieldType.StringType, nullable = true)
  ))

  "SchemaInferenceFacade.toDataFields" should {

    "produce DataFields matching the inferred values when no overrides are supplied" in {
      val fields = SchemaInferenceFacade.toDataFields(schema)
      fields should have size 2

      val byName = fields.map(f => f.name -> f).toMap
      byName("id").displayName shouldBe "Id"
      byName("id").dataType    shouldBe "integer"
      byName("id").nullable    shouldBe false
      byName("label").displayName shouldBe "Label"
      byName("label").dataType    shouldBe "string"
      byName("label").nullable    shouldBe true
    }

    "apply a matching override's displayName and dataType, leaving nullable as inferred" in {
      val overrides = Map("id" -> FieldOverridePayload(name = "id", displayName = "Order ID", dataType = "string"))
      val fields    = SchemaInferenceFacade.toDataFields(schema, overrides)

      val idField = fields.find(_.name == "id").getOrElse(fail("expected an 'id' field"))
      idField.displayName shouldBe "Order ID"
      idField.dataType    shouldBe "string"
      idField.nullable    shouldBe false // unchanged from inferred — overrides never touch nullable

      val labelField = fields.find(_.name == "label").getOrElse(fail("expected a 'label' field"))
      labelField.displayName shouldBe "Label"
      labelField.dataType    shouldBe "string"
    }

    "ignore an override whose field name doesn't match any inferred field (no-op)" in {
      val overrides = Map("nonexistent" -> FieldOverridePayload(name = "nonexistent", displayName = "X", dataType = "boolean"))
      val fields    = SchemaInferenceFacade.toDataFields(schema, overrides)

      fields.map(_.name) should contain theSameElementsAs Seq("id", "label")
      fields.find(_.name == "id").get.displayName    shouldBe "Id"
      fields.find(_.name == "label").get.displayName shouldBe "Label"
    }

    "return an empty Vector for an empty schema" in {
      SchemaInferenceFacade.toDataFields(InferredSchema(Seq.empty)) shouldBe empty
    }
  }
}
