package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model._
import com.helio.domain.steps.RenameConfig
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-906 cycle 7 (coordinator's empirical-experiment ruling): proves, against a REAL
 *  RLS-enforced (non-superuser) app-pool connection -- not the superuser-both-pools fixture
 *  `PipelineCreateTransactionalSpec` uses -- that `PipelineRepository.runTransactionally`'s
 *  composed `DBIO` chain (pipeline row + `PipelineStepRepository.insertInternalAction` +
 *  `OutputRepository.insertInternalAction`) runs successfully under
 *  `DbContext.withUserContext`, not just `withSystemContext`.
 *
 *  This was an OPEN QUESTION as of evaluation-5/6.md (cycle 5's `runTransactionally` used
 *  `withSystemContext`, an RLS-bypass, because the composed `*Internal` actions were assumed
 *  to require the privileged pool). The observed, empirical result: it works. `pipeline_steps`'
 *  `pipeline_steps_owner` RLS policy and `outputs`' `outputs_insert` `WITH CHECK` policy both
 *  key off `current_setting('app.current_user_id')`/`owner_id`, which `withUserContext` sets
 *  to the SAME user id every row in this composed chain is stamped with (`createAction`'s
 *  pipeline row, and every `insertInternalAction`'s `ownerId`/pipeline-owner lookup) -- there
 *  is no cross-user write in this specific composition, so the RLS check that would normally
 *  block a `*Internal` method's caller-supplied id never fires against a MISMATCHED id here.
 *  `PipelineRepository.runTransactionally` and `PipelineService.createTransactional` were
 *  switched to `withUserContext(user.id)` on the strength of this result -- see `design.md` D3. */
class PipelineRepositoryRunTransactionallyRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var superDb: JdbcBackend.Database        = _
  private var appDb: JdbcBackend.Database          = _
  private var ctx: DbContext                       = _
  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository     = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var outputRepo: OutputRepository         = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    superDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))

    // Real, non-superuser app-pool role -- a superuser (or `helio_privileged`/BYPASSRLS)
    // connection would make this whole experiment vacuous, since RLS is skipped entirely for
    // it regardless of `app.current_user_id`. Mirrors `OutputRoutesSpec`'s role setup exactly.
    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute("CREATE ROLE helio_app_test_runtx_rls NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN")
      stmt.execute("GRANT helio_app_test_runtx_rls TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test_runtx_rls")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test_runtx_rls")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_app_test_runtx_rls")
      stmt.close()
    } finally superConn.close()

    val appCfg = new HikariConfig()
    appCfg.setDataSource(embeddedPostgres.getPostgresDatabase)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test_runtx_rls")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx              = new DbContext(appDb, superDb)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    outputRepo       = new OutputRepository(ctx)

    await(superDb.run(
      sqlu"INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())"
    ))
  }

  override def afterAll(): Unit = {
    appDb.close(); superDb.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  "PipelineRepository.runTransactionally(userId)" should {
    "persist a pipeline row + a step (insertInternalAction) + an Output (insertInternalAction) in ONE composed DBIO chain under withUserContext, with RLS actually enforced (non-superuser app pool)" in {
      val source = StaticSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, Instant.now(), Instant.now())
      val createdSource = await(dataSourceRepo.insert(source, owner))

      val action = for {
        createResult      <- pipelineRepo.createAction("real-rls-pipeline", Vector((createdSource.id, createdSource)), owner, None)
        (summary, _)       = createResult
        _                 <- pipelineStepRepo.insertInternalAction(PipelineId(summary.id), "rename", RenameConfig(Map("a" -> "b")), explicitRootId = None)
        _                 <- outputRepo.insertInternalAction(PipelineId(summary.id), None, owner.id, "out1", OutputKind.Table, explicitRootId = None)
      } yield summary

      val summary = await(pipelineRepo.runTransactionally(owner.id.value)(action))

      await(superDb.run(sql"select count(*) from pipelines where id = ${summary.id}".as[Int].head)) shouldBe 1
      await(superDb.run(sql"select count(*) from pipeline_steps where pipeline_id = ${summary.id}".as[Int].head)) shouldBe 1
      await(superDb.run(sql"select count(*) from outputs where pipeline_id = ${summary.id}".as[Int].head)) shouldBe 1
    }
  }
}
