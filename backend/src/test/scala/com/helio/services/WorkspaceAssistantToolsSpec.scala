package com.helio.services

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsArray, JsObject, JsString}

/** HEL-661 tasks.md 5.7 — `WorkspaceAssistantTools.findTool`/`getResourceTool` are well-formed
 *  `ClaudeTool` values: non-blank `name`/`description`, and an `inputSchema` that is a valid JSON
 *  Schema object naming its parameters. Pure/no DB — these are static values. */
class WorkspaceAssistantToolsSpec extends AnyWordSpec with Matchers {

  /** Asserts `schema` is a JSON Schema object describing `expectedProperties` (order-independent) —
   *  `{ "type": "object", "properties": {...}, "required": [...] }` with a JSON-Schema-typed entry
   *  for every expected property name. */
  private def assertObjectSchema(schema: JsObject, expectedProperties: Set[String]): Unit = {
    schema.fields.get("type") shouldBe Some(JsString("object"))

    val properties = schema.fields.get("properties") match {
      case Some(o: JsObject) => o
      case other             => fail(s"expected a properties object, got $other")
    }
    properties.fields.keySet shouldBe expectedProperties
    properties.fields.values.foreach {
      case p: JsObject => p.fields.get("type") shouldBe defined
      case other        => fail(s"expected each property to be a JSON Schema object, got $other")
    }

    schema.fields.get("required") match {
      case Some(JsArray(elements)) =>
        elements should not be empty
        elements.foreach(_ shouldBe a[JsString])
      case other => fail(s"expected a non-empty required array, got $other")
    }
  }

  "WorkspaceAssistantTools.findTool" should {
    "have a non-blank name matching \"find\", a non-blank description, and a valid inputSchema" in {
      val tool = WorkspaceAssistantTools.findTool
      tool.name shouldBe "find"
      tool.description.trim should not be empty

      val schema = tool.inputSchema.asJsObject
      assertObjectSchema(schema, Set("query", "resourceTypes"))
    }
  }

  "WorkspaceAssistantTools.getResourceTool" should {
    "have a non-blank name matching \"get_resource\", a non-blank description, and a valid inputSchema" in {
      val tool = WorkspaceAssistantTools.getResourceTool
      tool.name shouldBe "get_resource"
      tool.description.trim should not be empty

      val schema = tool.inputSchema.asJsObject
      assertObjectSchema(schema, Set("id", "type"))
    }
  }
}
