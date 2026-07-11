package com.helio.infrastructure

import com.helio.domain.{AuthenticatedUser, UserId}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

trait UserSessionRepository {
  def findValidSession(token: String): Future[Option[AuthenticatedUser]]
}

class SlickUserSessionRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext)
    extends UserSessionRepository {

  import UserRepository._

  private val sessions = TableQuery[SessionTable]

  /** Hashes the incoming raw `token` before filtering (HEL-288) — this is the
   *  hot authentication path, called on every protected request. */
  override def findValidSession(token: String): Future[Option[AuthenticatedUser]] = {
    val now  = Instant.now()
    val hash = TokenHashing.sha256Hex(token)
    db.run(
      sessions
        .filter(s => s.tokenHash === hash && s.expiresAt > now)
        .map(_.userId)
        .result
        .headOption
    ).map(_.map(uid => AuthenticatedUser(UserId(uid.toString))))
  }
}
