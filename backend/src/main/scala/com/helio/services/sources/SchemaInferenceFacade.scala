package com.helio.services.sources

import com.helio.api.protocols.sources.FieldOverridePayload
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.{DataFieldType, InferredSchema}

/** Shared `InferredField` → `SchemaField` projection (HEL-473, reshaped by HEL-904's Outputs
 *  remodel), replacing the four inline copies that used to live across `SourceService`'s
 *  create/refresh paths (three without override support, one with). Lives in `services/`, not
 *  `domain/`, because `FieldOverridePayload` is an api-protocol type and domain must never depend
 *  on api (api depends on domain, never the reverse) — see `SourceConfigParsing` for the existing
 *  precedent of a small services-layer object built directly around `FieldOverridePayload`.
 *
 *  HEL-904: projects straight to `SchemaField {name, type}` — the shape `data_sources
 *  .inferred_schema` stores — rather than the retired `DataField` (which also carried
 *  `displayName`/`nullable`, companion-`DataType`-only concepts with no equivalent on a bare
 *  inferred schema). */
object SchemaInferenceFacade {

  /** Projects an `InferredSchema` into the `SchemaField`s `data_sources.inferred_schema` stores,
   *  honoring an optional per-field-name `dataType` override where supplied. */
  def toSchemaFields(
      schema:    InferredSchema,
      overrides: Map[String, FieldOverridePayload] = Map.empty
  ): Vector[SchemaField] =
    schema.fields.map { f =>
      val ov = overrides.get(f.name)
      SchemaField(
        name = f.name,
        // HEL-906 cycle 4 (evaluation-3.md CR2 sweep): `ov.dataType` is a caller-supplied
        // field-type override over the wire (`FieldOverridePayload`) -- canonicalize known
        // non-canonical synonyms before it lands in `data_sources.inferred_schema`, the same
        // fix already applied to `DataSourceService.createCsv`'s own (not-yet-migrated-to-this-
        // facade) duplicate of this exact pattern.
        `type` = ov.map(o => DataFieldType.canonicalizeLegacy(o.dataType)).getOrElse(DataFieldType.asString(f.dataType))
      )
    }.toVector
}
