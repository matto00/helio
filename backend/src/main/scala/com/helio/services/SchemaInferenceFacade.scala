package com.helio.services

import com.helio.api.protocols.FieldOverridePayload
import com.helio.domain.{DataField, DataFieldType, InferredSchema}

/** Shared `InferredField` → `DataField` projection (HEL-473), replacing the four inline copies that
 *  used to live across `SourceService`'s create/refresh paths (three without override support, one
 *  with). Lives in `services/`, not `domain/`, because `FieldOverridePayload` is an api-protocol type
 *  and domain must never depend on api (api depends on domain, never the reverse) — see
 *  `SourceConfigParsing` for the existing precedent of a small services-layer object built directly
 *  around `FieldOverridePayload`. */
object SchemaInferenceFacade {

  /** Projects an `InferredSchema` into the `DataField`s a `DataType` stores, honoring an optional
   *  per-field-name override (`displayName`/`dataType`) where supplied. Fields with no matching
   *  override keep the inferred `displayName`/`dataType`; `nullable` is always the inferred value —
   *  overrides never touch it. */
  def toDataFields(
      schema:    InferredSchema,
      overrides: Map[String, FieldOverridePayload] = Map.empty
  ): Vector[DataField] =
    schema.fields.map { f =>
      val ov = overrides.get(f.name)
      DataField(
        name        = f.name,
        displayName = ov.map(_.displayName).getOrElse(f.displayName),
        dataType    = ov.map(_.dataType).getOrElse(DataFieldType.asString(f.dataType)),
        nullable    = f.nullable
      )
    }.toVector
}
