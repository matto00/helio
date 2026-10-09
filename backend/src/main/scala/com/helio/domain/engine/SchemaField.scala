package com.helio.domain.engine

import com.helio.domain.model.DataFieldType


/** HEL-906 cycle 5 (coordinator ruling, AC-3 "real structural guard"): `require` in the
 *  primary constructor is the ONE choke point every `SchemaField(...)` construction site in the
 *  whole codebase passes through, whichever of the 31+ sites it is -- there is no way to build a
 *  `SchemaField` with a non-canonical `type` string without an immediate `IllegalArgumentException`
 *  at construction time. This is deliberately a hard failure (not a silent `Either`/`Option`
 *  return), because a `SchemaField` with a bad type is a programming error at every INTERNAL
 *  call site (they should already be canonical, e.g. via `DataFieldType.asString`/
 *  `canonicalizeLegacy`) -- the two BOUNDARY call sites that accept a raw, unvalidated
 *  caller-supplied `type` string over the wire (`DataSourceService.createStatic`,
 *  `PipelineAnalyzeService.inferAggregate`'s `groupBy`) validate with `DataFieldType.fromString`
 *  and return a clean 400 BEFORE ever reaching this constructor, so a malformed request never
 *  hits this `require` in practice -- it exists to catch any FUTURE producer that skips that
 *  boundary check, converting the old silent-`case other => other`-passthrough gap
 *  `canonicalizeLegacy` still has into a fail-loud bug instead of a silently-corrupted row.
 *  `SchemaFieldStructuralGuardSpec` asserts this directly (constructing a `SchemaField` with a
 *  garbage type throws), so a future refactor that removes this `require` fails a test, not just
 *  a review. */
final case class SchemaField(name: String, `type`: String) {
  require(
    DataFieldType.fromString(`type`).isDefined,
    s"SchemaField: '${`type`}' is not a canonical DataFieldType wire value for field '$name'. " +
      s"Valid values: ${DataFieldType.CanonicalWireValues.mkString(", ")}"
  )
}
