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
      createdAt   = row.createdAt
    )

  private def sessionRowToDomain(row: SessionRow): UserSession =
    UserSession(
      token     = row.token,
      userId    = UserId(row.userId.toString),
      createdAt = row.createdAt,
      expiresAt = row.expiresAt
    )

  def findByEmail(email: String): Future[Option[User]] =
    db.run(users.filter(_.email === email).result.headOption)
      .map(_.map(rowToDomain))

  def insert(user: User, passwordHash: String): Future[User] = {
    val row = UserRow(
      id           = UUID.fromString(user.id.value),
      email        = user.email,
      passwordHash = passwordHash,
      displayName  = user.displayName,
      createdAt    = user.createdAt
    )
    db.run(users += row).map(_ => user)
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
      createdAt: Instant
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
    def * = (id, email, passwordHash, displayName, createdAt) <> (UserRow.tupled, UserRow.unapply)
  }

  class SessionTable(tag: Tag) extends Table[SessionRow](tag, "user_sessions") {
    def token     = column[String]("token", O.PrimaryKey)
    def userId    = column[UUID]("user_id")
    def createdAt = column[Instant]("created_at")
    def expiresAt = column[Instant]("expires_at")
    def * = (token, userId, createdAt, expiresAt) <> (SessionRow.tupled, SessionRow.unapply)
  }
}
