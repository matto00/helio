package com.helio.services.pipelines

import com.helio.domain.engine.PipelineAnalyzeService
import spray.json._

import scala.util.Try

/** HEL-1639 D3/D4: what an AUTHORED step (an assistant or MCP proposal) must carry, beyond the shape checks every write
 *  already makes. A step saved from the editor may legitimately be a half-filled draft (empty `select`, `sort` with no
 *  keys), so these stay out of the shared write path; a proposal is meant to apply and run, so it must be complete.
 *
 *  [[RequiredKeys]] is the single list both this check and the assistant tool schemas' `required` read, so the schema
 *  cannot promise less than the check enforces; `AssistantStepSchemasSpec` also proves that removing any listed key from the
 *  per-op example makes [[problem]] report it. */
object ProposalStepRules {

  /** The config keys a proposal step of each op must supply, non-empty. Ops absent from the map need no key. */
  val RequiredKeys: Map[String, Vector[String]] = Map(
    "lookup"    -> Vector("secondaryInput", "sourceKey", "lookupKey"),
    "compute"   -> Vector("column", "expression"),
    "aggregate" -> Vector("aggregations"),
    "select"    -> Vector("fields"),
    "cast"      -> Vector("casts"),
    "rename"    -> Vector("renames"),
    "sort"      -> Vector("sortBy"),
    "filter"    -> Vector("conditions"),
    "limit"     -> Vector("count"),
    "join"      -> Vector("secondaryInput"),
    "union"     -> Vector("secondaryInput")
  )

  /** `None` when the step's config is complete; otherwise ONE message naming every missing key and, when the config is
   *  present but invalid, the registry's own problems (declared required keys plus the per-kind validators). */
  def problem(op: String, rawConfig: String): Option[String] = {
    val registry = PipelineAnalyzeService.stepConfigProblem(op, rawConfig)
    val missing = Try(rawConfig.parseJson).toOption.collect { case o: JsObject => o }.toVector.flatMap { config =>
      RequiredKeys.getOrElse(op, Vector.empty).filter(key => isEmpty(op, key, config.fields.get(key)))
    }
    val missingMessage = Option.when(missing.nonEmpty)(s"missing required config ${if (missing.size > 1) "keys" else "key"} ${missing.map(k => s"'$k'").mkString(", ")}")
    (missingMessage.toVector ++ registry.toVector) match {
      case Vector() => None
      case parts    => Some(parts.mkString("; "))
    }
  }

  private def isEmpty(op: String, key: String, value: Option[JsValue]): Boolean = value match {
    case None | Some(JsNull)         => true
    case Some(JsString(s))           => s.trim.isEmpty
    case Some(JsArray(items))        => items.isEmpty
    case Some(JsObject(fields)) if key == "secondaryInput" =>
      // An unset second input is `{kind:"source", dataSourceId:""}` (or a lane with no stepId).
      fields.get("dataSourceId").orElse(fields.get("stepId")).forall { case JsString(s) => s.trim.isEmpty; case _ => false }
    case Some(JsObject(fields))      => fields.isEmpty
    case Some(JsNumber(n))           => key == "count" && n <= 0
    case Some(_)                     => false
  }
}
