package com.helio.domain

import com.helio.domain.model._
import spray.json._

/** Shared helpers for the per-file `Panel` ADT. Defined once in this package
 *  object so per-subtype files can import them without duplicating parsing
 *  logic. HEL-904 task 4.1: `dataTypeIdFormat`/`metricIdFormat` removed —
 *  no panel-package config carries a `DataTypeId`/`MetricId` anymore
 *  (Text/Markdown lost their data-bound "Source mode" in the same task;
 *  Output binds via `OutputId` below). */
package object panels {

  /** JSON format for the `OutputId` value class (HEL-904) — needed by
   *  `OutputPanelConfig`'s macro-derived `jsonFormat1` format. */
  implicit val outputIdFormat: JsonFormat[OutputId] = new JsonFormat[OutputId] {
    def write(id: OutputId): JsValue = JsString(id.value)
    def read(json: JsValue): OutputId = json match {
      case JsString(s) => OutputId(s)
      case x           => deserializationError(s"Expected string for OutputId, got $x")
    }
  }
}
