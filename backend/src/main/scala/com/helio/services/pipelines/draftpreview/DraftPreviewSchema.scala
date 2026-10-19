package com.helio.services.pipelines.draftpreview

import com.helio.api.protocols.pipelines.DraftPreviewLine.DraftPreviewColumn
import com.helio.domain.engine.PipelineRowJson.Row

import scala.collection.mutable

/** HEL-1630 design.md D1: the column list of a `step` line, in first-seen order. A column's type is the one class of
 *  non-null value it holds, `null` if every value is null, and `mixed` if the values disagree. */
object DraftPreviewSchema {

  private def typeName(v: Any): String = v match {
    case null       => "null"
    case _: Int     => "int"
    case _: Long    => "long"
    case _: Double  => "double"
    case _: String  => "string"
    case _: Boolean => "boolean"
    case _          => "mixed"
  }

  def of(rows: Seq[Row]): Vector[DraftPreviewColumn] = {
    val types = mutable.LinkedHashMap.empty[String, String]
    rows.foreach(_.foreach { case (name, value) =>
      val seen = typeName(value)
      types.get(name) match {
        case None                                         => types(name) = seen
        case Some("null")                                 => types(name) = seen
        case Some(cur) if seen == "null" || seen == cur   => ()
        case Some(_)                                      => types(name) = "mixed"
      }
    })
    types.iterator.map { case (name, t) => DraftPreviewColumn(name, t) }.toVector
  }
}
