package com.helio.infrastructure.persistence.sources

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Owner-scoped Slick repository for the `connectors` table (HEL-821). `config` is
 *  stored as JSONB, mapped opaquely to a `String` at the Slick layer -- same
 *  convention as `DataSourceRepository.config`/`AlertRuleRepository.condition`.
 *
 *  The credential itself is never touched here beyond its id -- `create`/`delete`
 *  delegate to [[ConnectorCredentialRepository]] for the actual encrypted-secret
 *  lifecycle (design.md Decision 2). This repository never calls
 *  `ConnectorCredentialRepository.decryptForUse`. */
class ConnectorRepository(ctx: DbContext, credentialRepo: ConnectorCredentialRepository)(implicit
    ec: ExecutionContext
) {

  import ConnectorRepository._

  private val table = TableQuery[ConnectorTable]

  private def rowToDomain(row: ConnectorRow): Connector =
    Connector(
      id           = ConnectorId(row.id.toString),
      ownerId      = UserId(row.ownerId.toString),
      name         = row.name,
      kind         = row.kind,
      baseUrl      = row.baseUrl,
      config       = row.config,
      credentialId = ConnectorCredentialId(row.credentialId.toString),
      createdAt    = row.createdAt,
      updatedAt    = row.updatedAt
    )

  /** Two-transaction-plus-compensation create (design.md Decision 2).
   *  `ConnectorCredentialRepository.create` runs its own committed
   *  transaction and cannot be composed atomically with the `connectors`
   *  insert without modifying HEL-536 code (out of scope -- consume it as-is).
   *  So: encrypt+persist the credential first; if the subsequent `connectors`
   *  insert fails, best-effort compensate by deleting the just-created
   *  credential. If that compensating delete also fails, the orphaned
   *  `connector_credentials` row is left in place -- inert (nothing
   *  references it) and an accepted gap (a periodic reaper is a documented
   *  HEL-822+ follow-up, not built here).
   *
   *  `credential_id` passed to the `connectors` insert is ALWAYS the id this
   *  method just minted via `credentialRepo.create` -- never a caller-supplied
   *  value -- so a cross-tenant credential reference has no code path to
   *  occur through (Postgres FK validation bypasses RLS and cannot be relied
   *  on alone; see design.md Decision 2's load-bearing note). */
  def create(
      ownerId: UserId,
      name: String,
      kind: String,
      baseUrl: String,
      config: String,
      credentialPlaintext: String,
      credentialName: String
  ): Future[Connector] =
    credentialRepo.create(ownerId, credentialName, credentialPlaintext).flatMap { credentialMeta =>
      val id  = UUID.randomUUID()
      val now = Instant.now()
      val row = ConnectorRow(
        id           = id,
        ownerId      = UUID.fromString(ownerId.value),
        name         = name,
        kind         = kind,
        baseUrl      = baseUrl,
        config       = config,
        credentialId = UUID.fromString(credentialMeta.id.value),
        createdAt    = now,
        updatedAt    = now
      )
      ctx.withUserContext(ownerId.value)(table += row)
        .map(_ => rowToDomain(row))
        .recoverWith { case insertFailure =>
          // Best-effort compensation -- never surface this secondary failure
          // in place of the real cause, and never block on it succeeding.
          credentialRepo.delete(credentialMeta.id, ownerId).recover { case _ => false }
          Future.failed(insertFailure)
        }
    }

  def findByIdOwned(id: ConnectorId, user: AuthenticatedUser): Future[Option[Connector]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === UUID.fromString(id.value) && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  def findAll(user: AuthenticatedUser): Future[Vector[Connector]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(_.ownerId === ownerUuid).sortBy(_.createdAt.desc).result
    ).map(_.map(rowToDomain).toVector)
  }

  /** Updates non-secret fields only (name/baseUrl/config) + updatedAt. Never
   *  touches `credential_id` -- rotation is a distinct, not-yet-built
   *  operation (design.md Decision 3). */
  def update(id: ConnectorId, name: String, baseUrl: String, config: String, updatedAt: Instant, user: AuthenticatedUser): Future[Option[Connector]] = {
    val action = table
      .filter(_.id === UUID.fromString(id.value))
      .map(r => (r.name, r.baseUrl, r.config, r.updatedAt))
      .update((name, baseUrl, config, updatedAt))
      .andThen(table.filter(_.id === UUID.fromString(id.value)).result.headOption)
      .map(_.map(rowToDomain))
    ctx.withUserContext(user.id.value)(action)
  }

  /** Deletes a Connector and its associated credential, blocking (409-shaped,
   *  via the returned `Left`) when `dependentCount` reports a nonzero count
   *  of resources still referencing this Connector (design.md Decision 4).
   *  `dependentCount` defaults to always-zero since no referencing column
   *  exists in this ticket's scope (HEL-822 supplies the real implementation
   *  as its own collaborator, wired in at construction there -- no further
   *  change needed here). */
  def delete(
      id: ConnectorId,
      user: AuthenticatedUser,
      dependentCount: ConnectorId => Future[Int] = _ => Future.successful(0)
  ): Future[Either[ConnectorHasDependents.type, Boolean]] =
    findByIdOwned(id, user).flatMap {
      case None => Future.successful(Right(false))
      case Some(existing) =>
        dependentCount(id).flatMap {
          case n if n > 0 => Future.successful(Left(ConnectorHasDependents))
          case _ =>
            ctx.withUserContext(user.id.value)(table.filter(_.id === UUID.fromString(id.value)).delete)
              .flatMap { deletedCount =>
                if (deletedCount > 0)
                  credentialRepo.delete(existing.credentialId, user.id).map(_ => Right(true))
                else
                  Future.successful(Right(false))
              }
        }
    }
}

/** Marker for the 409 branch of [[ConnectorRepository.delete]] (design.md
 *  Decision 4) -- kept distinct from `ServiceError` so the repository layer
 *  stays HTTP-agnostic; the service layer maps this to
 *  `ServiceError.Conflict`. */
case object ConnectorHasDependents

object ConnectorRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  implicit val jsonbStringType: BaseColumnType[String] =
    MappedColumnType.base[String, String](s => s, s => s)

  case class ConnectorRow(
      id: UUID,
      ownerId: UUID,
      name: String,
      kind: String,
      baseUrl: String,
      config: String,
      credentialId: UUID,
      createdAt: Instant,
      updatedAt: Instant
  )

  class ConnectorTable(tag: Tag) extends Table[ConnectorRow](tag, "connectors") {
    def id           = column[UUID]("id", O.PrimaryKey)
    def ownerId      = column[UUID]("owner_id")
    def name         = column[String]("name")
    def kind         = column[String]("kind")
    def baseUrl      = column[String]("base_url")
    def config       = column[String]("config")(jsonbStringType)
    def credentialId = column[UUID]("credential_id")
    def createdAt    = column[Instant]("created_at")
    def updatedAt    = column[Instant]("updated_at")

    def * = (id, ownerId, name, kind, baseUrl, config, credentialId, createdAt, updatedAt).mapTo[ConnectorRow]
  }
}
