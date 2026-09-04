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
      node      = NodeRef(PipelineId(row.pipelineId), row.nodeStepId.map(PipelineStepId(_)), row.rootId.map(PipelineRootId(_))),
      kind      = OutputKind.fromString(row.kind).getOrElse(
        throw new IllegalStateException(s"OutputRepository: unknown output kind '${row.kind}' on row ${row.id}")
      ),
      createdAt = row.createdAt,
      updatedAt = row.updatedAt,
      schema    = row.schema
    )

  private def domainToRow(output: Output, config: JsObject, schema: Vector[SchemaField], position: Int, tag: Option[String], rootId: Option[String] = None): OutputRow =
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
      updatedAt  = output.updatedAt,
      rootId     = rootId
    )

  /** HEL-913: resolves the LOWEST-POSITIONED root of `pipelineId`, mirroring
   *  `PipelineStepRepository.firstRootIdAction` -- the single-root-compatible anchor a
   *  root-bound (`nodeStepId = None`) Output insert must set as `root_id`, or V98's CHECK
   *  constraint aborts the write.
   *
   *  Reached (via `insertInternal`/`insertInternalAction`'s `(nodeStepId, explicitRootId)` match,
   *  the `(None, None)` arm) ONLY when a caller passes `explicitRootId = None` for a root-bound
   *  Output. This is checkable as an ENUMERATION of every caller, not a trust-me claim
   *  (evaluation-2.md, Rule B): there are exactly three, and each is safe by a DIFFERENT
   *  mechanism --
   *    1. `OutputService.create` -- `requireUnambiguousRootWhenNeither` refuses a multi-root
   *       pipeline with a named 400 BEFORE `resolveExplicitRootId` can return `None`, so this arm
   *       is reached only when the pipeline genuinely has exactly one root.
   *    2. `PipelineService.buildOutputsAction` (`:617`) -- `resolveOutputRootIndex`'s `None`
   *       branch (root-bound, no `rootClientId`) returns `Left(400)` when `roots.size > 1` and
   *       `Right(Some(0))` otherwise; a step-bound Output (`nodeStepClientId` defined) always
   *       carries a non-`None` `nodeStepId`, which takes the `(Some(_), _) => None` root arm
   *       regardless of `explicitRootId`. Either way this method is unreached with more than one
   *       root live.
   *    3. `DemoData` (`:59`) -- passes `explicitRootId = Some(demoRootId)` explicitly, a NAMED-root
   *       caller that never reaches this arm at all; also structurally single-root regardless
   *       (`pipelineRepo.create("Demo Pipeline", Vector(source.id), ...)`, a hard-coded
   *       one-element vector at boot).
   *  The claim "the set of callers that can reach this with more than one root is empty" is what
   *  is asserted here, not "the caller is responsible" -- if a FOURTH caller is ever added, it
   *  must be added to this enumeration or this comment goes stale the same way the deleted
   *  `OutputService` precondition did. */
  private def firstRootIdAction(pipelineId: String): DBIO[String] =
    TableQuery[PipelineRootRepository.PipelineRootTable]
      .filter(_.pipelineId === pipelineId)
      .sortBy(_.position)
      .map(_.id)
      .result
      .head

  // HEL-913 task 5.8b-iv: `listByNodeInternal` DELETED outright, not merely fixed -- it had ZERO
  // callers anywhere in `src/main` or `src/test` (confirmed via `grep -rn "listByNodeInternal("`,
  // the exact "provably unreachable -> delete the arm" case task 5.8b-iv names, generalized to
  // the whole never-called method rather than leaving a landmine `(None, None)` fallback behind
  // for a caller that does not exist). If a future caller needs this, it should be added back
  // WITH a required `explicitRootId`, not with this method's old defaulted-fallback shape.

  /** ACL-bypassing list of every Output on a pipeline, across all nodes,
   *  in `position` order. */
  def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[Output]] =
    ctx.withSystemContext(
      table.filter(_.pipelineId === pipelineId.value).sortBy(_.position).result
    ).map(_.toVector.map(rowToDomain))

  /** Owner-scoped, paged listing of every Output the caller owns, across all
   *  their pipelines — the Output-model replacement for
   *  `DataTypeRepository.findAll` (HEL-904 task 3.12), used by
   *  `WorkspaceContextService.assemble`'s top-level `dataTypes` fan-out.
   *  Mirrors `DataTypeRepository.findAll`'s exact owner-scoping/paging shape
   *  (`withUserContext`, `sortBy(_.createdAt.desc)`, `PagedResult`) — no
   *  `tag` filter param, since the domain `Output` case class does not
   *  surface a `tag` field (the DB column exists but is not yet read out;
   *  left for a later cycle if tag-scoped Output listing is ever needed). */
  def findAllByOwner(ownerId: UserId, page: Page): Future[PagedResult[Output]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    val baseQuery = table.filter(_.ownerId === ownerUuid)
    val countAction = baseQuery.length.result
    val sliceAction = baseQuery.sortBy(_.createdAt.desc).drop(page.offset).take(page.limit).result
    ctx.withUserContext(ownerId.value)(
      for {
        total <- countAction
        rows  <- sliceAction
      } yield PagedResult(rows.map(rowToDomain).toVector, total, page.offset, page.limit)
    )
  }

  def findByIdInternal(id: OutputId): Future[Option[Output]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption).map(_.map(rowToDomain))

  /** Sharing-aware read (HEL-906): relies entirely on the `outputs_select`
   *  RLS policy (`helio_can_access_pipeline`, V94) rather than an app-level
   *  filter — a cross-tenant caller's query simply returns zero rows, giving
   *  the existence-not-leaked 404 semantics CONTRIBUTING.md's ACL triad
   *  requires without duplicating the sharing predicate in Scala. */
  def findById(id: OutputId, user: AuthenticatedUser): Future[Option[Output]] =
    ctx.withUserContext(user.id.value)(table.filter(_.id === id.value).result.headOption).map(_.map(rowToDomain))

  /** Read the raw `config`/`tag` columns alongside the domain object — the
   *  domain `Output` case class doesn't carry `config` (it's a
   *  route/service-layer concern, mirroring `PanelConfigCodec`'s per-subtype
   *  split), so callers that need to patch-merge `config` (task 2.3a) read
   *  it here rather than adding a field to the shared domain model. */
  def findConfigById(id: OutputId, user: AuthenticatedUser): Future[Option[JsObject]] =
    ctx.withUserContext(user.id.value)(table.filter(_.id === id.value).map(_.config).result.headOption)

  /** Batch read of `config` for a set of Output ids — ONE query, not an
   *  N+1 per row (HEL-946: `GET /api/pipelines/:id/outputs`,
   *  `GET /api/outputs` list, and the create response all need each
   *  Output's real config, and this codebase already took an N+1
   *  placement-count outage on this exact release, HEL-909 — do not repeat
   *  that shape here). ACL-bypassing: safe only after the caller has
   *  already scoped/authorized the id set (mirrors `insertInternal`'s
   *  contract) — both call sites (`listByPipelineInternal`,
   *  `findAllByOwner`) already ACL/owner-scope the ids before this runs. */
  def findConfigsByIdsInternal(ids: Vector[String]): Future[Map[String, JsObject]] =
    if (ids.isEmpty) Future.successful(Map.empty)
    else
      ctx.withSystemContext(
        table.filter(_.id.inSet(ids)).map(r => (r.id, r.config)).result
      ).map(_.toMap)

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
      tag: Option[String] = None,
      // HEL-913 task 5.8a: names WHICH root a root-bound (`nodeStepId = None`) Output attaches
      // to. Defaulted to `None` (auto-resolve the pipeline's first/only root, exactly the
      // Stage-1/2 single-root-compatible behavior) so every pre-existing call site is
      // unaffected; the service layer passes it explicitly once a caller can name a root.
      explicitRootId: Option[PipelineRootId]
  ): Future[Output] =
    ctx.withSystemContext(insertInternalAction(pipelineId, nodeStepId, ownerId, name, kind, config, schema, tag, explicitRootId).transactionally)

  /** DBIO variant of `insertInternal` above -- extracted (HEL-906 task 3.1, coordinator ruling
   *  D3) so `PipelineService`'s single-call transactional pipeline-creation path can compose this
   *  Output insert into the SAME database transaction as the pipeline row and every step insert,
   *  via `PipelineRepository.runTransactionally`. Public for that cross-repository composition;
   *  same "safe only after pipeline access confirmed" contract as `insertInternal`. */
  def insertInternalAction(
      pipelineId: PipelineId,
      nodeStepId: Option[PipelineStepId],
      ownerId: UserId,
      name: String,
      kind: OutputKind,
      config: JsObject = JsObject.empty,
      schema: Vector[SchemaField] = Vector.empty,
      tag: Option[String] = None,
      explicitRootId: Option[PipelineRootId]
  ): DBIO[Output] = {
    val now = Instant.now()
    val id  = OutputId(UUID.randomUUID().toString)
    for {
      maxPos <- table.filter(_.pipelineId === pipelineId.value).map(_.position).max.result
      position = maxPos.map(_ + 1).getOrElse(0)
      // HEL-913: a root-bound (`nodeStepId = None`) Output needs `root_id` (V98 CHECK); a
      // node-bound Output must NOT carry one (same CHECK is `<>`, not `=>`). `explicitRootId`
      // (task 5.8a), when given, is used AS-IS (the service layer already validated it belongs
      // to this pipeline) instead of auto-resolving the first root.
      rootIdOpt <- (nodeStepId, explicitRootId) match {
        case (None, Some(rid)) => DBIO.successful(Some(rid.value))
        case (None, None)      => firstRootIdAction(pipelineId.value).map(Some(_))
        case (Some(_), _)      => DBIO.successful(None)
      }
      nodeRefRootId = if (nodeStepId.isDefined) None else rootIdOpt.map(PipelineRootId(_))
      output   = Output(id, name, ownerId, NodeRef(pipelineId, nodeStepId, nodeRefRootId), kind, now, now, schema)
      row      = domainToRow(output, config, schema, position, tag, rootIdOpt)
      _       <- table += row
    } yield output
  }

  /** ACL-bypassing schema update -- used by tests (and any future re-analyze path) to update an
   *  Output's derived `{name, type}` schema after creation, mirroring `DataTypeRepository`'s
   *  `update`'s ability to replace `fields` post-creation. */
  def updateSchemaInternal(id: OutputId, schema: Vector[SchemaField]): Future[Unit] =
    ctx.withSystemContext(table.filter(_.id === id.value).map(_.schema).update(schema)).map(_ => ())

  /** Owner-scoped update of `name`/`config` (HEL-906 task 2.3a). Relies on the
   *  `outputs_update` RLS policy (owner-only, V94) for enforcement; the
   *  `withUserContext` call here is the privileged-pool discipline this
   *  file's other methods share, not the ACL check itself. Returns the
   *  updated `Output` (via `findById`) or `None` when the row doesn't exist
   *  or isn't owned by `user` (RLS silently updates zero rows). */
  def updateOwned(id: OutputId, user: AuthenticatedUser, name: Option[String], config: Option[JsObject]): Future[Option[Output]] = {
    val now = Instant.now()
    val nameAction   = name.map(n => table.filter(_.id === id.value).map(r => (r.name, r.updatedAt)).update((n, now)))
    val configAction = config.map(c => table.filter(_.id === id.value).map(r => (r.config, r.updatedAt)).update((c, now)))
    val combined: DBIO[Int] = (nameAction.toList ++ configAction.toList) match {
      case Nil        => DBIO.successful(0)
      case one :: Nil  => one
      case many        => DBIO.sequence(many).map(_.sum)
    }
    // A `no fields to update` call (both `name`/`config` absent) issues no UPDATE at all, so
    // `rowsAffected == 0` there is expected and NOT itself a sign of an RLS-blocked write --
    // existence/ownership has to be checked explicitly in that branch instead (evaluation-1.md
    // non-blocking suggestion: an empty-body PATCH must still 404 for a non-owner grantee, not
    // silently 200 via the sharing-aware `findById` a grantee's own read access would satisfy).
    // Otherwise (some field WAS attempted), `rowsAffected == 0` means the `outputs_update` RLS
    // policy (owner-only, V94) silently dropped the write for a non-owner caller -- returning
    // `None` there is what makes that 404, not a no-op-that-looks-like-success (the "RLS
    // silently no-ops instead of erroring" trap CONTRIBUTING.md's ACL triad warns about).
    ctx.withUserContext(user.id.value)(combined.transactionally).flatMap { rowsAffected =>
      if (rowsAffected > 0) findById(id, user)
      else if (name.isEmpty && config.isEmpty) findByOwned(id, user)
      else Future.successful(None)
    }
  }

  /** Owner-checked read used only by `updateOwned`'s no-op (empty-body PATCH) branch above --
   *  `findById` alone is sharing-aware and would let a non-owner editor grantee's empty PATCH
   *  return 200, which breaks the owner-only contract this whole method exists to enforce. */
  private def findByOwned(id: OutputId, user: AuthenticatedUser): Future[Option[Output]] =
    findById(id, user).map(_.filter(_.ownerId == user.id))

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
      updatedAt: Instant,
      // HEL-913: DB-column-only for this stage, exactly like `PipelineStepRow.rootId` --
      // V98's CHECK ((node_step_id IS NULL) <> (root_id IS NULL)) requires every root-bound
      // (node_step_id = None) row to carry it. The full R12 encoding generalization (NodeKey-
      // keyed reads/writes) is engine-stage work (design.md, tasks.md 5.8/5.8a); this field only
      // keeps every EXISTING write path from violating the new CHECK.
      rootId: Option[String] = None
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
    def rootId     = column[Option[String]]("root_id")

    def * = (id, pipelineId, nodeStepId, ownerId, name, kind, config, schema, position, rowTag, createdAt, updatedAt, rootId).mapTo[OutputRow]
  }
}
