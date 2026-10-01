package com.helio.testsupport

import com.helio.domain.model.UserId
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.telemetry.ProductEventRepository
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.{BeforeAndAfterAll, BeforeAndAfterEach, Suite}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1208 harness. Runs the whole migration chain, the app pool and the privileged pool exactly
 *  as production does: Flyway and the app pool connect as a non-superuser, non-BYPASSRLS table
 *  owner (so FORCE ROW LEVEL SECURITY applies), and the privileged pool `SET ROLE`s
 *  helio_privileged. A superuser/BYPASSRLS connection here would make every isolation assertion
 *  vacuous. */
trait ProductTelemetryDbHarness extends BeforeAndAfterAll with BeforeAndAfterEach { this: Suite =>

  protected implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _
  private var privDb: JdbcBackend.Database       = _
  protected var ctx: DbContext                   = _
  protected var repo: ProductEventRepository     = _

  protected val Retention = 90
  protected val userA     = UserId(UUID.randomUUID().toString)
  protected val userB     = UserId(UUID.randomUUID().toString)

  protected def await[T](f: Future[T]): T = Await.result(f, 20.seconds)
  protected def priv[T](a: DBIO[T]): T    = await(ctx.withSystemContext(a))

  protected def newUser(): UserId = {
    val u = UserId(UUID.randomUUID().toString)
    priv(sqlu"INSERT INTO users (id, email, created_at) VALUES (${u.value}::uuid, ${u.value + "@t.local"}, now())")
    u
  }

  protected def rawInsert(user: UserId, name: String, at: Instant, props: String = "{}"): Unit =
    priv(sqlu"""INSERT INTO product_events (user_id, event, properties, occurred_at)
                VALUES (${user.value}::uuid, $name, $props::jsonb, ${Timestamp.from(at)})""")

  protected def countEvents(name: String): Int = priv(sql"SELECT COUNT(*) FROM product_events WHERE event = $name".as[Int].head)

  override def beforeAll(): Unit = {
    super.beforeAll()
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val st = superConn.createStatement()
      st.execute("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      st.execute("ALTER SCHEMA public OWNER TO helio_migration_test")
      st.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      st.execute("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
      st.close()
    } finally superConn.close()

    val url = embeddedPostgres.getJdbcUrl("helio_migration_test", "postgres")
    Flyway.configure().dataSource(url, "helio_migration_test", "test").locations("classpath:db/migration").load().migrate()

    def pool(initSql: Option[String]): JdbcBackend.Database = {
      val cfg = new HikariConfig()
      cfg.setJdbcUrl(url + "&stringtype=unspecified")
      cfg.setUsername("helio_migration_test")
      cfg.setPassword("test")
      cfg.setMaximumPoolSize(5)
      initSql.foreach(cfg.setConnectionInitSql)
      JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(5))
    }
    appDb  = pool(None)
    privDb = pool(Some("SET ROLE helio_privileged"))
    ctx    = new DbContext(appDb, privDb)
    repo   = new ProductEventRepository(ctx)

    priv(DBIO.seq(
      sqlu"INSERT INTO users (id, email, created_at) VALUES (${userA.value}::uuid, ${userA.value + "@t.local"}, now())",
      sqlu"INSERT INTO users (id, email, created_at) VALUES (${userB.value}::uuid, ${userB.value + "@t.local"}, now())"
    ))
  }

  override def afterAll(): Unit = {
    appDb.close()
    privDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  override def beforeEach(): Unit = {
    super.beforeEach()
    priv(DBIO.seq(
      sqlu"DELETE FROM product_events",
      sqlu"DELETE FROM product_event_daily",
      sqlu"DELETE FROM product_active_users_daily",
      sqlu"DELETE FROM product_ttfd_daily",
      sqlu"DELETE FROM product_event_property_daily",
      sqlu"UPDATE product_rollup_state SET rolled_through = NULL, last_purge_at = NULL"
    ))
  }
}
