package com.helio.services

import com.helio.api.JsonProtocols
import com.helio.api.protocols.FieldOverridePayload
import spray.json._

/** Spray-JSON helper imports for the service layer.
 *
 *  As of CS2c-2 the typed REST / SQL config decoding lives at the repository
 *  boundary (see `DataSourceConfigCodec` in `com.helio.api.protocols`); the
 *  service layer no longer parses raw stored config strings. This object
 *  remains as the import surface for `Vector[FieldOverridePayload]` JSON
 *  parsing used by the CSV-upload multipart path. */
private[services] object SourceConfigParsing extends JsonProtocols {

  /** Re-export the format for `Vector[FieldOverridePayload]` — used by
   *  `DataSourceService.parseFieldOverrides` for the CSV-upload multipart. */
  implicit val fieldOverrideVectorFormat: RootJsonFormat[Vector[FieldOverridePayload]] =
    vectorFormat(fieldOverridePayloadFormat)
}
