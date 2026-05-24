package com.helio.infrastructure

import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}

/** Scopes database access to the correct connection pool based on the caller's
 *  authorisation context.
 *
 *  Two pools are maintained (see `Database.initApp` / `Database.initPrivileged`):
 *
 *  - **App pool** (`db`): standard connections with no BYPASSRLS privilege.
 *    `SET LOCAL app.current_user_id` is written at the start of every
 *    transaction so HikariCP connection reuse never carries stale identity
 *    into a subsequent request. RLS policies evaluate normally on this pool.
 *
 *  - **Privileged pool** (`privilegedDb`): connections whose startup SQL sets
 *    `ROLE helio_privileged`, a Postgres role with `BYPASSRLS`. All Row Level
 *    Security policies are skipped for queries on this pool. The pool is the
 *    ONLY mechanism by which RLS bypass is possible — no application code can
 *    gain bypass via a session variable or any other path.
 *
 *  Every ACL'd read or write MUST go through one of the two entry points:
 *
 *  - [[withUserContext]] — for user-owned reads and writes; passes the
 *    caller's user ID so RLS policies can evaluate it. Uses the app pool.
 *  - [[withSystemContext]] — for privileged callers (background jobs,
 *    `ResourceTypeRegistry` resolvers, DemoData seeding, and any path
 *    where no authenticated user is available). Uses the privileged pool.
 *
 *  Raw `db.run` calls on ACL'd tables are forbidden; see CONTRIBUTING.md.
 */
class DbContext(db: JdbcBackend.Database, privilegedDb: JdbcBackend.Database)(implicit ec: ExecutionContext) {

  /** Prepend `SELECT set_config('app.current_user_id', userId, true)` as a
   *  DBIO[Unit]; the `true` flag makes it transaction-local (`SET LOCAL`). */
  private def setUserVar(userId: String): DBIO[Unit] =
    sql"SELECT set_config('app.current_user_id', $userId, true)".as[String].map(_ => ())

  /** Run `action` inside a transaction on the **app pool** where
   *  `app.current_user_id` is set to `userId` for the duration of that
   *  transaction.
   *
   *  `SET LOCAL` guarantees the variable is cleared at COMMIT or ROLLBACK,
   *  so pooled connections never carry stale identity into subsequent
   *  requests. The action may itself call `.transactionally`; nested
   *  PostgreSQL transactions are handled gracefully (outer transaction wins,
   *  `SET LOCAL` remains in scope until the outer COMMIT). */
  def withUserContext[R](userId: String)(action: DBIO[R]): Future[R] =
    db.run((setUserVar(userId) andThen action).transactionally)

  /** Run `action` inside a transaction on the **privileged pool**.
   *
   *  Connections in the privileged pool carry the `helio_privileged` Postgres
   *  role (`BYPASSRLS`), so all RLS policies are skipped for the duration of
   *  the action. This pool is the sole RLS-bypass mechanism; no session
   *  variable or application-level flag can replicate its effect on the app pool.
   *
   *  Reserved for background jobs, `ResourceTypeRegistry` resolvers, DemoData
   *  seeding, and any path that executes without a request-bound user.
   *  Every callsite MUST carry an inline comment explaining why bypass is correct. */
  def withSystemContext[R](action: DBIO[R]): Future[R] =
    privilegedDb.run(action.transactionally)
}
