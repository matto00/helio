package com.helio.domain.model

import com.helio.domain.engine.SchemaField

final case class TypeChangedColumn(name: String, previousType: String, currentType: String)

final case class SchemaDrift(
    addedColumns:       Vector[SchemaField],
    removedColumns:     Vector[SchemaField],
    typeChangedColumns: Vector[TypeChangedColumn]
)

/** Pure schema-drift diff (design D3). Compares a pipeline's baseline source
 *  schema (captured on the last successful, non-dry run) against its current
 *  source schema, reporting added / removed / type-changed columns.
 *
 *  Comparison is order-insensitive by column name; duplicate names within
 *  either side are collapsed to their positionally-last entry (mirrors the
 *  fold-left-overwrite semantics of building a `Map[String, String]` from a
 *  `Vector`, which matches how the schema round-trips through JSONB). */
object PipelineSchemaDrift {

  /** `baseline == None` (no prior successful run — first run) always yields
   *  `None`: there is nothing to compare against. Identical schemas (by name,
   *  order-insensitive) also yield `None` — "no drift" is the guaranteed
   *  steady-state for an unchanged source (design D1). Otherwise `Some(drift)`
   *  with `addedColumns`/`removedColumns` sorted by name for deterministic
   *  output. */
  def diff(baseline: Option[Vector[SchemaField]], current: Vector[SchemaField]): Option[SchemaDrift] =
    baseline match {
      case None => None
      case Some(baselineFields) =>
        val baselineByName = lastTypeByName(baselineFields)
        val currentByName  = lastTypeByName(current)

        val addedNames       = currentByName.keySet -- baselineByName.keySet
        val removedNames     = baselineByName.keySet -- currentByName.keySet
        val sharedNames      = baselineByName.keySet.intersect(currentByName.keySet)
        val typeChangedNames = sharedNames.filter(name => baselineByName(name) != currentByName(name))

        if (addedNames.isEmpty && removedNames.isEmpty && typeChangedNames.isEmpty) None
        else Some(SchemaDrift(
          addedColumns   = addedNames.toVector.sorted.map(name => SchemaField(name, currentByName(name))),
          removedColumns = removedNames.toVector.sorted.map(name => SchemaField(name, baselineByName(name))),
          typeChangedColumns = typeChangedNames.toVector.sorted.map(name =>
            TypeChangedColumn(name, previousType = baselineByName(name), currentType = currentByName(name))
          )
        ))
    }

  /** Collapses a schema to one type-string per column name, later entries
   *  overwriting earlier ones (positionally-last, per the class doc above). */
  private def lastTypeByName(fields: Vector[SchemaField]): Map[String, String] =
    fields.foldLeft(Map.empty[String, String]) { (acc, f) => acc + (f.name -> f.`type`) }
}
