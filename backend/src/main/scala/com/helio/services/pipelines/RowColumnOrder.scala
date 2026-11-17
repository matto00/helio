package com.helio.services.pipelines

import spray.json.{JsObject, JsValue}

import scala.collection.immutable.VectorMap

/** HEL-1705 H: the one rule that orders a stored row's keys on every rows read path. `node_snapshots.data` and
 *  `node_payload_history.rows` are JSONB and spray-json parses an object into a `TreeMap`, so a parsed row's keys are
 *  alphabetical, never the Output's order. A row is rewritten as a `VectorMap`-backed `JsObject` (which `compactPrint`
 *  iterates in insertion order): the Output's schema names the row has, then every other key in ascending code-point order.
 *  `columns` follows the same rule over a whole page. */
object RowColumnOrder {

  /** String order is UTF-16 code unit order in Scala; the client compares the same way, so the two never disagree. */
  private val codePointOrder: Ordering[String] = Ordering.String

  def orderRow(schemaNames: Vector[String], row: JsObject): JsObject = {
    val fields = row.fields
    val inSchema: Vector[(String, JsValue)] = schemaNames.distinct.flatMap(n => fields.get(n).map(n -> _))
    val named = schemaNames.toSet
    val extras = fields.keys.filterNot(named.contains).toVector.sorted(codePointOrder).map(k => k -> fields(k))
    JsObject(VectorMap((inSchema ++ extras): _*))
  }

  /** The schema names present in at least one row (every schema name when there are no rows), then the other keys seen. */
  def columns(schemaNames: Vector[String], rows: Iterable[JsObject]): Vector[String] =
    if (rows.isEmpty) schemaNames.distinct
    else {
      val seen = rows.iterator.flatMap(_.fields.keysIterator).toSet
      val named = schemaNames.toSet
      schemaNames.distinct.filter(seen.contains) ++ seen.filterNot(named.contains).toVector.sorted(codePointOrder)
    }

  def order(schemaNames: Vector[String], rows: Vector[JsObject]): (Vector[JsObject], Vector[String]) =
    (rows.map(orderRow(schemaNames, _)), columns(schemaNames, rows))
}
