package com.helio.infrastructure.persistence

import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsNumber, JsObject}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-910 task 1.3: RLS smoke for the public-dashboard row-read path (task 1.1's new
 *  `GET /dashboards/:dashboardId/panels/:panelId/rows` route). `PublicDashboardRoutes` itself
 *  reads `outputs`/`node_snapshots` via `findByIdInternal`/`listRowsPaged`, both on the
 *  privileged (RLS-bypassing) pool -- the app-layer `authorizeResourceWithSharing("dashboard",
 *  ...)` gate is the actual authority for that route (design.md Decision 2). This spec proves
 *  the defense-in-depth layer underneath: `helio_can_access_pipeline` (V39), which gates
 *  `outputs_select`/`node_snapshots_select` (V94), has NO anonymous branch (its own header
 *  comment: "No anonymous path for pipelines: NULL or empty means no access") -- so even if a
 *  future change accidentally routed a public read through the non-privileged pool instead of
 *  `withSystemContext`, RLS would still deny it unconditionally. Runs as a real non-superuser,
 *  non-BYPASSRLS role (`helio_app_test`, mirrors `RlsSharingAwareTablesSpec`'s pattern) against a
 *  real Postgres instance -- not a mock.
 *
 *  Iron Law (systematic-debugging: red before trusted): the "denied" assertion is proven
 *  non-vacuous by first showing the SAME query returns a row for the owning user (SET
 *  app.current_user_id), then dropping `outputs_select`/`node_snapshots_select` on a disposable
 *  instance and showing that owner-positive assertion itself goes red -- proving the assertions
 *  are actually driven by the RLS policy, not trivially always-empty. */
class PublicPathRlsSmokeSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var superDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database = _
  private var ctx: DbContext = _

  private var pipelineId: PipelineId = _
  private var outputId: String = _
  private val ownerId = UUID.randomUUID().toString

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def createAppTestRole(superDs: javax.sql.DataSource): Unit = {
    val conn = superDs.getConnection
    try {
      val stmt = conn.createStatement()
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
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_pipeline(TEXT) TO helio_app_test")
      stmt.close()
    } finally conn.close()
  }

  /** Seeds a real source -> pipeline -> output -> snapshot chain via the actual repositories
   *  (not hand-written SQL) so this spec cannot drift from the live schema. Returns the seeded
   *  `PipelineId` and `OutputId`. */
  private def seedPipelineWithOutput(db: JdbcBackend.Database): (PipelineId, String) = {
    val privCtx = new DbContext(db, db)(ec)
    val dataSourceRepo = new DataSourceRepository(privCtx)(ec)
    val pipelineRepo   = new PipelineRepository(privCtx, dataSourceRepo)(ec)
    val outputRepo     = new OutputRepository(privCtx)(ec)
    val nodeSnapshotRepo = new NodeSnapshotRepository(privCtx)(ec)

    val owner = AuthenticatedUser(UserId(ownerId))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"$ownerId@test.local"}, now())
                         ON CONFLICT DO NOTHING"""))
    val now = java.time.Instant.now()
    val source = StaticSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now)
    val createdSource = await(dataSourceRepo.insert(source, owner))
    val pipeline = await(pipelineRepo.create("pipe", Vector(createdSource.id), owner)).getOrElse(
      throw new IllegalStateException("seedPipelineWithOutput fixture: pipeline create failed")
    )
    val pid = PipelineId(pipeline.id)
    val output = await(outputRepo.insertInternal(pid, None, owner.id, "out", OutputKind.Table, explicitRootId = None))
    await(nodeSnapshotRepo.overwriteRows(pid.value, None, Seq(JsObject("a" -> JsNumber(1))), explicitRootId = None))
    (pid, output.id.value)
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    superDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
    ctx = new DbContext(superDb, superDb)(ec)
    createAppTestRole(embeddedPostgres.getPostgresDatabase)
    val (pid, oid) = seedPipelineWithOutput(superDb)
    pipelineId = pid
    outputId = oid

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
    val appCfg = new HikariConfig()
    appCfg.setDataSource(embeddedPostgres.getPostgresDatabase)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))
  }

  override def afterAll(): Unit = {
    appDb.close(); superDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  "helio_can_access_pipeline (V39/V94) via a non-superuser role" should {

    "deny outputs/node_snapshots reads with no app.current_user_id set (anonymous)" in {
      await(appDb.run(sqlu"RESET app.current_user_id"))
      val outputCount = await(appDb.run(sql"""SELECT count(*) FROM outputs WHERE id = $outputId""".as[Int].head))
      val snapshotCount = await(appDb.run(sql"""SELECT count(*) FROM node_snapshots WHERE pipeline_id = ${pipelineId.value}""".as[Int].head))
      outputCount shouldBe 0
      snapshotCount shouldBe 0
    }

    "allow the owning user to see their own output/snapshot (proves the anonymous denial above is real, not vacuous)" in {
      await(appDb.run(sqlu"SET app.current_user_id = '#$ownerId'"))
      val outputCount = await(appDb.run(sql"""SELECT count(*) FROM outputs WHERE id = $outputId""".as[Int].head))
      val snapshotCount = await(appDb.run(sql"""SELECT count(*) FROM node_snapshots WHERE pipeline_id = ${pipelineId.value}""".as[Int].head))
      outputCount shouldBe 1
      snapshotCount shouldBe 1
    }
  }

  "Regression-guard sanity check (Iron Law: red before trusted)" should {

    "the owner-positive assertion above goes red once outputs_select/node_snapshots_select are dropped" in {
      val probePostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        Flyway.configure()
          .dataSource(probePostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
          .locations("classpath:db/migration")
          .load().migrate()
        val probeSuperDb = JdbcBackend.Database.forDataSource(probePostgres.getPostgresDatabase, Some(5))
        try {
          createAppTestRole(probePostgres.getPostgresDatabase)
          val (probePid, probeOid) = seedPipelineWithOutput(probeSuperDb)

          import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
          val probeAppCfg = new HikariConfig()
          probeAppCfg.setDataSource(probePostgres.getPostgresDatabase)
          probeAppCfg.setMaximumPoolSize(5)
          probeAppCfg.setConnectionInitSql("SET ROLE helio_app_test")
          val probeAppDb = JdbcBackend.Database.forDataSource(new HikariDataSource(probeAppCfg), Some(5))
          try {
            await(probeAppDb.run(sqlu"SET app.current_user_id = '#$ownerId'"))
            val before = await(probeAppDb.run(sql"""SELECT count(*) FROM outputs WHERE id = $probeOid""".as[Int].head))
            withClue("Sanity: owner sees own output before dropping the policy: ") {
              before shouldBe 1
            }

            await(probeSuperDb.run(sqlu"DROP POLICY outputs_select ON outputs"))
            await(probeSuperDb.run(sqlu"DROP POLICY node_snapshots_select ON node_snapshots"))

            val after = await(probeAppDb.run(sql"""SELECT count(*) FROM outputs WHERE id = $probeOid""".as[Int].head))
            withClue("Expected the owner-positive assertion to go red after dropping outputs_select: ") {
              after shouldBe 0
            }
          } finally probeAppDb.close()
        } finally probeSuperDb.close()
      } finally probePostgres.close()
    }
  }
}
