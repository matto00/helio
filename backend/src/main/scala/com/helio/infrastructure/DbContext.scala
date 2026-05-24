package com.helio.infrastructure

import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}

/** Scopes the `app.current_user_id` Postgres session variable to the current
 *  transaction so HikariCP connection reuse never carries stale identity into
 *  a subsequent request.
 *
 *  `SET LOCAL` (implemented via `set_config(..., true)`) scopes the variable
 *  to the transaction and is automatically cleared at COMMIT or ROLLBACK.
 *  This is the foundational safety property that prevents connection-pool
 *  data leaks when RLS policies are enabled in later sub-tickets.
 *
 *  Every ACL'd read or write MUST go through one of the two entry points:
 *
 *  - [[withUserContext]] — for user-owned reads and writes; passes the
 *    caller's user ID so RLS policies can evaluate it.
 *  - [[withSystemContext]] — for privileged callers (background jobs,
 *    `ResourceTypeRegistry` resolvers, DemoData seeding, and any path
 *    where no authenticated user is available).
 *
 *  Raw `db.run` calls on ACL'd tables are forbidden; see CONTRIBUTING.md.
 */
class DbContext(db: JdbcBackend.Database)(implicit ec: ExecutionContext) {

  /** Sentinel written by [[withSystemContext]].
   *  RLS policies in later sub-tickets will treat this value as a privileged
   *  bypass. A future privileged-role sub-ticket may switch to
   *  `SET LOCAL ROLE` instead; until then this constant is the switch point. */
  private val SystemUserId = "system"

  /** Prepend `SELECT set_config('app.current_user_id', userId, true)` as a
   *  DBIO[Unit]; the `true` flag makes it transaction-local. */
  private def setVar(userId: String): DBIO[Unit] =
    sql"SELECT set_config('app.current_user_id', $userId, true)".as[String].map(_ => ())

  /** Run `action` inside a transaction where `app.current_user_id` is set to
   *  `userId` for the duration of that transaction.
   *
   *  `SET LOCAL` guarantees the variable is cleared at COMMIT or ROLLBACK,
   *  so pooled connections never carry stale identity into subsequent
   *  requests. The action may itself call `.transactionally`; nested
   *  PostgreSQL transactions are handled gracefully (outer transaction wins,
   *  `SET LOCAL` remains in scope until the outer COMMIT). */
  def withUserContext[R](userId: String)(action: DBIO[R]): Future[R] =
    db.run((setVar(userId) andThen action).transactionally)

  /** Run `action` inside a transaction where `app.current_user_id` is set to
   *  the sentinel `'system'`.
   *
   *  Reserved for background jobs, `ResourceTypeRegistry` resolvers, and
   *  DemoData seeding — any path that executes without a request-bound user.
   *  RLS policies added in later sub-tickets will recognise `'system'` as a
   *  privileged bypass. */
  def withSystemContext[R](action: DBIO[R]): Future[R] =
    db.run((setVar(SystemUserId) andThen action).transactionally)
}
