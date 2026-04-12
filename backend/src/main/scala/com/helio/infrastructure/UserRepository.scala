package com.helio.infrastructure

import com.helio.domain.{User, UserId, UserSession}
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class UserRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext) {

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
      avatarUrl   = row.avatarUrl
    )

  private def sessionRowToDomain(row: SessionRow): UserSession =
    UserSession(
      token     = row.token,
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

  def insert(user: User, passwordHash: String): Future[User] = {
    val row = UserRow(
      id           = UUID.fromString(user.id.value),
      email        = user.email,
      passwordHash = passwordHash,
      displayName  = user.displayName,
      createdAt    = user.createdAt,
      googleId     = user.googleId,
      avatarUrl    = user.avatarUrl
    )
    db.run(users += row).map(_ => user)
  }

  def upsertGoogleUser(
      googleId: String,
      email: String,
      displayName: Option[String],
      avatarUrl: Option[String]
  ): Future[User] = {
    findByGoogleId(googleId).flatMap {
      case Some(existingUser) =>
        // Update avatar_url on subsequent logins
        val updateAction = users
          .filter(_.id === UUID.fromString(existingUser.id.value))
          .map(_.avatarUrl)
          .update(avatarUrl)
        db.run(updateAction).map(_ => existingUser.copy(avatarUrl = avatarUrl))

      case None =>
        val now = Instant.now()
        val newUser = User(
          id          = UserId(UUID.randomUUID().toString),
          email       = email,
          displayName = displayName,
          createdAt   = now,
          googleId    = Some(googleId),
          avatarUrl   = avatarUrl
        )
        val row = UserRow(
          id           = UUID.fromString(newUser.id.value),
          email        = newUser.email,
          passwordHash = "",  // Google users have no password
          displayName  = newUser.displayName,
          createdAt    = newUser.createdAt,
          googleId     = newUser.googleId,
          avatarUrl    = newUser.avatarUrl
        )
        db.run(users += row).map(_ => newUser)
    }
  }

  def getPasswordHash(userId: UserId): Future[Option[String]] =
    db.run(users.filter(_.id === UUID.fromString(userId.value)).map(_.passwordHash).result.headOption)

  def createSession(session: UserSession): Future[UserSession] = {
    val row = SessionRow(
      token     = session.token,
      userId    = UUID.fromString(session.userId.value),
      createdAt = session.createdAt,
      expiresAt = session.expiresAt
    )
    db.run(sessions += row).map(_ => session)
  }

  def findSession(token: String): Future[Option[UserSession]] =
    db.run(sessions.filter(_.token === token).result.headOption)
      .map(_.map(sessionRowToDomain))

  def deleteSession(token: String): Future[Unit] =
    db.run(sessions.filter(_.token === token).delete).map(_ => ())
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
      passwordHash: String,
      displayName: Option[String],
      createdAt: Instant,
      googleId: Option[String] = None,
      avatarUrl: Option[String] = None
  )

  final case class SessionRow(
      token: String,
      userId: UUID,
      createdAt: Instant,
      expiresAt: Instant
  )

  class UserTable(tag: Tag) extends Table[UserRow](tag, "users") {
    def id           = column[UUID]("id", O.PrimaryKey)
    def email        = column[String]("email")
    def passwordHash = column[String]("password_hash")
    def displayName  = column[Option[String]]("display_name")
    def createdAt    = column[Instant]("created_at")
    def googleId     = column[Option[String]]("google_id")
    def avatarUrl    = column[Option[String]]("avatar_url")
    def * = (id, email, passwordHash, displayName, createdAt, googleId, avatarUrl) <> (UserRow.tupled, UserRow.unapply)
  }

  class SessionTable(tag: Tag) extends Table[SessionRow](tag, "user_sessions") {
    def token     = column[String]("token", O.PrimaryKey)
    def userId    = column[UUID]("user_id")
    def createdAt = column[Instant]("created_at")
    def expiresAt = column[Instant]("expires_at")
    def * = (token, userId, createdAt, expiresAt) <> (SessionRow.tupled, SessionRow.unapply)
  }
}
