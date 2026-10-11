package com.helio.testkit

import spray.json._

/** HEL-1489: the invalid rolling-frame window configs (and one valid control) the route-level rejection specs
 *  send to every write surface, with the EXACT message `PipelineStep.rawConfigProblem` must produce for each. */
object WindowRollingRejectionCases {

  final case class Case(label: String, config: JsObject, message: String)

  private def orderKey(field: String, direction: String): JsObject =
    JsObject("field" -> JsString(field), "direction" -> JsString(direction))

  /** A valid trailing `rows` rolling config over a `value` column. */
  val valid: JsObject = JsObject(
    "partitionBy"  -> JsArray(),
    "orderBy"      -> JsArray(orderKey("value", "asc")),
    "function"     -> JsString("rolling_sum"),
    "field"        -> JsString("value"),
    "outputColumn" -> JsString("rolling_v"),
    "frameSize"    -> JsNumber(3),
    "frameUnit"    -> JsString("rows")
  )

  private def with_(extra: (String, JsValue)*): JsObject = JsObject(valid.fields ++ extra)

  private def sizeMessage(got: String) =
    s"window function 'rolling_sum' requires 'frameSize' to be an integer in 1..1000, got $got"
  private val daysMessage =
    "window function 'rolling_sum' with frameUnit 'days' requires exactly one ascending 'orderBy' key"

  val invalid: Vector[Case] = Vector(
    Case("non-integer frameSize 7.5", with_("frameSize" -> JsNumber(BigDecimal("7.5"))), sizeMessage("7.5")),
    Case("overflowing frameSize 5000000000", with_("frameSize" -> JsNumber(BigDecimal("5000000000"))), sizeMessage("5000000000")),
    Case("frameSize 0", with_("frameSize" -> JsNumber(0)), sizeMessage("0")),
    Case("frameSize 1001", with_("frameSize" -> JsNumber(1001)), sizeMessage("1001")),
    Case(
      "unsupported frameUnit weeks",
      with_("frameUnit" -> JsString("weeks")),
      "window function 'rolling_sum' has unsupported frameUnit: 'weeks'. Supported: rows, days"
    ),
    Case(
      "days with a two-key orderBy",
      with_("frameUnit" -> JsString("days"), "orderBy" -> JsArray(orderKey("value", "asc"), orderKey("other", "asc"))),
      daysMessage
    ),
    Case(
      "days with a descending orderBy",
      with_("frameUnit" -> JsString("days"), "orderBy" -> JsArray(orderKey("value", "desc"))),
      daysMessage
    )
  )
}
