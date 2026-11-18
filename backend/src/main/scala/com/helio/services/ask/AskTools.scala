package com.helio.services.ask

import com.helio.infrastructure.ai.ClaudeTool
import spray.json._

/** HEL-1745 D5: the four read-only tools. Nothing here writes, proposes or applies anything. */
object AskTools {

  val ListBoardOutputs = "list_board_outputs"
  val GetOutputRows    = "get_output_rows"
  val GetOutputHistory = "get_output_history"
  val GetHistoryRows   = "get_history_rows"

  val MaxRows: Int           = 50
  val DefaultRows: Int       = 20
  val MaxHistoryPoints: Int  = 60
  val DefaultHistoryPoints: Int = 30

  private def schema(props: (String, JsValue)*)(required: String*): JsValue =
    JsObject(
      "type"       -> JsString("object"),
      "properties" -> JsObject(props.toMap),
      "required"   -> JsArray(required.map(r => JsString(r: String): JsValue).toVector)
    )

  private def prop(tpe: String, description: String): JsValue = JsObject("type" -> JsString(tpe), "description" -> JsString(description))

  private val outputId = "outputId" -> prop("string", "An Output id returned by list_board_outputs.")

  private val listBoard = ClaudeTool(
    ListBoardOutputs,
    "List the Outputs this question may read: id, name, kind, the titles of the panels that show it, and its column names. Carries no numbers.",
    schema()()
  )

  private val rows = ClaudeTool(
    GetOutputRows,
    s"Read the latest rows of one Output (at most $MaxRows). Optionally filter on one column; on a dashboard only columns the board offers as a control can be filtered.",
    schema(
      outputId,
      "filter" -> JsObject(
        "type"        -> JsString("object"),
        "description" -> JsString("Match rows whose column contains the value."),
        "properties"  -> JsObject("column" -> prop("string", "Column name."), "value" -> prop("string", "Text to match.")),
        "required"    -> JsArray(JsString("column"), JsString("value"))
      ),
      "limit" -> prop("integer", s"Rows to return, 1..$MaxRows (default $DefaultRows).")
    )("outputId")
  )

  private val history = ClaudeTool(
    GetOutputHistory,
    "Read the recorded run history of one Output: its comparison and the headline value of each recorded run, oldest first.",
    schema(
      outputId,
      "since" -> prop("string", "Only runs at or after this ISO-8601 instant."),
      "limit" -> prop("integer", s"Runs to return, 1..$MaxHistoryPoints (default $DefaultHistoryPoints).")
    )("outputId")
  )

  private val historyRows = ClaudeTool(
    GetHistoryRows,
    s"Read the stored rows of one recorded run of an Output (at most $MaxRows). Use a pointId returned by get_output_history.",
    schema(outputId, "pointId" -> prop("string", "A pointId from get_output_history."))("outputId", "pointId")
  )

  /** `get_history_rows` is offered only when the caller holds a pipeline grant on at least one in-scope Output. */
  def definitions(offerHistoryRows: Boolean): Seq[ClaudeTool] =
    Seq(listBoard, rows, history) ++ Option.when(offerHistoryRows)(historyRows)
}
