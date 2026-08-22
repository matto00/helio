package com.helio.infrastructure.persistence.auth

import com.helio.infrastructure.crypto.TokenHashing
import com.helio.domain.model.{User, UserId, UserSession, UserTier}
import com.helio.services.auth.UserTierConfig
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class UserRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import UserRepository._

  private val users    = TableQuery[UserTable]
  private val sessions = TableQuery[SessionTable]

  private def rowToDomain(row: UserRow): User =
    User(
      id          = UserId(row.id.toString),
      email       = row.email,
      displayName = row.displayName,
      createdAt   = row.createdAt,
      googleId    = row.googleId,
      avatarUrl   = row.avatarUrl,
      tier        = UserTier.fromString(row.tier).getOrElse(
        throw new IllegalStateException(s"Unknown tier in DB for user ${row.id}: '${row.tier}'")
      )
    )

  /** Reconstructs the domain session with the caller's raw `token`, not the
   *  row's `tokenHash` — the row never carries the raw value (HEL-288). */
  private def sessionRowToDomain(row: SessionRow, rawToken: String): UserSession =
    UserSession(
      token     = rawToken,
      userId    = UserId(row.userId.toString),
      createdAt = row.createdAt,
      expiresAt = row.expiresAt
    )

  def findById(userId: UserId): Future[Option[User]] =
    db.run(users.filter(_.id === UUID.fromString(userId.value)).result.headOption)
      .map(_.map(rowToDomain))

  def findByEmail(email: String): Future[Option[User]] =
    db.run(users.filter(_.email === email).result.headOption)
      .map(_.map(rowToDomain))

  def findByGoogleId(googleId: String): Future[Option[User]] =
    db.run(users.filter(_.googleId === googleId).result.headOption)
      .map(_.map(rowToDomain))

  def insert(user: User, passwordHash: Option[String]): Future[User] = {
    val row = UserRow(
      id           = UUID.fromString(user.id.value),
      email        = user.email,
      passwordHash = passwordHash,
      displayName  = user.displayName,
      createdAt    = user.createdAt,
      googleId     = user.googleId,
      avatarUrl    = user.avatarUrl,
      tier         = UserTier.asString(user.tier)
    )
    db.run(users += row).map(_ => user)
  }

  /** Creates on first Google login, matches by `google_id` on subsequent logins. `tierConfig`
   *  (HEL-703, design.md D4) decides tier alongside the existing avatar-refresh precedent: a NEW
   *  user is assigned `owner` on an allowlist match (else the domain default `free`); a RETURNING
   *  user whose email now matches the allowlist and whose stored tier is not already `owner` is
   *  promoted -- and the promotion is persisted in the SAME update as the avatar refresh. The
   *  allowlist only ever promotes, never demotes (an already-`owner` user whose email later leaves
   *  the allowlist keeps `owner`). */
  def upsertGoogleUser(
      googleId: String,
      email: String,
      displayName: Option[String],
      avatarUrl: Option[String],
      tierConfig: UserTierConfig
  ): Future[User] = {
    findByGoogleId(googleId).flatMap {
      case Some(existingUser) =>
        val promoted = tierConfig.isOwnerEmail(email) && existingUser.tier != UserTier.Owner
        val newTier  = if (promoted) UserTier.Owner else existingUser.tier
        val updateAction = users
          .filter(_.id === UUID.fromString(existingUser.id.value))
          .map(u => (u.avatarUrl, u.tier))
          .update((avatarUrl, UserTier.asString(newTier)))
        db.run(updateAction).map(_ => existingUser.copy(avatarUrl = avatarUrl, tier = newTier))

      case None =>
        val now  = Instant.now()
        val tier = if (tierConfig.isOwnerEmail(email)) UserTier.Owner else UserTier.Free
        val newUser = User(
          id          = UserId(UUID.randomUUID().toString),
          email       = email,
          displayName = displayName,
          createdAt   = now,
          googleId    = Some(googleId),
          avatarUrl   = avatarUrl,
          tier        = tier
        )
        val row = UserRow(
          id           = UUID.fromString(newUser.id.value),
          email        = newUser.email,
          passwordHash = None,
          displayName  = newUser.displayName,
          createdAt    = newUser.createdAt,
          googleId     = newUser.googleId,
          avatarUrl    = newUser.avatarUrl,
          tier         = UserTier.asString(newUser.tier)
        )
        db.run(users += row).map(_ => newUser)
    }
  }

  /** Persists a tier change directly (HEL-703) -- used by `AuthService.login`'s allowlist
   *  promotion, which needs the update to land BEFORE the login response is built (unlike
   *  `upsertGoogleUser`'s own inline promotion, this is a bare column update with no other side
   *  effect). A no-op-shaped success for an unknown id -- callers always hold an id they just
   *  resolved via `findByEmail`/`findById`, so this never needs existence signaling. */
  def updateTier(userId: UserId, tier: UserTier): Future[Unit] =
    db.run(users.filter(_.id === UUID.fromString(userId.value)).map(_.tier).update(UserTier.asString(tier)))
      .map(_ => ())

  def getPasswordHash(userId: UserId): Future[Option[String]] =
    db.run(users.filter(_.id === UUID.fromString(userId.value)).map(_.passwordHash).result.headOption)
      .map(_.flatten)

  /** Hashes the raw token before insert (HEL-288); returns the original
   *  (raw-token) `session` unchanged so callers (`AuthService`) can still
   *  return it in `AuthResponse.token`. */
  def createSession(session: UserSession): Future[UserSession] = {
    val row = SessionRow(
      tokenHash = TokenHashing.sha256Hex(session.token),
      userId    = UUID.fromString(session.userId.value),
      createdAt = session.createdAt,
      expiresAt = session.expiresAt
    )
    db.run(sessions += row).map(_ => session)
  }

  /** Hashes the incoming raw `token` before querying (HEL-288); the raw value
   *  itself is never compared against the database. */
  def findSession(token: String): Future[Option[UserSession]] =
    db.run(sessions.filter(_.tokenHash === TokenHashing.sha256Hex(token)).result.headOption)
      .map(_.map(sessionRowToDomain(_, token)))

  /** Hashes the incoming raw `token` before deleting (HEL-288). */
  def deleteSession(token: String): Future[Unit] =
    db.run(sessions.filter(_.tokenHash === TokenHashing.sha256Hex(token)).delete).map(_ => ())
}

object UserRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  final case class UserRow(
      id: UUID,
      email: String,
      passwordHash: Option[String],
      displayName: Option[String],
      createdAt: Instant,
      googleId: Option[String] = None,
      avatarUrl: Option[String] = None,
      // HEL-703: kept as the raw wire string here (parsed/rendered via UserTier.fromString/
      // asString at the rowToDomain/insert/upsertGoogleUser boundaries) -- mirrors
      // AgentMemoryRepository's own AgentMemoryRow.kind: String convention.
      tier: String = "free"
  )

  final case class SessionRow(
      tokenHash: String,
      userId: UUID,
      createdAt: Instant,
      expiresAt: Instant
  )

  class UserTable(tag: Tag) extends Table[UserRow](tag, "users") {
    def id           = column[UUID]("id", O.PrimaryKey)
    def email        = column[String]("email")
    def passwordHash = column[Option[String]]("password_hash")
    def displayName  = column[Option[String]]("display_name")
    def createdAt    = column[Instant]("created_at")
    def googleId     = column[Option[String]]("google_id")
    def avatarUrl    = column[Option[String]]("avatar_url")
    def tier         = column[String]("tier")
    def * = (id, email, passwordHash, displayName, createdAt, googleId, avatarUrl, tier) <> (UserRow.tupled, UserRow.unapply)
  }

  class SessionTable(tag: Tag) extends Table[SessionRow](tag, "user_sessions") {
    def tokenHash = column[String]("token_hash", O.PrimaryKey)
    def userId    = column[UUID]("user_id")
    def createdAt = column[Instant]("created_at")
    def expiresAt = column[Instant]("expires_at")
    def * = (tokenHash, userId, createdAt, expiresAt) <> (SessionRow.tupled, SessionRow.unapply)
  }
}
