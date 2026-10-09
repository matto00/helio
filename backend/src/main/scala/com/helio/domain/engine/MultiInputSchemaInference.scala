package com.helio.domain.engine

import com.helio.domain.steps.{JoinColumnNaming, JoinConfig, JoinStep}
import spray.json._
import spray.json.DefaultJsonProtocol._

import StepSchemaInference.parseConfig

/** HEL-1385: multi-input per-op schema inference (lookup, union, join). */
private[engine] object MultiInputSchemaInference {

  /** lookup (HEL-386) — design.md Decision 7: additive, family-(b) best-effort
   *  typing (like `stringops`/`window`'s fallback case) rather than the
   *  identity-passthrough group `join`/`union` belong to. The reference
   *  source's schema isn't resolvable at this layer (no repo access, same
   *  limitation `union` already documents), so each name in `config.columns`
   *  is appended typed `string` (or the lane secondary's real type). A column
   *  colliding with an input field is appended as `right_<name>` (HEL-1250,
   *  shared `JoinColumnNaming` rule, same as the runtime), never replacing the
   *  input field; the duplicate key is dropped when sourceKey == lookupKey. No field-existence validation is
   *  performed on `sourceKey` — like `stringops`/`datebucket`, `lookup`
   *  accepts any field name and null-coerces at execute time — so this
   *  dedicated dispatch case never emits a false `validationError`. */
  private[engine] def inferLookup(
      config:          String,
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]] = None
  ): (Vector[SchemaField], Option[String]) =
    parseConfig("lookup", config) { json =>
      val columns = json.fields.get("columns").map(_.convertTo[Vector[String]]).getOrElse(Vector.empty[String])
      // HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3): when the secondary
      // input is `lane`-kind and its schema was resolved, type each requested column from
      // the REAL referenced-node field of the same name (both inputs, not the parent lane
      // alone). A requested column absent from the resolved secondary schema, or a
      // `source`-kind secondary input (unresolved -- no repo access), falls back to the
      // pre-existing documented "string" placeholder, unchanged.
      val secondaryTypes: Map[String, String] =
        secondarySchema.map(_.map(f => f.name -> f.`type`).toMap).getOrElse(Map.empty)
      // HEL-1250: same collision rule as the runtime `LookupStep` (shared `JoinColumnNaming`).
      // Types stay keyed by the ORIGINAL requested name, not the renamed one.
      val sourceKey = json.fields.get("sourceKey").collect { case JsString(v) => v }.getOrElse("")
      val lookupKey = json.fields.get("lookupKey").collect { case JsString(v) => v }.getOrElse("")
      val keyOpt    = if (sourceKey == lookupKey) Some(lookupKey) else None
      val requested = columns.distinct
      val mapping   = JoinColumnNaming.resolveWithKey(inputSchema.map(_.name), requested, keyOpt)
      inputSchema ++ requested.flatMap { col =>
        mapping.get(col).map(out => SchemaField(name = out, `type` = secondaryTypes.getOrElse(col, "string")))
      }
    } (inputSchema)

  /** union (HEL-384, design.md Decision 6) — HEL-911 (design.md Engine contract item 12,
   *  evaluation-1.md CR3): when the secondary input is `lane`-kind and its schema was
   *  resolved (`analyzeNodes`/`laneDependencyOf`), the projected schema is the UNION of
   *  both sides' field names (parent lane's own type wins on a name collision -- runtime
   *  row VALUES carry no notion of a "winning type" either, since `Map[String, Any]` values
   *  are untyped at execution; this is a schema-layer-only convention). For a `source`-kind
   *  secondary input (unresolved -- no repo access to a `DataSource`'s schema), this
   *  degrades to the pre-existing documented best-effort passthrough, unchanged. */
  private[engine] def inferUnion(
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]]
  ): (Vector[SchemaField], Option[String]) =
    secondarySchema match {
      case Some(secondary) =>
        val existingNames = inputSchema.map(_.name).toSet
        (inputSchema ++ secondary.filterNot(f => existingNames.contains(f.name)), None)
      case None => (inputSchema, None)
    }

  /** join — HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3): `join` had NO
   *  dispatch case at all before this ticket. When the secondary input's schema is resolved
   *  (`lane`-kind via the walk, or `source`-kind via `secondarySourceSchemas`, HEL-1236), the
   *  projected schema mirrors `JoinStep.evaluate`'s runtime row shape: every left field, then
   *  every surviving right field renamed per [[JoinColumnNaming]] (HEL-1236: a colliding right
   *  column becomes `right_<name>`, the duplicate join key is dropped -- the SAME rule the
   *  runtime applies, so analyze and run agree). When the secondary schema is unresolvable
   *  (e.g. a source with no inferred schema), this is the documented best-effort passthrough
   *  every other op in this file uses when it cannot see the second input. */
  private[engine] def inferJoin(
      config:          String,
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]]
  ): (Vector[SchemaField], Option[String]) =
    secondarySchema match {
      case Some(secondary) =>
        val joinKey = scala.util.Try(JoinConfig.decode(config).joinKey).getOrElse("")
        val mapping = JoinColumnNaming.resolve(inputSchema.map(_.name), secondary.map(_.name), joinKey)
        val right   = secondary.flatMap(f => mapping.get(f.name).map(n => f.copy(name = n)))
        (inputSchema ++ right, None)
      case None => (inputSchema, None)
    }
}
