package com.helio.infrastructure

import com.helio.api.protocols.DataTypeProtocol
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DataTypeRepository(ctx: DbContext)(implicit ec: ExecutionContext)
    extends DataTypeProtocol {

  import DataTypeRepository._

  private val table = TableQuery[DataTypeTable]

  private def rowToDomain(row: DataTypeRow): DataType =
    DataType(
      id             = DataTypeId(row.id),
      sourceId       = row.sourceId.map(DataSourceId(_)),
      name           = row.name,
      fields         = row.fields,
      computedFields = row.computedFields,
      version        = row.version,
      createdAt      = row.createdAt,
      updatedAt      = row.updatedAt,
      ownerId        = row.ownerId.map(id => UserId(id.toString)).getOrElse(UserId("00000000-0000-0000-0000-000000000000"))
    )

  private def domainToRow(dt: DataType): DataTypeRow =
    DataTypeRow(
      id             = dt.id.value,
      sourceId       = dt.sourceId.map(_.value),
      name           = dt.name,
      fields         = dt.fields,
      computedFields = dt.computedFields,
      version        = dt.version,
      createdAt      = dt.createdAt,
      updatedAt      = dt.updatedAt,
      ownerId        = if (dt.ownerId.value.isEmpty) None else Some(UUID.fromString(dt.ownerId.value))
    )

  def findAll(ownerId: UserId): Future[Vector[DataType]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    ctx.withUserContext(ownerId.value)(
      table.filter(_.ownerId === ownerUuid).sortBy(_.createdAt.desc).result
    ).map(_.map(rowToDomain).toVector)
  }

  def findBySourceId(id: DataSourceId, ownerId: UserId): Future[Vector[DataType]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    ctx.withUserContext(ownerId.value)(
      table.filter(r => r.sourceId === id.value && r.ownerId === ownerUuid).result
    ).map(_.map(rowToDomain).toVector)
  }

  /** Privileged unscoped read — no ACL check.
   *
   *  Permitted callers:
   *  - `ResourceTypeRegistry` resolver (resolves owner FOR the ACL check)
   *  - `PipelineRunService.upsertFieldsFromRows` (background privileged path) */
  def findByIdInternal(id: DataTypeId): Future[Option[DataType]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  /** Owner-scoped findById — collapses the former 2-arg overload.
   *
   *  Returns `None` if the type exists but belongs to a different user
   *  (existence and authorization are indistinguishable at the API surface). */
  def findByIdOwned(id: DataTypeId, user: AuthenticatedUser): Future[Option[DataType]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  /** Batch owner-scoped lookup -- fetches all types in ids owned by user
   *  in a single WHERE id IN (...) AND owner_id = ? query.
   *
   *  Returns a Map[DataTypeId, DataType] for O(1) per-panel resolution.
   *  Short-circuits immediately with an empty Map when ids is empty. */
  def findByIdsOwned(ids: Seq[DataTypeId], user: AuthenticatedUser): Future[Map[DataTypeId, DataType]] =
    if (ids.isEmpty) Future.successful(Map.empty)
    else {
      val idSet     = ids.map(_.value).toSet
      val ownerUuid = UUID.fromString(user.id.value)
      ctx.withUserContext(user.id.value)(
        table.filter(r => (r.id inSet idSet) && r.ownerId === ownerUuid).result
      ).map(_.map(rowToDomain).map(dt => dt.id -> dt).toMap)
    }

  /** Insert a new data type row in user context.
   *
   *  The V35 RLS policy on `data_types` evaluates `owner_id` against
   *  `app.current_user_id`. The row's `ownerId` must equal `user.id` — callers
   *  are responsible for building the `DataType` with the correct `ownerId`. */
  def insert(dt: DataType, user: AuthenticatedUser): Future[DataType] = {
    val row = domainToRow(dt).copy(version = 1)
    ctx.withUserContext(user.id.value)(table += row).map(_ => rowToDomain(row))
  }

  /** Update a data type row in user context.
   *
   *  The V35 RLS USING clause restricts this update to rows owned by the caller.
   *  Version increment is computed atomically inside the transaction. */
  def update(dt: DataType, user: AuthenticatedUser): Future[Option[DataType]] = {
    val action = table
      .filter(_.id === dt.id.value)
      .result
      .headOption
      .flatMap {
        case None => DBIO.successful(None)
        case Some(existing) =>
          val newVersion = existing.version + 1
          table
            .filter(_.id === dt.id.value)
            .map(r => (r.sourceId, r.name, r.fields, r.computedFields, r.version, r.updatedAt))
            .update((
              dt.sourceId.map(_.value),
              dt.name,
              dt.fields,
              dt.computedFields,
              newVersion,
              dt.updatedAt
            ))
            .andThen(table.filter(_.id === dt.id.value).result.headOption)
            .map(_.map(rowToDomain))
      }
      .transactionally

    ctx.withUserContext(user.id.value)(action)
  }

  /** Privileged unscoped update for the background post-run schema sync path.
   *
   *  Reserved for `PipelineRunService.upsertFieldsFromRows`: the pipeline ACL
   *  was checked at submission time; the background driver has no request-bound
   *  user context. Bypasses the V35 RLS policy via the privileged pool. */
  def updateInternal(dt: DataType): Future[Option[DataType]] = {
    val action = table
      .filter(_.id === dt.id.value)
      .result
      .headOption
      .flatMap {
        case None => DBIO.successful(None)
        case Some(existing) =>
          val newVersion = existing.version + 1
          table
            .filter(_.id === dt.id.value)
            .map(r => (r.sourceId, r.name, r.fields, r.computedFields, r.version, r.updatedAt))
            .update((
              dt.sourceId.map(_.value),
              dt.name,
              dt.fields,
              dt.computedFields,
              newVersion,
              dt.updatedAt
            ))
            .andThen(table.filter(_.id === dt.id.value).result.headOption)
            .map(_.map(rowToDomain))
      }
      .transactionally

    ctx.withSystemContext(action)
  }

  /** Delete a data type row in user context.
   *
   *  The V35 RLS USING clause restricts this DELETE to rows owned by the caller,
   *  providing a DB-layer backstop alongside the app-layer ACL check. */
  def delete(id: DataTypeId, user: AuthenticatedUser): Future[Boolean] =
    ctx.withUserContext(user.id.value)(table.filter(_.id === id.value).delete).map(_ > 0)

  /** Owner-scoped panel-binding check. Returns true only when at least one
   *  panel owned by `user` is bound to this data type. Cross-user bindings
   *  (another user's panel bound to the same type) are not counted — the
   *  caller can only see the panels they own. */
  def existsBoundToAnyOwnedPanel(id: DataTypeId, user: AuthenticatedUser): Future[Boolean] = {
    val ownerStr = user.id.value
    ctx.withUserContext(user.id.value)(
      sql"SELECT COUNT(*) FROM panels WHERE type_id = ${id.value} AND owner_id = $ownerStr::uuid"
        .as[Int].head
    ).map(_ > 0)
  }
}

object DataTypeRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  // Bring DataField / ComputedField Spray JSON formatters into scope.
  private val proto = new DataTypeProtocol {}
  import proto._

  implicit val dataFieldsColumnType: BaseColumnType[Vector[DataField]] =
    MappedColumnType.base[Vector[DataField], String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[Vector[DataField]]
    )

  implicit val computedFieldsColumnType: BaseColumnType[Vector[ComputedField]] =
    MappedColumnType.base[Vector[ComputedField], String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[Vector[ComputedField]]
    )

  case class DataTypeRow(
      id: String,
      sourceId: Option[String],
      name: String,
      fields: Vector[DataField],
      computedFields: Vector[ComputedField],
      version: Int,
      createdAt: Instant,
      updatedAt: Instant,
      ownerId: Option[UUID]
  )

  class DataTypeTable(tag: Tag) extends Table[DataTypeRow](tag, "data_types") {
    def id             = column[String]("id", O.PrimaryKey)
    def sourceId       = column[Option[String]]("source_id")
    def name           = column[String]("name")
    def fields         = column[Vector[DataField]]("fields")
    def computedFields = column[Vector[ComputedField]]("computed_fields")
    def version        = column[Int]("version")
    def createdAt      = column[Instant]("created_at")
    def updatedAt      = column[Instant]("updated_at")
    def ownerId        = column[Option[UUID]]("owner_id")

    def * = (id, sourceId, name, fields, computedFields, version, createdAt, updatedAt, ownerId).mapTo[DataTypeRow]
  }
}
