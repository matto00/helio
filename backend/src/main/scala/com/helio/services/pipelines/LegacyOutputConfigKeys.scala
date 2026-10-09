package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import spray.json._

/** HEL-1409: the Scala mirror of migration V117's repair (HEL-1387, section 3's DO block in
 *  `V117__migrate_v94_dead_output_config_keys.sql`; the header table there documents the mapping).
 *
 *  Patch-set journals are point-in-time records and were deliberately not rewritten by V117, so a
 *  journal written before V117 can still hold the V94/HEL-877 dead Output config keys. Anything that
 *  writes a previously captured Output config back to storage runs it through [[normalise]] first, so
 *  the stored result equals what V117 would have produced from it.
 *
 *  This is the ONLY Scala statement of the mapping. `LegacyOutputConfigKeysParitySpec` runs V117's real
 *  DO block over a corpus and fails if this object and the SQL disagree -- change one, change both
 *  (and V117 is immutable, so in practice a mismatch means this object is wrong). Steps mirror the DO
 *  block in order: every dead key is judged on its ORIGINAL value, the shadow check sees the evolving
 *  result, a non-null live key is never overwritten. */
object LegacyOutputConfigKeys {

  /** The 14 keys, in V117's `all_keys` order (order matters: it decides which of two renames
   *  targeting the same live key wins -- they never do today, but the SQL order is the spec). */
  private val AllKeys = Vector(
    "metricLabel", "metricUnit", "chartAnnotation", "collectionOptions", "timelineOptions",
    "columnWidths", "tableDensity", "legend", "tooltip", "seriesColors", "axisLabels",
    "format", "columnOrder", "chartOptions")

  private val NoLiveEquivalent = Set("columnWidths", "tableDensity", "legend", "tooltip", "seriesColors", "axisLabels")

  /** Kinds that legitimately keep a dead-looking key (V117: `CONTINUE WHEN`). */
  private val KeptOnKinds: Map[String, Set[OutputKind]] = Map(
    "format"       -> Set[OutputKind](OutputKind.Metric, OutputKind.Collection),
    "columnOrder"  -> Set[OutputKind](OutputKind.Table),
    "chartOptions" -> Set[OutputKind](OutputKind.Chart)
  )

  /** key -> (kind it renames on, live key). */
  private val RenameSources: Map[String, (OutputKind, String)] = Map(
    "metricLabel"       -> ((OutputKind.Metric, "label")),
    "metricUnit"        -> ((OutputKind.Metric, "unit")),
    "chartAnnotation"   -> ((OutputKind.Chart, "annotation")),
    "collectionOptions" -> ((OutputKind.Collection, "layout")),
    "timelineOptions"   -> ((OutputKind.Timeline, "sort"))
  )

  private val StringKeys = Set("metricLabel", "metricUnit", "chartAnnotation")

  private def nestedValid(key: String, v: JsValue): Boolean = (key, v) match {
    case ("collectionOptions", JsString("grid" | "list")) => true
    case ("timelineOptions", JsString("asc" | "desc"))    => true
    case _                                                => false
  }

  /** The value to carry to the live key, or None when the dead key is simply dropped. */
  private def carried(key: String, kind: OutputKind, original: JsObject): Option[JsValue] = {
    val v = original.fields(key)
    RenameSources.get(key) match {
      case Some((renameKind, live)) if renameKind == kind && v != JsNull =>
        if (StringKeys.contains(key)) v match { case _: JsString => Some(v); case _ => None }
        else v match {
          case o: JsObject => o.fields.get(live).filter(nestedValid(key, _))
          case _           => None
        }
      case _ => None
    }
  }

  def normalise(kind: OutputKind, config: JsObject): JsObject =
    AllKeys.foldLeft(config) { (cfg, key) =>
      if (!config.fields.contains(key) || KeptOnKinds.get(key).exists(_.contains(kind))) cfg
      else {
        val removed = JsObject(cfg.fields - key)
        carried(key, kind, config) match {
          case Some(value) =>
            val live = RenameSources(key)._2
            // A non-null live key wins; an absent or JSON-null one is replaced.
            if (cfg.fields.get(live).exists(_ != JsNull)) removed else JsObject(removed.fields + (live -> value))
          case None => removed
        }
      }
    }
}
