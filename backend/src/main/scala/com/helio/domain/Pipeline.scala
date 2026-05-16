package com.helio.domain

import java.time.Instant

/** PipelineStep ADT (CS2c-3a).
 *
 *  Sealed-trait dispatch over the 10 step kinds. Each subtype carries its own
 *  typed config case class — the engine and Spark submitter pattern-match on
 *  the subtype rather than switching on a stringly-typed `op` field. The
 *  `kind` string is the persistence + wire discriminator (`pipeline_steps.op`
 *  column / `type` JSON field).
 *
 *  Wire shape (after CS2c-3a) is a discriminated union on `type`:
 *  {{{
 *    { "type": "filter", "id": "...", "pipelineId": "...", "position": 0,
 *      "config": { "combinator": "AND", "conditions": [...] }, ... }
 *  }}}
 *  DB shape is unchanged — `pipeline_steps.op` stays the discriminator column,
 *  `pipeline_steps.config` continues to store the typed config as JSON text.
 *  See [[PipelineStepKind]] for the kind-string constants used at the DB-row
 *  and wire boundaries. */
sealed trait PipelineStep {
  def id: PipelineStepId
  def pipelineId: PipelineId
  def position: Int
  def createdAt: Instant
  def updatedAt: Instant
  def kind: String
}

// ── Per-subtype config case classes ─────────────────────────────────────────
//
// Each *Config mirrors the JSON shape the engine accepts today. Optional
// fields here correspond to keys the engine treats as optional via
// `cfg.fields.get(...)` — keeping the optionality at the type level lets the
// protocol layer reject malformed configs at unmarshalling rather than at
// execution time.

final case class RenameConfig(renames: Map[String, String])
final case class FilterCondition(field: String, operator: String, value: Option[String])
final case class FilterConfig(combinator: String, conditions: Vector[FilterCondition])
final case class JoinConfig(rightDataSourceId: String, joinKey: String, joinType: String)
final case class ComputeConfig(column: String, expression: String, `type`: Option[String])
final case class GroupByConfig(groupBy: Vector[String], aggColumn: String, aggFunction: String)
final case class CastConfig(casts: Map[String, String])
final case class SelectConfig(fields: Vector[String])
final case class LimitConfig(count: Int)
final case class SortKey(field: String, direction: String)
final case class SortConfig(sortBy: Vector[SortKey])
final case class AggregateField(name: String, `type`: String)
final case class Aggregation(alias: String, fn: String, field: String)
final case class AggregateConfig(groupBy: Vector[AggregateField], aggregations: Vector[Aggregation])

// ── ADT subtypes ─────────────────────────────────────────────────────────────

final case class RenameStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: RenameConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Rename
}

final case class FilterStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: FilterConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Filter
}

final case class JoinStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: JoinConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Join
}

final case class ComputeStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: ComputeConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Compute
}

final case class GroupByStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: GroupByConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.GroupBy
}

final case class CastStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: CastConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Cast
}

final case class SelectStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: SelectConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Select
}

final case class LimitStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: LimitConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Limit
}

final case class SortStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: SortConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Sort
}

final case class AggregateStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: AggregateConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  override val kind: String = PipelineStepKind.Aggregate
}

/** Single source of truth for the pipeline step discriminator string. The DB
 *  `pipeline_steps.op` column and the wire `type` field both round-trip
 *  through these constants. `All` derives the allow-list previously
 *  hard-coded in `PipelineService.AllowedOps` (which had drifted — `aggregate`
 *  was missing from the service allow-list while accepted by the engine).
 *  After CS2c-3a no consumer enumerates these manually. */
object PipelineStepKind {
  val Rename: String    = "rename"
  val Filter: String    = "filter"
  val Join: String      = "join"
  val Compute: String   = "compute"
  val GroupBy: String   = "groupby"
  val Cast: String      = "cast"
  val Select: String    = "select"
  val Limit: String     = "limit"
  val Sort: String      = "sort"
  val Aggregate: String = "aggregate"

  val All: Set[String] = Set(Rename, Filter, Join, Compute, GroupBy, Cast, Select, Limit, Sort, Aggregate)

  def parseKind(s: String): Either[String, String] =
    if (All.contains(s)) Right(s)
    else Left(s"Unknown step op: '$s'. Valid values: ${All.toSeq.sorted.mkString(", ")}")
}
