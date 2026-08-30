package com.helio.domain

import com.helio.domain.model._
import spray.json._

/** Shared helpers for the per-file `Panel` ADT. Defined once in this package
 *  object so per-subtype files (MetricPanel / ChartPanel / TablePanel /
 *  ImagePanel / DividerPanel) can import them without duplicating the
 *  `DataTypeId` format or the field-mapping parsing logic. */
package object panels {

  /** JSON format for the `DataTypeId` value class. Defined here (not in
   *  `PanelProtocol`) so per-subtype config formats compile without having
   *  to mix in the panel protocol trait. */
  implicit val dataTypeIdFormat: JsonFormat[DataTypeId] = new JsonFormat[DataTypeId] {
    def write(id: DataTypeId): JsValue = JsString(id.value)
    def read(json: JsValue): DataTypeId = json match {
      case JsString(s) => DataTypeId(s)
      case x           => deserializationError(s"Expected string for DataTypeId, got $x")
    }
  }

  /** JSON format for the `MetricId` value class (HEL-500) — mirrors
   *  `dataTypeIdFormat` above. Needed by the bound-trio configs' macro-
   *  derived `jsonFormatN` formats now that they carry an optional
   *  `metricId: Option[MetricId]` field. */
  implicit val metricIdFormat: JsonFormat[MetricId] = new JsonFormat[MetricId] {
    def write(id: MetricId): JsValue = JsString(id.value)
    def read(json: JsValue): MetricId = json match {
      case JsString(s) => MetricId(s)
      case x           => deserializationError(s"Expected string for MetricId, got $x")
    }
  }

  /** JSON format for the `OutputId` value class (HEL-904) — mirrors
   *  `dataTypeIdFormat`/`metricIdFormat` above. Needed by
   *  `OutputPanelConfig`'s macro-derived `jsonFormat1` format. */
  implicit val outputIdFormat: JsonFormat[OutputId] = new JsonFormat[OutputId] {
    def write(id: OutputId): JsValue = JsString(id.value)
    def read(json: JsValue): OutputId = json match {
      case JsString(s) => OutputId(s)
      case x           => deserializationError(s"Expected string for OutputId, got $x")
    }
  }
}
