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
      credentialId = row.credentialId.map(id => ConnectorCredentialId(id.toString)),
      createdAt    = row.createdAt,
      updatedAt    = row.updatedAt,
      completedAt  = row.completedAt,
      completedBy  = row.completedBy
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
        credentialId = Some(UUID.fromString(credentialMeta.id.value)),
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

  /** HEL-955 design.md D1: mints a Connector with **no** credential row -- `credentialId` is
   *  `None`, `isPending` is `true`. Never calls `credentialRepo.create` -- a pending Connector
   *  is completed later via [[bindCredential]], reached only through the completion-token flow
   *  (`ConnectorCompletionService`), never through this method a second time. */
  def createPending(
      ownerId: UserId,
      name: String,
      kind: String,
      baseUrl: String,
      config: String
  ): Future[Connector] = {
    val id  = UUID.randomUUID()
    val now = Instant.now()
    val row = ConnectorRow(
      id           = id,
      ownerId      = UUID.fromString(ownerId.value),
      name         = name,
      kind         = kind,
      baseUrl      = baseUrl,
      config       = config,
      credentialId = None,
      createdAt    = now,
      updatedAt    = now,
      completedAt  = None,
      completedBy  = None
    )
    ctx.withUserContext(ownerId.value)(table += row).map(_ => rowToDomain(row))
  }

  /** HEL-955 design.md D3/task 4.3: mints the credential row (the SAME write path every other
   *  credential goes through -- `credentialRepo.create`, no second credential-write path). Kept
   *  separate from [[repointPendingCredential]] so the caller (`ConnectorCompletionService`) can
   *  consume the completion token BETWEEN encryption and the repoint -- encryption failure here
   *  propagates as a failed `Future` before any token is touched (task 4.3: "does not consume
   *  the token" on encryption failure). */
  def encryptCredential(ownerId: UserId, credentialName: String, credentialPlaintext: String) =
    credentialRepo.create(ownerId, credentialName, credentialPlaintext)

  /** HEL-955 design.md D3/D10: the ONLY place a Connector's `credential_id` transitions from
   *  `NULL` to non-null. Filtered on `id = ... AND credential_id IS NULL` so this can never
   *  re-bind an already-complete Connector -- defence in depth alongside the completion token's
   *  own single-use consumption, which the caller has already performed by the time this runs.
   *  Runs on the **privileged pool** -- reached only from the anonymous completion endpoint,
   *  which has no `app.current_user_id` to set (mirrors
   *  `ShareTokenRepository.findActiveByHash`'s justification). Returns `false` when the
   *  Connector no longer exists or is no longer pending; the caller compensates by deleting the
   *  just-minted credential row (never orphaning it) and treats this identically to "token
   *  invalid" so no oracle is created. */
  def repointPendingCredential(
      id: ConnectorId,
      credentialId: ConnectorCredentialId,
      completedBy: String
  ): Future[Boolean] = {
    val now = Instant.now()
    val action = table
      .filter(r => r.id === UUID.fromString(id.value) && r.credentialId.isEmpty)
      .map(r => (r.credentialId, r.completedAt, r.completedBy, r.updatedAt))
      .update((Some(UUID.fromString(credentialId.value)), Some(now), Some(completedBy), now))
    ctx.withSystemContext(action).map(_ > 0)
  }

  /** Best-effort compensation used by `ConnectorCompletionService` when a just-minted
   *  credential could not be repointed (token consumption raced, or the Connector vanished
   *  concurrently) -- never leaves an orphaned `connector_credentials` row. */
  def compensateDeleteCredential(credentialId: ConnectorCredentialId, ownerId: UserId): Future[Boolean] =
    credentialRepo.delete(credentialId, ownerId).recover { case _ => false }

  /** HEL-955 design.md D4a: unscoped lookup by id, no ownership check, runs under the
   *  privileged pool -- used ONLY by the completion flow, which has no authenticated session to
   *  scope by. Mirrors `findByIdInternal`'s existing justification exactly. */
  def findByIdUnscoped(id: ConnectorId): Future[Option[Connector]] =
    ctx.withSystemContext(table.filter(_.id === UUID.fromString(id.value)).result.headOption)
      .map(_.map(rowToDomain))

  /** HEL-955 design.md D9: owner-scoped Connectors matching a re-mint candidate's owner + kind
   *  (baseUrl/auth-shape comparison is done by the caller, `ConnectorCompletionService`, since
   *  normalization is a pure policy concern that does not belong in the persistence layer). */
  def findPendingByOwnerAndKind(ownerId: UserId, kind: String): Future[Vector[Connector]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    ctx.withUserContext(ownerId.value)(
      table.filter(r => r.ownerId === ownerUuid && r.kind === kind && r.credentialId.isEmpty)
        .sortBy(_.createdAt.desc)
        .result
    ).map(_.map(rowToDomain).toVector)
  }

  def findByIdOwned(id: ConnectorId, user: AuthenticatedUser): Future[Option[Connector]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === UUID.fromString(id.value) && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  /** HEL-822 design.md Decision 11: unscoped lookup — no ownership check, runs under the
   *  privileged pool. Used ONLY by the pipeline-execution path
   *  (`InProcessPipelineEngine`/`PipelineRunService`), mirroring
   *  `DataSourceRepository.findByIdInternal`'s existing, already-reviewed precedent — the
   *  pipeline itself is the access-control boundary for a run (`findByIdShared` already gates
   *  who may run it), not per-artifact ownership of every Connector the run happens to touch.
   *  Never used by `SourceService`/routes/`ConnectorEntityService`, which keep using
   *  `findByIdOwned`. */
  def findByIdInternal(id: ConnectorId): Future[Option[Connector]] =
    ctx.withSystemContext(table.filter(_.id === UUID.fromString(id.value)).result.headOption)
      .map(_.map(rowToDomain))

  def findAll(user: AuthenticatedUser): Future[Vector[Connector]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(_.ownerId === ownerUuid).sortBy(_.createdAt.desc).result
    ).map(_.map(rowToDomain).toVector)
  }

  /** Credential rotation (HEL-824 design.md Decision 1) -- mirrors `create`'s existing
   *  two-step-plus-compensation shape, in the same layer `create` lives in. Scoped by
   *  `findByIdOwned` first (not-found for another owner's Connector id, matching
   *  `update`/`delete`). On success: mints a NEW credential row via `credentialRepo.create`,
   *  repoints `credential_id` on the `connectors` row, then best-effort deletes the OLD
   *  credential row (mirroring `create`'s own compensation pattern -- nothing references the old
   *  row once repointed, so its cleanup failing is inert, not a correctness issue). On repoint
   *  failure, compensates by deleting the just-minted new row before propagating the failure --
   *  never leaves the connector pointing at nothing. */
  def rotateCredential(
      id: ConnectorId,
      newCredentialPlaintext: String,
      credentialName: String,
      user: AuthenticatedUser
  ): Future[Either[ConnectorRotationRefusal, Connector]] =
    findByIdOwned(id, user).flatMap {
      case None => Future.successful(Left(ConnectorRotationNotFound))
      // HEL-955 design.md D4a: rotation is not completion -- refused against a pending
      // Connector so a credential can never be bound through a path that knows nothing about
      // completion tokens (which would leave an outstanding token live against a now-usable
      // Connector, exactly the open slot D3 exists to close). The caller (`ConnectorEntityService`)
      // maps this to a 400-class error naming the completion path.
      case Some(existing) if existing.isPending =>
        Future.successful(Left(ConnectorRotationPending))
      case Some(existing) =>
        credentialRepo.create(user.id, credentialName, newCredentialPlaintext).flatMap { newCredentialMeta =>
          val now = Instant.now()
          val repointAction = table
            .filter(_.id === UUID.fromString(id.value))
            .map(r => (r.credentialId, r.updatedAt))
            .update((Some(UUID.fromString(newCredentialMeta.id.value)), now))
          ctx.withUserContext(user.id.value)(repointAction)
            .flatMap { updatedCount =>
              if (updatedCount > 0) {
                // Best-effort delete of the OLD credential row -- never block success on it.
                // `existing.credentialId` is non-empty here (the pending branch above already
                // excluded `None`).
                existing.credentialId.foreach(old => credentialRepo.delete(old, user.id).recover { case _ => false })
                Future.successful(
                  Right(existing.copy(credentialId = Some(newCredentialMeta.id), updatedAt = now))
                )
              } else {
                // Repoint failed (e.g. row disappeared concurrently) -- compensate by deleting
                // the just-minted new row so it isn't orphaned, then propagate not-found.
                credentialRepo.delete(newCredentialMeta.id, user.id).recover { case _ => false }
                  .map(_ => Left(ConnectorRotationNotFound))
              }
            }
            .recoverWith { case repointFailure =>
              credentialRepo.delete(newCredentialMeta.id, user.id).recover { case _ => false }
              Future.failed(repointFailure)
            }
        }
    }

  /** Updates non-secret fields only (name/baseUrl/config) + updatedAt. Never
   *  touches `credential_id` -- rotation is a dedicated operation, see
   *  [[rotateCredential]] (HEL-824 design.md Decision 1). */
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
                  // HEL-955 design.md D4a: `credential_id` is now `Option` -- a pending
                  // Connector has no credential row to delete (and its outstanding completion
                  // tokens cascade via `ON DELETE CASCADE` on `connector_completion_tokens`,
                  // set up in V103). Binding nothing, this makes the Risks note's claim that an
                  // abandoned pending Connector is "deletable through the existing owner CRUD
                  // path" actually true.
                  existing.credentialId match {
                    case Some(credId) => credentialRepo.delete(credId, user.id).map(_ => Right(true))
                    case None         => Future.successful(Right(true))
                  }
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

/** Marker sealed trait for [[ConnectorRepository.rotateCredential]]'s refusal branches -- kept
 *  distinct from `ServiceError` so the repository layer stays HTTP-agnostic; the service layer
 *  maps each to its own HTTP status. */
sealed trait ConnectorRotationRefusal
case object ConnectorRotationNotFound extends ConnectorRotationRefusal

/** HEL-955 design.md D4a: rotation against a pending Connector is refused -- rotation is not
 *  completion (see `rotateCredential`'s doc comment). The service layer maps this to a
 *  400-class error naming the completion path. */
case object ConnectorRotationPending extends ConnectorRotationRefusal

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
      credentialId: Option[UUID],
      createdAt: Instant,
      updatedAt: Instant,
      completedAt: Option[Instant] = None,
      completedBy: Option[String] = None
  )

  class ConnectorTable(tag: Tag) extends Table[ConnectorRow](tag, "connectors") {
    def id           = column[UUID]("id", O.PrimaryKey)
    def ownerId      = column[UUID]("owner_id")
    def name         = column[String]("name")
    def kind         = column[String]("kind")
    def baseUrl      = column[String]("base_url")
    def config       = column[String]("config")(jsonbStringType)
    def credentialId = column[Option[UUID]]("credential_id")
    def createdAt    = column[Instant]("created_at")
    def updatedAt    = column[Instant]("updated_at")
    def completedAt  = column[Option[Instant]]("completed_at")
    def completedBy  = column[Option[String]]("completed_by")

    def * = (id, ownerId, name, kind, baseUrl, config, credentialId, createdAt, updatedAt, completedAt, completedBy).mapTo[ConnectorRow]
  }
}
