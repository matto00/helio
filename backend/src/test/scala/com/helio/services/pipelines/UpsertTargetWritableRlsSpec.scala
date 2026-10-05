package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.domain.steps.{StepConfigError, UpsertMode, UpsertSourceConfig, UpsertSourceStep, UpsertTarget}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1265: the writable-dataset target check resolves the target through `findByIdOwned` as the
 *  pipeline OWNER, which is RLS-sensitive, so it is proved here under a real NOBYPASSRLS role
 *  (the `PipelineRunServiceUpsertSourceRlsSpec` two-role harness), not a superuser pool. */
class UpsertTargetWritableRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _
  private var ctx: DbContext                     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var service: PipelineService           = _

  private val owner   = UserId(UUID.randomUUID().toString)
  private val grantee = UserId(UUID.randomUUID().toString)

  import PostgresProfile.api._

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs); privCfg.setMaximumPoolSize(5); privCfg.setConnectionInitSql("SET ROLE helio_privileged")
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
    } finally superConn.close()

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs); appCfg.setMaximumPoolSize(5); appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx            = new DbContext(appDb, privilegedDb)
    dataSourceRepo = new DataSourceRepository(ctx)
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)
    service = new PipelineService(
      pipelineRepo, new PipelineStepRepository(ctx), dataSourceRepo,
      outputRepo = new OutputRepository(ctx), pipelineRootRepo = new PipelineRootRepository(ctx)
    )
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${owner.value + "@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${grantee.value}::uuid, ${grantee.value + "@test.local"}, now())"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def seed(ownerId: UserId, kind: String): DataSource = {
    val now = Instant.now(); val id = DataSourceId(UUID.randomUUID().toString)
    val schema = Vector(SchemaField("name", "string"))
    val source: DataSource = kind match {
      case "csv"     => CsvSource(id, s"csv-${id.value}", ownerId, now, now, CsvSourceConfig(s"csv/${id.value}.csv"), inferredSchema = schema)
      case "dataset" => DatasetSource(id, s"ds-${id.value}", ownerId, now, now, inferredSchema = schema)
    }
    await(dataSourceRepo.insert(source, AuthenticatedUser(ownerId)))
  }

  private def pipelineOwnedByOwner(): PipelineId = {
    val root = seed(owner, "dataset")
    val req  = CreatePipelineRequest(s"p-${UUID.randomUUID()}", Vector(CreatePipelineRootRequest(sourceId = Some(root.id.value))))
    PipelineId(await(service.create(req, AuthenticatedUser(owner))).getOrElse(fail("create failed")).id)
  }

  private def grantEditor(pid: PipelineId): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', ${pid.value}, ${grantee.value}::uuid, 'editor', now())"""))

  private def upsertReq(targetId: String): CreatePipelineStepRequest =
    CreatePipelineStepRequest("upsertsource", JsObject(
      "target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(targetId)),
      "mode"   -> JsString(UpsertMode.Append)
    ))

  private def addAs(user: UserId, pid: PipelineId, targetId: String) =
    await(service.addStep(pid, upsertReq(targetId), AuthenticatedUser(user)))

  private def stepFor(targetId: String): UpsertSourceStep =
    UpsertSourceStep(
      PipelineStepId(UUID.randomUUID().toString), PipelineId("p"), 0,
      UpsertSourceConfig(UpsertTarget.ExistingSource(targetId), UpsertMode.Append), Instant.now(), Instant.now()
    )

  private def evaluateAs(ownerId: Option[String], targetId: String): Future[Seq[Map[String, Any]]] =
    stepFor(targetId).evaluate(
      Seq(Map("name" -> "a")),
      PipelineExecutionContext(dataSourceRepo, _ => Future.successful(Seq.empty), ownerUserId = ownerId)
    )

  "the save-time check under a NOBYPASSRLS role" should {

    "accept the owner's dataset and refuse the owner's CSV with a 422 naming it" in {
      val pid = pipelineOwnedByOwner(); val ds = seed(owner, "dataset"); val csv = seed(owner, "csv")
      addAs(owner, pid, ds.id.value) shouldBe a[Right[_, _]]
      addAs(owner, pid, csv.id.value) match {
        case Left(ServiceError.UnprocessableEntity(msg)) => msg should (include(csv.id.value) and include(csv.name))
        case other                                       => fail(s"expected 422, got $other")
      }
    }

    "check a grantee-editor's target against the pipeline OWNER's sources, never the grantee's" in {
      val pid = pipelineOwnedByOwner(); grantEditor(pid)
      val ownersCsv = seed(owner, "csv"); val granteesDataset = seed(grantee, "dataset"); val ownersDataset = seed(owner, "dataset")
      addAs(grantee, pid, ownersDataset.id.value) shouldBe a[Right[_, _]]
      addAs(grantee, pid, ownersCsv.id.value) shouldBe a[Left[_, _]]
      addAs(grantee, pid, ownersCsv.id.value).left.map(_.getClass.getSimpleName) shouldBe Left("UnprocessableEntity")
      addAs(grantee, pid, granteesDataset.id.value).left.map(_.getClass.getSimpleName) shouldBe Left("NotFound")
    }

    "never reach the kind branch for a foreign or unknown id: identical 404, no name or kind disclosed" in {
      val pid = pipelineOwnedByOwner()
      val foreignCsv = seed(grantee, "csv"); val unknown = UUID.randomUUID().toString
      def probe(id: String): String = addAs(owner, pid, id) match {
        case Left(ServiceError.NotFound(msg)) => msg.replace(id, "<id>")
        case other                            => fail(s"expected NotFound, got $other")
      }
      val foreignMsg = probe(foreignCsv.id.value)
      foreignMsg shouldBe probe(unknown)
      foreignMsg should not include foreignCsv.name
      foreignMsg.toLowerCase should not include "csv"
    }
  }

  "UpsertSourceStep.evaluate under a NOBYPASSRLS role" should {

    "pass the owner's dataset target through unchanged" in {
      val ds = seed(owner, "dataset")
      await(evaluateAs(Some(owner.value), ds.id.value)) shouldBe Seq(Map("name" -> "a"))
    }

    "refuse the owner's CSV target with a StepConfigError naming it" in {
      val csv = seed(owner, "csv")
      val ex = intercept[StepConfigError](await(evaluateAs(Some(owner.value), csv.id.value)))
      ex.getMessage should (include(csv.id.value) and include(csv.name))
    }

    "fail a foreign target as a plain not-found, not a config error and without name or kind" in {
      val foreign = seed(grantee, "csv")
      val ex = intercept[IllegalArgumentException](await(evaluateAs(Some(owner.value), foreign.id.value)))
      ex shouldNot be(a[StepConfigError])
      ex.getMessage should not include foreign.name
      ex.getMessage.toLowerCase should not include "csv"
    }

    "fail closed, as a plain error, when there is no owner identity" in {
      val ds = seed(owner, "dataset")
      val ex = intercept[IllegalArgumentException](await(evaluateAs(None, ds.id.value)))
      ex shouldNot be(a[StepConfigError])
    }
  }
}
