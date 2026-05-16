package com.helio.domain

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
}
