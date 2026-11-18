package com.helio.infrastructure.ai

import org.slf4j.LoggerFactory

import scala.util.Try

/** One catalog model (HEL-1755 D1). Only [[ClaudeModelCatalog]] can build one, so a raw client string can never
 *  reach the wire: the id sent to the API is always a catalog entry's own `id`. */
final class ClaudeModelSpec private[ai] (val id: String, val label: String, val betaWeight: Int) {
  override def equals(other: Any): Boolean = other match {
    case o: ClaudeModelSpec => o.id == id
    case _                  => false
  }
  override def hashCode: Int  = id.hashCode
  override def toString: String = s"ClaudeModelSpec($id)"
}

/** The one shared home of the selectable Claude models, their display labels, their beta cost weights and the
 *  per-model request rules (HEL-1755 D1/C17). Assistant chat reads it now; the insight leaves must read it
 *  rather than define their own allow-list.
 *
 *  '''Request rules, constant for EVERY catalog model (platform.claude.com, fetched 2026-11-17):'''
 *  never send `temperature`, `top_p` or `top_k` (at any value), never send `thinking.type = "enabled"` or
 *  `budget_tokens` (adaptive thinking is the API default and is left alone), and NEVER send a forced
 *  `tool_choice` (`any` or `tool`) -- Opus 5.5 and Sonnet 5.5 reject it with a 400, and Haiku 5.5 would accept
 *  it but then returns no thinking block, so the rule is uniform instead of per-model. These are not
 *  per-model flags on purpose: nothing here is permission to do any of them. `ClaudeClient` enforces them for
 *  every request whose effective model is a catalog model.
 *
 *  '''Selectable vs catalog-defined.''' The catalog defines three models. `CLAUDE_SELECTABLE_MODELS` may narrow
 *  which of them a caller may pick; it can never add one. A model that is catalog-defined but no longer
 *  selectable (for example the server default) keeps its rules and weight. */
final class ClaudeModelCatalog private (val selectable: Vector[ClaudeModelSpec], weights: Map[String, Int]) {

  /** The spec of a catalog-DEFINED id (selectable or not), `None` for any other id. Used so a catalog model that was
   *  narrowed out of the picker (e.g. the server default) still gets the catalog request rules. */
  def definition(id: String): Option[ClaudeModelSpec] = ClaudeModelCatalog.definitions.find(_.id == id)

  /** The caller-pickable spec for `id`; `None` for anything outside the (narrowed) allow-list. */
  def select(id: String): Option[ClaudeModelSpec] = selectable.find(_.id == id)

  def isSelectable(id: String): Boolean = select(id).isDefined

  /** Beta cost weight for `id`: the (env-overridden) catalog weight, 1 for a model the catalog does not define. */
  def weightOf(id: String): Int =
    ClaudeModelCatalog.definitions.find(_.id == id).map(spec => weights.getOrElse(id, spec.betaWeight)).getOrElse(1)

  /** The label of a catalog-defined id, else `None`. */
  def labelOf(id: String): Option[String] = ClaudeModelCatalog.definitions.find(_.id == id).map(_.label)
}

object ClaudeModelCatalog {
  val HaikuId: String  = "claude-haiku-5-5"
  val SonnetId: String = "claude-sonnet-5-5"
  val OpusId: String   = "claude-opus-5-5"

  private val SelectableEnv = "CLAUDE_SELECTABLE_MODELS"
  private val WeightsEnv    = "HELIO_BETA_MODEL_WEIGHTS"

  private val log = LoggerFactory.getLogger(getClass)

  /** Every model the catalog defines, in picker order, with its default beta weight (owner ruling: 1 / 4 / 8). */
  private[ai] val definitions: Vector[ClaudeModelSpec] = Vector(
    new ClaudeModelSpec(HaikuId, "Haiku 5.5", 1),
    new ClaudeModelSpec(SonnetId, "Sonnet 5.5", 4),
    new ClaudeModelSpec(OpusId, "Opus 5.5", 8)
  )

  /** `true` for any id the catalog defines, selectable or not: the request rules apply to it. */
  def isCatalogId(id: String): Boolean = definitions.exists(_.id == id)

  /** All three models selectable, default weights. */
  def all: ClaudeModelCatalog = fromEnv(Map.empty)

  /** Reads `CLAUDE_SELECTABLE_MODELS` (comma list; unknown ids WARN and are ignored; unset, empty or no valid id =
   *  all three) and `HELIO_BETA_MODEL_WEIGHTS` (`id=n,...`; a malformed entry, an unknown id or `n < 1` WARNs and
   *  keeps that model's default). */
  def fromEnv(env: Map[String, String] = sys.env): ClaudeModelCatalog = {
    val requested = env.get(SelectableEnv).toVector.flatMap(_.split(",").toVector).map(_.trim).filter(_.nonEmpty)
    val valid     = requested.filter(isCatalogId)
    requested.filterNot(isCatalogId).foreach(id => log.warn(s"$SelectableEnv names '$id', which is not a catalog model; ignored"))
    val selectable =
      if (valid.isEmpty) definitions
      else definitions.filter(d => valid.contains(d.id))
    new ClaudeModelCatalog(selectable, parseWeights(env.get(WeightsEnv)))
  }

  private def parseWeights(raw: Option[String]): Map[String, Int] =
    raw.toVector.flatMap(_.split(",").toVector).map(_.trim).filter(_.nonEmpty).flatMap { entry =>
      entry.split("=", 2).map(_.trim) match {
        case Array(id, n) if isCatalogId(id) =>
          Try(n.toInt).toOption.filter(_ >= 1) match {
            case Some(weight) => Some(id -> weight)
            case None =>
              log.warn(s"$WeightsEnv entry '$entry' has no integer weight >= 1; keeping the default for $id")
              None
          }
        case _ =>
          log.warn(s"$WeightsEnv entry '$entry' is malformed or names no catalog model; ignored")
          None
      }
    }.toMap
}
