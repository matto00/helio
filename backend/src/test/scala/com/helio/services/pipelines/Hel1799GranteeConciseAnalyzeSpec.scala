package com.helio.services.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines.{ConciseAnalyzeNode, PipelineAnalyzeConciseResponse, PipelineAnalyzeResponse}
import com.helio.domain.model._
import com.helio.domain.steps.{ComputeConfig, SortConfig, SortKey}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
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

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1799: `analyzeConcise` (the helio-mcp `analyze_pipeline` path) judges a non-owner's step validity by the pipeline
 *  owner's root schemas, like the full analyze route after HEL-1661, with no new schema data and neutral text.
 *  Same two-role `helio_app_test` (NOSUPERUSER NOBYPASSRLS) harness as `Hel1661GranteeAnalyzeVerdictSpec`. */
class Hel1799GranteeConciseAnalyzeSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with JsonProtocols {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var pg: EmbeddedPostgres                = _
  private var appDb: JdbcBackend.Database         = _
  private var privDb: JdbcBackend.Database        = _
  private var stepRepo: PipelineStepRepository    = _
  private var svc: PipelineService                = _

  override def beforeAll(): Unit = {
    pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val superDs = pg.getPostgresDatabase
    Flyway.configure().dataSource(pg.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
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
    val dsRepo   = new DataSourceRepository(ctx)
    stepRepo     = new PipelineStepRepository(ctx)
    val pipelineRepo = new PipelineRepository(ctx, dsRepo)
    val outRepo  = new OutputRepository(ctx)
    svc          = new PipelineService(pipelineRepo, stepRepo, dsRepo, outputRepo = outRepo)
  }

  override def afterAll(): Unit = {
    appDb.close(); privDb.close(); pg.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)
  private def priv[T](a: DBIO[T]): T = await(privDb.run(a))

  private val Schema = """[{"name":"amount","type":"float"},{"name":"flag","type":"boolean"}]"""
  private val Rows   = """{"columns":[{"name":"amount","type":"double"},{"name":"flag","type":"boolean"}],"rows":[[1.0,true],[2.0,false],[3.0,true]]}"""
  private val Leaky  = Seq("amount", "flag", "float", "boolean")

  private final case class Fx(pid: PipelineId, owner: AuthenticatedUser, editor: AuthenticatedUser, viewer: AuthenticatedUser, stranger: AuthenticatedUser) {
    def grantees: Seq[(String, AuthenticatedUser)] = Seq("editor" -> editor, "viewer" -> viewer)
  }

  private def seedUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    priv(sqlu"""INSERT INTO users (id, email, display_name, created_at, updated_at)
                VALUES ($id::uuid, ${"u-" + id + "@example.test"}, 'U', now(), now())""")
    AuthenticatedUser(UserId(id))
  }

  /** kind: "csv" | "dataset". `step`: "compute" (expression) or "sort" (sort on the absent field `nope`). */
  private def seedFixture(kind: String, step: String, expression: String = ""): Fx = {
    import PostgresProfile.api._
    val owner = seedUser()
    val dsId  = UUID.randomUUID().toString
    val pid   = UUID.randomUUID().toString
    val name  = s"secret-source-name-$dsId"
    val config = if (kind == "csv") s"""{"path":"csv/$dsId.csv"}""" else "{}"
    priv(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, $name, $kind, $config::jsonb, ${owner.id.value}::uuid, now(), now())""",
      sqlu"UPDATE data_sources SET inferred_schema = $Schema::jsonb WHERE id = $dsId",
      sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner.id.value}::uuid, now(), now())",
      sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"
    ))
    if (kind == "dataset") priv(DatasetRowsTestSupport.seedActionsFromRaw(dsId, Rows))
    val p = PipelineId(pid)
    if (step == "sort") await(stepRepo.insertInternal(p, "sort", SortConfig(Vector(SortKey("nope", "asc"))), true, None, explicitRootId = None))
    else await(stepRepo.insertInternal(p, "compute", ComputeConfig("out", expression, None), true, None, explicitRootId = None))
    val Seq(ed, vw, st) = Seq(seedUser(), seedUser(), seedUser())
    for ((who, role) <- Seq(ed -> "editor", vw -> "viewer"))
      priv(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                  VALUES ('pipeline', $pid, ${who.id.value}::uuid, $role, now())""")
    Fx(p, owner, ed, vw, st)
  }

  private def concise(fx: Fx, who: AuthenticatedUser): PipelineAnalyzeConciseResponse = {
    val r = await(svc.analyzeConcise(fx.pid, who))
    withClue(s"analyzeConcise got $r: ") { r.isRight shouldBe true }
    r.toOption.get
  }
  private def full(fx: Fx, who: AuthenticatedUser): PipelineAnalyzeResponse = await(svc.analyze(fx.pid, who)).toOption.get
  private def errors(r: PipelineAnalyzeConciseResponse): Vector[Option[String]] = r.nodes.map(_.validationError)

  "the app pool" should {
    "[PIN] be a NOSUPERUSER NOBYPASSRLS role, so RLS applies to every analyzeConcise below" in {
      import PostgresProfile.api._
      val flags = await(appDb.run(sql"SELECT r.rolbypassrls, r.rolsuper FROM pg_roles r WHERE r.rolname = current_user".as[(Boolean, Boolean)])).head
      flags shouldBe ((false, false))
      await(appDb.run(sql"SELECT current_user".as[String])).head shouldBe "helio_app_test"
    }
  }

  "analyzeConcise for a step valid against the owner's schema" should {
    "[DEFECT] report no validationError for the owner, an editor and a viewer on a CSV root" in {
      val fx = seedFixture("csv", "compute", "$amount * 2")
      withClue("owner: ") { errors(concise(fx, fx.owner)) shouldBe Vector(None) }
      for ((who, u) <- fx.grantees) withClue(s"$who: ") { errors(concise(fx, u)) shouldBe Vector(None) }
    }

    "[DEFECT] report no validationError for an editor and a viewer on a dataset root" in {
      val fx = seedFixture("dataset", "compute", "$amount * 2")
      withClue("owner: ") { errors(concise(fx, fx.owner)) shouldBe Vector(None) }
      for ((who, u) <- fx.grantees) withClue(s"$who: ") { errors(concise(fx, u)) shouldBe Vector(None) }
    }
  }

  "analyzeConcise for a step invalid against the owner's schema" should {
    "[DEFECT] keep the owner's typed message and give a grantee a neutral one naming no column or type" in {
      val fx = seedFixture("csv", "compute", "$flag AND $amount")
      val o = concise(fx, fx.owner).nodes.head.validationError
      withClue(s"owner error $o: ") { (o.exists(_.contains("boolean")) && o.exists(_.contains("float"))) shouldBe true }
      for ((who, u) <- fx.grantees) withClue(s"$who: ") {
        val err = concise(fx, u).nodes.head.validationError
        withClue(s"grantee error $err: ") { err.isDefined shouldBe true }
        for (t <- Leaky) err.get should not include t
      }
    }
  }

  "a grantee's concise response" should {
    "[PIN] carry no source name, no key beyond nodes/path/op/validationError/warnings (so no row count), and no warnings; and [DEFECT] no root column or type" in {
      for (fx <- Seq(seedFixture("csv", "compute", "$flag AND $amount"), seedFixture("csv", "compute", "$amount * 2"))) {
        for ((who, u) <- fx.grantees) withClue(s"$who: ") {
          val r = concise(fx, u)
          val js = r.toJson
          val text = js.compactPrint
          text should not include "secret-source-name"
          js.asJsObject.fields.keySet shouldBe Set("nodes")
          for (n <- js.asJsObject.fields("nodes").asInstanceOf[JsArray].elements)
            n.asJsObject.fields.keySet.subsetOf(Set("path", "op", "validationError", "warnings")) shouldBe true
          r.nodes.flatMap(_.warnings) shouldBe Vector.empty
          for (t <- Leaky) withClue("[DEFECT] column/type leak: ") { text should not include t }
        }
      }
    }

    "[PIN] be NotFound with the exact message for a stranger" in {
      val fx = seedFixture("csv", "compute", "$amount * 2")
      await(svc.analyzeConcise(fx.pid, fx.stranger)) shouldBe Left(ServiceError.NotFound(s"Pipeline not found: ${fx.pid.value}"))
    }
  }

  "analyzeConcise warnings" should {
    "[PIN] stay caller-view: the owner's names the input columns, a grantee's carries none of them" in {
      val fx = seedFixture("csv", "sort")
      val o = concise(fx, fx.owner)
      withClue("owner baseline (leak-shaped warning): ") {
        o.nodes.head.validationError shouldBe None
        o.nodes.head.warnings.exists(_.exists(_.contains("amount"))) shouldBe true
      }
      for ((who, u) <- fx.grantees) withClue(s"$who: ") {
        val r = concise(fx, u)
        r.nodes.head.validationError shouldBe None
        r.nodes.head.warnings shouldBe None
        for (t <- Leaky) r.toJson.compactPrint should not include t
      }
    }
  }

  "analyzeConcise and analyze" should {
    "[DEFECT] agree per step on validationError for every caller and fixture" in {
      val fxs = Seq(seedFixture("csv", "compute", "$amount * 2"), seedFixture("dataset", "compute", "$amount * 2"),
                    seedFixture("csv", "compute", "$flag AND $amount"), seedFixture("csv", "sort"))
      for (fx <- fxs; (who, u) <- Seq("owner" -> fx.owner) ++ fx.grantees) withClue(s"$who: ") {
        errors(concise(fx, u)) shouldBe full(fx, u).steps.map(_.validationError)
      }
    }
  }
}
