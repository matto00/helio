package com.helio.infrastructure

import com.helio.domain.{AuthenticatedUser, UserId}
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

trait UserSessionRepository {
  def findValidSession(token: String): Future[Option[AuthenticatedUser]]
}

class SlickUserSessionRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext)
    extends UserSessionRepository {

  import UserRepository._

  private val sessions = TableQuery[SessionTable]

  override def findValidSession(token: String): Future[Option[AuthenticatedUser]] = {
    val now = Instant.now()
    db.run(
      sessions
        .filter(s => s.token === token && s.expiresAt > now)
        .map(_.userId)
        .result
        .headOption
    ).map(_.map(uid => AuthenticatedUser(UserId(uid.toString))))
  }
}
