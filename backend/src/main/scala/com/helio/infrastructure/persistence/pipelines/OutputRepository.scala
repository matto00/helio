package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.engine.SchemaField
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.domain.model._
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-904 (Outputs remodel) — persistence for `outputs`, replacing the
 *  `metrics`/`data_types` split. An Output is a panel-bindable projection of
 *  a single pipeline node ([[NodeRef]]), sharing-aware just like `pipelines`
 *  (V39 `helio_can_access_pipeline`) rather than owner-only like
 *  `pipeline_steps` (V35) — see design.md's RLS decision.
 *
 *  Additive-only at this task (1.5): the `outputs` table does not exist yet
 *  (lands in the V94 migration, task 2.3) — this repository is compiling
 *  scaffolding only until then. No caller wires it in yet. */
class OutputRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import OutputRepository._

  private val table = TableQuery[OutputTable]

  private def rowToDomain(row: OutputRow): Output =
    Output(
      id        = OutputId(row.id),
      name      = row.name,
      ownerId   = UserId(row.ownerId.toString),
      node      = NodeRef(PipelineId(row.pipelineId), row.nodeStepId.map(PipelineStepId(_))),
      kind      = OutputKind.fromString(row.kind).getOrElse(
        throw new IllegalStateException(s"OutputRepository: unknown output kind '${row.kind}' on row ${row.id}")
      ),
      createdAt = row.createdAt,
      updatedAt = row.updatedAt
    )

  private def domainToRow(output: Output, config: JsObject, schema: Vector[SchemaField], position: Int, tag: Option[String]): OutputRow =
    OutputRow(
      id         = output.id.value,
      pipelineId = output.node.pipelineId.value,
      nodeStepId = output.node.stepId.map(_.value),
      ownerId    = UUID.fromString(output.ownerId.value),
      name       = output.name,
      kind       = OutputKind.asString(output.kind),
      config     = config,
      schema     = schema,
      position   = position,
      tag        = tag,
      createdAt  = output.createdAt,
      updatedAt  = output.updatedAt
    )

  /** ACL-bypassing list of every Output attached to a pipeline node, in
   *  `position` order. Sharing-aware access must be confirmed by the caller
   *  (mirrors `PipelineStepRepository.listByPipelineInternal`'s contract). */
  def listByNodeInternal(pipelineId: PipelineId, nodeStepId: Option[PipelineStepId]): Future[Vector[Output]] = {
    val filtered = nodeStepId match {
      case Some(stepId) => table.filter(r => r.pipelineId === pipelineId.value && r.nodeStepId === Option(stepId.value))
      case None         => table.filter(r => r.pipelineId === pipelineId.value && r.nodeStepId.isEmpty)
    }
    ctx.withSystemContext(filtered.sortBy(_.position).result).map(_.toVector.map(rowToDomain))
  }

  /** ACL-bypassing list of every Output on a pipeline, across all nodes,
   *  in `position` order. */
  def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[Output]] =
    ctx.withSystemContext(
      table.filter(_.pipelineId === pipelineId.value).sortBy(_.position).result
    ).map(_.toVector.map(rowToDomain))

  def findByIdInternal(id: OutputId): Future[Option[Output]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption).map(_.map(rowToDomain))

  /** Owner-scoped read (not merely sharing-aware) — used by
   *  `AlertRuleService.create` (task 3.1) to validate a rule's
   *  `targetOutputId` before persisting, mirroring the strict
   *  `r.ownerId === ownerUuid` app-level filter every other
   *  `findByIdOwned` in this codebase applies (e.g.
   *  `DataTypeRepository.findByIdOwned`, which this replaces). Deliberately
   *  NOT relying on `outputs`' sharing-aware RLS policy alone (which would
   *  admit a non-owner grantee too) — creating an alert rule against an
   *  Output is an owner-level action, matching this migration's predecessor
   *  behavior exactly (existence-not-leaked either way, CONTRIBUTING.md's
   *  ACL triad). `ctx.withUserContext` is still used for the privileged-pool
   *  discipline this file's other methods share, not for the ACL check
   *  itself. */
  def findByIdOwned(id: OutputId, user: AuthenticatedUser): Future[Option[Output]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  /** ACL-bypassing insert. Safe to call only after the caller's pipeline
   *  access has been confirmed by the service layer (mirrors
   *  `PipelineStepRepository.insertInternal`'s contract). */
  def insertInternal(
      pipelineId: PipelineId,
      nodeStepId: Option[PipelineStepId],
      ownerId: UserId,
      name: String,
      kind: OutputKind,
      config: JsObject = JsObject.empty,
      schema: Vector[SchemaField] = Vector.empty,
      tag: Option[String] = None
  ): Future[Output] = {
    val now = Instant.now()
    val id  = OutputId(UUID.randomUUID().toString)
    val action = for {
      maxPos <- table.filter(_.pipelineId === pipelineId.value).map(_.position).max.result
      position = maxPos.map(_ + 1).getOrElse(0)
      output   = Output(id, name, ownerId, NodeRef(pipelineId, nodeStepId), kind, now, now)
      row      = domainToRow(output, config, schema, position, tag)
      _       <- table += row
    } yield output
    ctx.withSystemContext(action.transactionally)
  }

  /** ACL-bypassing delete. Safe to call only after the caller's pipeline
   *  access has been confirmed by the service layer. */
  def deleteInternal(id: OutputId): Future[Boolean] =
    ctx.withSystemContext(table.filter(_.id === id.value).delete).map(_ > 0)

  /** ACL-bypassing bulk delete of every Output attached to a node — the
   *  cascade companion to `PipelineStepRepository`'s splice-on-delete
   *  (task 1.6/1.7): deleting a tail step deletes its Outputs too. */
  def deleteByNodeInternal(pipelineId: PipelineId, nodeStepId: PipelineStepId): Future[Int] =
    ctx.withSystemContext(
      table.filter(r => r.pipelineId === pipelineId.value && r.nodeStepId === Option(nodeStepId.value)).delete
    )
}

object OutputRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  implicit val jsObjectColumnType: BaseColumnType[JsObject] =
    MappedColumnType.base[JsObject, String](
      _.compactPrint,
      _.parseJson.asJsObject
    )

  implicit val schemaFieldsColumnType: BaseColumnType[Vector[SchemaField]] =
    MappedColumnType.base[Vector[SchemaField], String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[Vector[SchemaField]]
    )

  case class OutputRow(
      id: String,
      pipelineId: String,
      nodeStepId: Option[String],
      ownerId: UUID,
      name: String,
      kind: String,
      config: JsObject,
      schema: Vector[SchemaField],
      position: Int,
      tag: Option[String],
      createdAt: Instant,
      updatedAt: Instant
  )

  class OutputTable(tag: Tag) extends Table[OutputRow](tag, "outputs") {
    def id         = column[String]("id", O.PrimaryKey)
    def pipelineId = column[String]("pipeline_id")
    def nodeStepId = column[Option[String]]("node_step_id")
    def ownerId    = column[UUID]("owner_id")
    def name       = column[String]("name")
    def kind       = column[String]("kind")
    def config     = column[JsObject]("config")
    def schema     = column[Vector[SchemaField]]("schema")
    def position   = column[Int]("position")
    def rowTag     = column[Option[String]]("tag")
    def createdAt  = column[Instant]("created_at")
    def updatedAt  = column[Instant]("updated_at")

    def * = (id, pipelineId, nodeStepId, ownerId, name, kind, config, schema, position, rowTag, createdAt, updatedAt).mapTo[OutputRow]
  }
}
