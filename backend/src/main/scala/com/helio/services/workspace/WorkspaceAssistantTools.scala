package com.helio.services.workspace

import com.helio.ai.ClaudeTool
import spray.json.{JsArray, JsObject, JsString}

/** `ClaudeTool` schema definitions for `find`/`get_resource` (HEL-661 design.md D7), ready for
 *  HEL-662's `AssistantService` to hand straight to `ClaudeClient.sendWithTools`'s `tools` list.
 *  Colocated with [[WorkspaceSearchService]] in `com.helio.services`, not `com.helio.ai` — these
 *  schemas describe workspace-domain concepts (`find`/`get_resource`'s parameters), and belong beside
 *  the service they front; `com.helio.ai` stays workspace-agnostic, knowing only generic
 *  `ClaudeTool`/`ClaudeClient` shapes, never a specific tool's domain meaning.
 *
 *  No executor wiring here — parsing Claude's raw string `type`/`resourceTypes` tool-call arguments
 *  via `WorkspaceResourceType.fromString` and turning a parsed `tool_use` call into a
 *  `WorkspaceSearchService` invocation is HEL-662's responsibility (design.md D4), not this ticket's. */
object WorkspaceAssistantTools {

  /** The 5 canonical `WorkspaceResourceType` wire values (`WorkspaceResourceType.asString`), spelled
   *  out here as a JSON Schema `enum` so Claude only ever proposes a parseable `type`/`resourceTypes`
   *  value. */
  private val ResourceTypeEnum: Vector[String] = Vector("dataSource", "dataType", "pipeline", "dashboard", "metric")

  val findTool: ClaudeTool = ClaudeTool(
    name = "find",
    description =
      "Keyword/substring search across the workspace's data sources, DataTypes, pipelines, " +
      "dashboards, and metrics. Returns compact summaries (id, resourceType, name, description) " +
      "for the top matches. Use this to locate a resource before fetching its full detail with " +
      "get_resource.",
    inputSchema = JsObject(
      "type" -> JsString("object"),
      "properties" -> JsObject(
        "query" -> JsObject(
          "type"        -> JsString("string"),
          "description" -> JsString("Keyword or phrase to search for, matched case-insensitively as a substring of each resource's name or description.")
        ),
        "resourceTypes" -> JsObject(
          "type"        -> JsString("array"),
          "description" -> JsString("Optional filter restricting the search to these resource types. Omit to search every type."),
          "items" -> JsObject(
            "type" -> JsString("string"),
            "enum" -> JsArray(ResourceTypeEnum.map(JsString(_)))
          )
        )
      ),
      "required" -> JsArray(Vector(JsString("query")))
    )
  )

  val getResourceTool: ClaudeTool = ClaudeTool(
    name = "get_resource",
    description =
      "Fetch full detail for one specific workspace resource by id and type: a pipeline's steps, " +
      "a DataType's columns/sample rows/column stats, a dashboard's panel count, a data source's " +
      "metadata, or a metric's full definition.",
    inputSchema = JsObject(
      "type" -> JsString("object"),
      "properties" -> JsObject(
        "id" -> JsObject(
          "type"        -> JsString("string"),
          "description" -> JsString("The id of the resource to fetch, as returned by find.")
        ),
        "type" -> JsObject(
          "type"        -> JsString("string"),
          "description" -> JsString("The resource's type."),
          "enum"        -> JsArray(ResourceTypeEnum.map(JsString(_)))
        )
      ),
      "required" -> JsArray(Vector(JsString("id"), JsString("type")))
    )
  )
}
