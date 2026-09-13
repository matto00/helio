package com.helio.infrastructure.persistence.sources

import com.helio.domain.model._
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.{JsValue, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1100 task 3.7 (Standing Constraint C1): `applyWriteBacks` writes under a NOBYPASSRLS,
 *  non-superuser role -- the app pool this repository's `withUserContext` actually uses in
 *  production. Follows `RlsSharingAwareTablesSpec`'s established harness (superuser Flyway,
 *  `helio_app_test` non-BYPASSRLS role for the app pool, `helio_privileged` for the privileged
 *  pool) rather than the superuser-pool convention most OTHER integration specs in this file's
 *  package use -- a superuser-connection pass is explicitly NOT evidence for this claim
 *  (design.md Risks / C1). */
class DataSourceRepositoryApplyWriteBacksRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var privilegedDb: JdbcBackend.Database   = _
  private var appDb: JdbcBackend.Database          = _
  private var ctx: DbContext                       = _
  private var dataSourceRepo: DataSourceRepository = _
  private var stepRepo: PipelineStepRepository     = _

  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)

  import PostgresProfile.api._

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway.configure().dataSource(superJdbc, "postgres", "postgres").locations("classpath:db/migration").load().migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx            = new DbContext(appDb, privilegedDb)
    dataSourceRepo = new DataSourceRepository(ctx)
    stepRepo       = new PipelineStepRepository(ctx)

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${ownerA.value}::uuid, ${ownerA.value + "@test.local"}, now()) ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${ownerB.value}::uuid, ${ownerB.value + "@test.local"}, now()) ON CONFLICT DO NOTHING"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedTargetDs(owner: UserId): String = {
    val dsId    = UUID.randomUUID().toString
    val payload = """{"columns":[{"name":"name","type":"string"}],"rows":[]}"""
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds-target', 'dataset', '{}', ${owner.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload)
    )))
    dsId
  }

  private def rowCount(dsId: String): Int =
    await(ctx.withSystemContext(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $dsId".as[Int].head))

  "applyWriteBacks, run under a NOBYPASSRLS role" should {
    "land the write when the target is owned by the acting owner" in {
      val targetId = seedTargetDs(ownerA)
      val write = PendingWrite("s1", UpsertSourceConfig(UpsertTarget.ExistingSource(targetId), UpsertMode.Append), Seq(Map("name" -> "alice")))

      val result = await(dataSourceRepo.applyWriteBacks(AuthenticatedUser(ownerA), Vector(write), stepRepo, maxRows = 500))

      result shouldBe Right(())
      rowCount(targetId) shouldBe 1
    }

    "never write to a target owned by a DIFFERENT user, even though the row genuinely exists (RLS backstop)" in {
      val foreignTargetId = seedTargetDs(ownerB)
      val write = PendingWrite("s1", UpsertSourceConfig(UpsertTarget.ExistingSource(foreignTargetId), UpsertMode.Append), Seq(Map("name" -> "mallory")))

      val result = await(dataSourceRepo.applyWriteBacks(AuthenticatedUser(ownerA), Vector(write), stepRepo, maxRows = 500))

      result shouldBe a[Left[_, _]]
      rowCount(foreignTargetId) shouldBe 0
    }

    // skeptic-final-1.md non-blocking note: the test above is rejected by `writeExistingDatasetAction`'s
    // own app-level `ownerId` filter before RLS is ever consulted (it queries
    // `WHERE id = ? AND owner_id = ?`, which is false for a foreign id regardless of RLS). This
    // test instead calls the lower-level `appendRowsAction` DIRECTLY under
    // `ctx.withUserContext(ownerA)` -- that method has NO ownerId filter of its own (it queries
    // `data_sources` by id alone); the ONLY thing that can hide a foreign row from it is the
    // FORCEd RLS policy itself, on the app (non-BYPASSRLS) pool.
    "the FORCEd RLS policy ALONE (not the application ownerId filter) blocks a direct row-write action against a foreign id" in {
      val foreignTargetId = seedTargetDs(ownerB)
      val rows: Vector[Vector[JsValue]] = Vector(Vector(JsString("mallory")))

      val result = await(ctx.withUserContext(ownerA.value)(
        dataSourceRepo.appendRowsAction(DataSourceId(foreignTargetId), rows, maxRows = 500, updatedAt = Instant.now())
      ))

      // `appendRowsAction` has no app-level ownerId check -- a `None` here (its own
      // documented "source not found" contract) can ONLY be explained by RLS hiding the row
      // from ownerA's GUC-scoped session, since the row unquestionably exists (seeded by the
      // privileged pool above).
      result shouldBe None
      rowCount(foreignTargetId) shouldBe 0
    }
  }
}
