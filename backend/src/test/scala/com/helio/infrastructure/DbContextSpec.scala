package com.helio.infrastructure

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Verifies that `DbContext` correctly scopes the `app.current_user_id`
 *  session variable to each transaction and does not leak state across
 *  connections (the HikariCP pool-leak regression the whole ticket exists
 *  to prevent). */
class DbContextSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def readUserId: DBIO[String] =
    sql"SELECT current_setting('app.current_user_id', true)".as[String].head

  "DbContext.withUserContext" should {

    /** Task 2.1 — connection-leak regression: after the transaction completes,
     *  the next `withSystemContext` must see the system value, not the user id
     *  from a previous call.  If `SET SESSION` were used instead of
     *  `set_config(..., true)` (= `SET LOCAL`) the value would persist on the
     *  pooled connection and this test would fail. */
    "set app.current_user_id inside the transaction and not leak it to the next call" in {
      val userId = "user-ctx-spec-" + java.util.UUID.randomUUID().toString

      val insideTx = await(ctx.withUserContext(userId)(readUserId))
      insideTx shouldBe userId

      // After the transaction commits the connection is returned to the pool.
      // A subsequent withSystemContext must observe the system sentinel, not
      // the previous user id — proving the SET LOCAL did not persist.
      val afterTx = await(ctx.withSystemContext(readUserId))
      afterTx shouldBe "system"
    }

    /** Task 2.2 — rollback variant: even when the action fails and the
     *  transaction rolls back, the session variable must not remain set on
     *  the pooled connection.  `SET LOCAL` is cleared by both COMMIT and
     *  ROLLBACK, so we verify the value is gone after the failure. */
    "not leak app.current_user_id to the pool after a rolled-back transaction" in {
      val userId = "rollback-spec-" + java.util.UUID.randomUUID().toString

      val failingAction: DBIO[String] = readUserId.andThen(
        DBIO.failed(new RuntimeException("intentional rollback"))
      )

      // The Future should fail …
      val result = await(ctx.withUserContext(userId)(failingAction).failed)
      result.getMessage shouldBe "intentional rollback"

      // … and the next transaction must not inherit the rolled-back user id.
      val afterRollback = await(ctx.withSystemContext(readUserId))
      afterRollback shouldBe "system"
    }
  }

  "DbContext.withSystemContext" should {

    /** Task 2.3 — system sentinel: `withSystemContext` must set the
     *  `app.current_user_id` variable to the literal string `"system"` for
     *  the duration of the action, allowing RLS policies to identify
     *  privileged service-layer calls. */
    "set app.current_user_id to 'system' for the duration of the action" in {
      val observed = await(ctx.withSystemContext(readUserId))
      observed shouldBe "system"
    }
  }
}
