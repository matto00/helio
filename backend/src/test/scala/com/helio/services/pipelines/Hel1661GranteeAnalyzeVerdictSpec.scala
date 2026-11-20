package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{AnalyzeStepResponse, CostReasonResponse, PipelineAnalyzeResponse}
import com.helio.domain.model._
import com.helio.domain.steps.ComputeConfig
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api.DBIO
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1661: `analyze` judges a pipeline by its definition for every admitted caller, and an editor's analyze agrees
 *  with the auto-run trigger. Runs the service as a NOSUPERUSER NOBYPASSRLS role `helio_app_test` (two-role harness of `FormSubmitEditorRlsSpec`, shape of
 *  `Hel1516GranteeDriftPreviewSpec`); seeding and measuring use the privileged pool.
 *
 *  Pipelines (every root and every pipeline owned by one owner; callers: owner, editor, viewer, stranger):
 *  (a) CSV root + compute `$amount * 2`; (b) dataset root with 3 rows + compute; (c) URL-backed CSV root;
 *  (d) CSV root + compute `$flag AND $amount` (invalid for the owner: boolean AND float);
 *  (e) dataset root + compute `$amount * 2` (valid for the owner). */
class Hel1661GranteeAnalyzeVerdictSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var pg: EmbeddedPostgres                = _
  private var appDb: JdbcBackend.Database         = _
  private var privDb: JdbcBackend.Database        = _
  private var dsRepo: DataSourceRepository        = _
  private var stepRepo: PipelineStepRepository    = _
  private var pipelineRepo: PipelineRepository    = _
  private var svc: PipelineService                = _
  private var trigger: AutoRunTriggerService      = _

  override def beforeAll(): Unit = {
    pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val superDs = pg.getPostgresDatabase
    Flyway.configure().dataSource(pg.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    // The two-role `helio_app_test` harness of `FormSubmitEditorRlsSpec`: the app pool is a NOSUPERUSER NOBYPASSRLS role,
    // the privileged pool is `helio_privileged`; seeding and measuring use the privileged pool.
    val sc = superDs.getConnection
    try {
      val st = sc.createStatement()
      st.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin)
      st.execute("GRANT helio_app_test TO postgres")
      st.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      st.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      st.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO helio_app_test")
      st.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      st.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      st.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      st.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      st.close()
    } finally sc.close()
    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs); appCfg.setMaximumPoolSize(5); appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))
    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs); privCfg.setMaximumPoolSize(5); privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))
    val ctx = new DbContext(appDb, privDb)
    dsRepo       = new DataSourceRepository(ctx)
    stepRepo     = new PipelineStepRepository(ctx)
    pipelineRepo = new PipelineRepository(ctx, dsRepo)
    val outRepo  = new OutputRepository(ctx)
    svc          = new PipelineService(pipelineRepo, stepRepo, dsRepo, outputRepo = outRepo)
    trigger      = new AutoRunTriggerService(new PipelineRootRepository(ctx), pipelineRepo, stepRepo, dsRepo, new PipelineAutoRunDebounceRepository(ctx))
  }

  override def afterAll(): Unit = {
    appDb.close(); privDb.close(); pg.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)
  private def priv[T](a: DBIO[T]): T = await(privDb.run(a))

  private val Schema = """[{"name":"amount","type":"float"},{"name":"flag","type":"boolean"}]"""
  private val Rows   = """{"columns":[{"name":"amount","type":"double"},{"name":"flag","type":"boolean"}],"rows":[[1.0,true],[2.0,false],[3.0,true]]}"""

  private final case class Fx(pid: PipelineId, dsId: String, owner: AuthenticatedUser, editor: AuthenticatedUser, viewer: AuthenticatedUser, stranger: AuthenticatedUser)

  private def seedUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    priv(sqlu"""INSERT INTO users (id, email, display_name, created_at, updated_at)
                VALUES ($id::uuid, ${"u-" + id + "@example.test"}, 'U', now(), now())""")
    AuthenticatedUser(UserId(id))
  }

  /** kind: "csv" | "csv-url" | "dataset". */
  private def seedFixture(kind: String, expression: String): Fx = {
    import PostgresProfile.api._
    val owner = seedUser()
    val dsId  = UUID.randomUUID().toString
    val pid   = UUID.randomUUID().toString
    val name  = s"secret-source-name-$dsId"
    val config = kind match {
      case "csv"     => s"""{"path":"csv/$dsId.csv"}"""
      case "csv-url" => s"""{"path":"csv/$dsId.csv","sourceUrl":"https://example.test/secret-feed.csv"}"""
      case _         => "{}"
    }
    val srcType = if (kind == "dataset") "dataset" else "csv"
    priv(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, $name, $srcType, $config::jsonb, ${owner.id.value}::uuid, now(), now())""",
      sqlu"UPDATE data_sources SET inferred_schema = $Schema::jsonb WHERE id = $dsId",
      sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner.id.value}::uuid, now(), now())",
      sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"
    ))
    if (kind == "dataset") priv(DatasetRowsTestSupport.seedActionsFromRaw(dsId, Rows))
    val p = PipelineId(pid)
    await(stepRepo.insertInternal(p, "compute", ComputeConfig("out", expression, None), true, None, explicitRootId = None))
    val Seq(ed, vw, st) = Seq(seedUser(), seedUser(), seedUser())
    for ((who, role) <- Seq(ed -> "editor", vw -> "viewer"))
      priv(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                  VALUES ('pipeline', $pid, ${who.id.value}::uuid, $role, now())""")
    Fx(p, dsId, owner, ed, vw, st)
  }

  private def analyze(fx: Fx, who: AuthenticatedUser): PipelineAnalyzeResponse = {
    val r = await(svc.analyze(fx.pid, who))
    withClue(s"analyze got $r: ") { r.isRight shouldBe true }
    r.toOption.get
  }

  private def codes(r: PipelineAnalyzeResponse): Vector[String] = r.costVerdict.reasons.map(_.code)
  private def stepErrors(r: PipelineAnalyzeResponse): Vector[Option[String]] = r.steps.map(validationOf)
  private def validationOf(s: AnalyzeStepResponse): Option[String] = s.validationError
  private def estimatorReasons(r: PipelineAnalyzeResponse): Vector[CostReasonResponse] = r.costVerdict.reasons.filterNot(_.code == "step-config-invalid")

  private def markRun(fx: Fx, rows: Long): Unit = {
    import PostgresProfile.api._
    priv(sqlu"UPDATE pipelines SET last_run_row_count = $rows, last_run_status = 'succeeded', last_run_at = now() WHERE id = ${fx.pid.value}")
  }

  "the app pool" should {
    "[PIN] be a NOSUPERUSER NOBYPASSRLS role, so RLS applies to every analyze below" in {
      import PostgresProfile.api._
      val flags = await(appDb.run(sql"SELECT r.rolbypassrls, r.rolsuper FROM pg_roles r WHERE r.rolname = current_user".as[(Boolean, Boolean)])).head
      flags shouldBe ((false, false))
      await(appDb.run(sql"SELECT current_user".as[String])).head shouldBe "helio_app_test"
    }
  }

  "analyze for a CSV root the caller does not own (a)" should {
    "[DEFECT] give an editor and a viewer the owner's codes and autoRunnable, no unclassified-source, no step error" in {
      val fx = seedFixture("csv", "$amount * 2")
      val o = analyze(fx, fx.owner); val e = analyze(fx, fx.editor); val v = analyze(fx, fx.viewer)
      withClue("owner baseline: ") { o.costVerdict.reasons.map(_.code) should not contain "step-config-invalid" }
      for ((who, r) <- Seq("editor" -> e, "viewer" -> v)) withClue(s"$who: ") {
        codes(r) shouldBe codes(o)
        codes(r) should not contain "unclassified-source"
        codes(r) should not contain "step-config-invalid"
        r.costVerdict.autoRunnable shouldBe o.costVerdict.autoRunnable
        stepErrors(r) shouldBe Vector(None)
      }
      e.costVerdict.canRun shouldBe o.costVerdict.canRun
      e.costVerdict.canRun shouldBe true
      v.costVerdict.canRun shouldBe false
    }

    "[PIN] keep a grantee's caller-view fields exactly as written: blank source name, no fields, no root column in step schemas" in {
      val fx = seedFixture("csv", "$amount * 2")
      for (who <- Seq(fx.editor, fx.viewer)) {
        val r = analyze(fx, who)
        r.sourceSchemas.map(s => (s.dataSourceName, s.sourceSchema)) shouldBe Vector(("", Vector.empty))
        r.steps.flatMap(s => s.inputSchema.map(_.name)) shouldBe Vector.empty
        r.steps.flatMap(s => s.outputSchema.map(_.name)) shouldBe Vector("out")
        r.warnings shouldBe Vector.empty
      }
      val o = analyze(fx, fx.owner)
      o.sourceSchemas.head.dataSourceName should startWith("secret-source-name-")
      o.sourceSchemas.head.sourceSchema.map(_.name) shouldBe Vector("amount", "flag")
    }

    "[PIN] answer a stranger NotFound" in {
      val fx = seedFixture("csv", "$amount * 2")
      val r = await(svc.analyze(fx.pid, fx.stranger))
      r.left.toOption.exists(_.isInstanceOf[ServiceError.NotFound]) shouldBe true
    }
  }

  "analyze for a step valid only against the owner's schema (d)" should {
    "[DEFECT] flag it for a grantee with a neutral sentence that names no column or type, and keep the owner's typed message" in {
      val fx = seedFixture("csv", "$flag AND $amount")
      val o = analyze(fx, fx.owner)
      o.steps.head.validationError.exists(_.contains("got boolean and float")) shouldBe true
      for (who <- Seq(fx.editor, fx.viewer)) {
        val r = analyze(fx, who)
        val err = r.steps.head.validationError
        withClue(s"grantee step error $err: ") { err.isDefined shouldBe true }
        val detail = r.costVerdict.reasons.find(_.code == "step-config-invalid").map(_.detail)
        detail shouldBe err
        for (text <- Seq(err.get, detail.get)) {
          text should not include "float"
          text should not include "boolean"
          text should not include "amount"
          text should not include "flag"
        }
        // whole response minus the step's own config (which a grantee already reads from the steps route)
        val whole = r.copy(steps = Vector.empty).toString
        whole should not include "float"
        r.costVerdict.canRun shouldBe false
        r.costVerdict.autoRunnable shouldBe false
      }
    }
  }

  "a grantee's reason detail" should {
    "[DEFECT] be neutral for a URL-backed root (c), while the owner keeps the kind and URL wording" in {
      val fx = seedFixture("csv-url", "$amount * 2")
      val o = analyze(fx, fx.owner)
      o.costVerdict.reasons.find(_.code == "remote-fetch").map(_.detail).exists(_.contains("URL-backed source ('csv')")) shouldBe true
      for (who <- Seq(fx.editor, fx.viewer)) {
        val r = analyze(fx, who)
        codes(r) shouldBe codes(o)
        val details = estimatorReasons(r).map(_.detail)
        details should not be empty
        for (d <- details) {
          d should not include "csv"
          d.toLowerCase should not include "url"
          d.toLowerCase should not include "remote source"
          d.exists(_.isDigit) shouldBe false
          d should not include "'"
        }
        estimatorReasons(r).find(_.code == "remote-fetch").map(_.detail) should not be o.costVerdict.reasons.find(_.code == "remote-fetch").map(_.detail)
      }
    }
  }

  "estimatedRows" should {
    "[GUARD, red against a D1-only implementation] be the dataset row count for the owner but absent for a grantee on a never-run pipeline (b)(e), then the last-run count" in {
      for (expr <- Seq("$amount * 2", "$amount + 1")) {
        val fx = seedFixture("dataset", expr)
        analyze(fx, fx.owner).costVerdict.estimatedRows shouldBe Some(3L)
        for (who <- Seq(fx.editor, fx.viewer)) analyze(fx, who).costVerdict.estimatedRows shouldBe None
        markRun(fx, 7L)
        for (who <- Seq(fx.owner, fx.editor, fx.viewer)) analyze(fx, who).costVerdict.estimatedRows shouldBe Some(7L)
      }
    }
  }

  "an editor's dataset write" should {
    "[DEFECT] be evaluated by the trigger as analyze reports it to that editor, for (e) and (b)" in {
      for (expr <- Seq("$amount * 2", "$amount + 1")) {
        val fx = seedFixture("dataset", expr)
        val r = analyze(fx, fx.editor)
        val evaluated = await(trigger.triggerAutoRun(DataSourceId(fx.dsId), fx.editor, Instant.now())).collect {
          case a: EvaluatedPipeline.Allowed if a.pipelineId == fx.pid => Vector.empty[String]
          case d: EvaluatedPipeline.Denied if d.pipelineId == fx.pid  => d.reasons.map(_.code)
        }
        withClue(s"trigger result $evaluated, analyze ${codes(r)}: ") {
          evaluated.size shouldBe 1
          evaluated.head shouldBe codes(r)
          (evaluated.head.isEmpty) shouldBe r.costVerdict.autoRunnable
        }
        codes(r) should not contain "unclassified-source"
        codes(r) should not contain "step-config-invalid"
      }
    }
  }
}
