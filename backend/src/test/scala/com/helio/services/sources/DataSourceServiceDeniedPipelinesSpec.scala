package com.helio.services.sources

import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.domain.steps.{AnalyzeWithAiConfig, AnalyzeWithAiOutputField}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.{AutoRunTriggerService, EvaluatedPipeline}
import com.helio.services.ServiceError
import com.helio.testkit.TempDirectorySupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.{JsString, JsValue}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1096 tasks.md 3.2 (design.md D1, skeptic-design-1.md CR1/CR2, skeptic-design-2.md CR1):
 *  every one of the FOUR in-scope `DataSourceService` write methods --
 *  `appendRows`/`appendFormRow`/`replaceRows`/`patchRow` -- folds a denied downstream pipeline
 *  into its response, gated on the WRITER's own visibility/canRun, exactly like
 *  `AutoRunTriggerServiceSpec`'s lower-level coverage of the same gates. `deleteRow` is proven to
 *  stay on the OLD fire-and-forget contract (204/no-body, no denial reporting) -- confirms the
 *  exclusion is real, not merely untested. */
class DataSourceServiceDeniedPipelinesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres               = _
  private var db: JdbcBackend.Database                         = _
  private var dataSourceRepo: DataSourceRepository              = _
  private var pipelineRepo: PipelineRepository                  = _
  private var pipelineStepRepo: PipelineStepRepository          = _
  private var pipelineRootRepo: PipelineRootRepository          = _
  private var debounceRepo: PipelineAutoRunDebounceRepository   = _
  private var triggerService: AutoRunTriggerService             = _
  private var service: DataSourceService                        = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRootRepo  = new PipelineRootRepository(ctx)
    debounceRepo      = new PipelineAutoRunDebounceRepository(ctx)
    triggerService = new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo, debounceSeconds = 0L)
    val fileSystem = new LocalFileSystem(newTempDir("hel1096-denied-pipelines"))
    service = new DataSourceService(dataSourceRepo, fileSystem, autoRunTriggerService = triggerService)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def seedUser(): UserId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@test.local"}, now())"""))
    UserId(id)
  }

  private def seedGrant(pipelineId: PipelineId, granteeId: UserId, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                          VALUES ('pipeline', ${pipelineId.value}, ${granteeId.value}::uuid, $role, now())"""))
  }

  /** A `dataset`-kind source, owned by `owner`, with one declared string column `name`. */
  private def seedDataset(owner: AuthenticatedUser): DataSourceId = {
    val req = StaticDataSourceRequest(
      name    = "denial-src",
      `type`  = "dataset",
      columns = Vector(StaticColumnPayload("name", "string")),
      rows    = Vector(Vector(JsString("seed-row")))
    )
    await(service.createStatic(req, owner)).getOrElse(fail("expected Right")).id
  }

  /** A pipeline owned by `owner` reading `dsId`, with a single enabled `analyzewithai` step --
   *  always denied (design.md D1's `ai-step` reason). */
  private def seedDeniedPipeline(owner: UserId, dsId: DataSourceId): PipelineId = {
    import PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'denied-pipe', ${owner.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
             VALUES (${UUID.randomUUID().toString}, $pid, ${dsId.value}, 0)"""
    )))
    val cfg = AnalyzeWithAiConfig("name", "go", Vector(AnalyzeWithAiOutputField("sentiment", "string")))
    await(pipelineStepRepo.insertInternal(PipelineId(pid), "analyzewithai", cfg, enabled = true, parentStepId = None, explicitRootId = None))
    PipelineId(pid)
  }

  private def deniedIn(entries: Vector[EvaluatedPipeline.Denied], pipelineId: PipelineId): Option[EvaluatedPipeline.Denied] =
    entries.find(_.pipelineId == pipelineId)

  "appendRows" should {
    "folds a denied-and-visible pipeline into the response, with canRun=true for the owner writer" in {
      val owner = seedUser()
      val dsId  = seedDataset(AuthenticatedUser(owner))
      val pid   = seedDeniedPipeline(owner, dsId)

      val result = await(service.appendRows(dsId, Vector(Vector(JsString("r2"))), AuthenticatedUser(owner)))
        .getOrElse(fail("expected Right"))
      val entry = deniedIn(result.deniedPipelines, pid)
      entry shouldBe defined
      entry.get.canRun shouldBe true
      entry.get.reasons should not be empty
    }

    "omits the pipeline entirely when the writer has no grant on it at all -- proven at the " +
      "DataSourceService level (RowWriteResult.deniedPipelines), not just AutoRunTriggerService's" in {
      val owner    = seedUser()
      val stranger = seedUser()
      val dsId     = seedDataset(AuthenticatedUser(owner))
      val pid      = seedDeniedPipeline(owner, dsId)

      // `stranger` writes to their OWN second dataset, which is also a root of the SAME denied
      // pipeline (mirrors a real multi-root pipeline whose roots have different owners) -- they
      // have no grant on the pipeline itself.
      val strangerDsId = seedDataset(AuthenticatedUser(stranger))
      import PostgresProfile.api._
      await(db.run(sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
                            VALUES (${UUID.randomUUID().toString}, ${pid.value}, ${strangerDsId.value}, 1)"""))

      val result = await(service.appendRows(strangerDsId, Vector(Vector(JsString("r2"))), AuthenticatedUser(stranger)))
        .getOrElse(fail("expected Right"))
      deniedIn(result.deniedPipelines, pid) shouldBe None
    }

    "reports canRun=false with reasons still present for a VIEWER-grantee writer" in {
      val owner  = seedUser()
      val viewer = seedUser()
      val dsId   = seedDataset(AuthenticatedUser(owner))
      val pid    = seedDeniedPipeline(owner, dsId)
      seedGrant(pid, viewer, "viewer")

      // The viewer must themselves OWN the data source to reach `appendRows`'s ACL gate -- grant
      // them ownership of a second dataset that also feeds the SAME pipeline, mirroring a real
      // multi-root pipeline whose roots have different owners (design.md Context).
      val viewerDsId = seedDataset(AuthenticatedUser(viewer))
      import PostgresProfile.api._
      await(db.run(sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
                            VALUES (${UUID.randomUUID().toString}, ${pid.value}, ${viewerDsId.value}, 1)"""))

      val result = await(service.appendRows(viewerDsId, Vector(Vector(JsString("r2"))), AuthenticatedUser(viewer)))
        .getOrElse(fail("expected Right"))
      val entry = deniedIn(result.deniedPipelines, pid)
      entry shouldBe defined
      entry.get.canRun shouldBe false
      entry.get.reasons should not be empty
    }

    "reports canRun=true for an EDITOR-grantee writer" in {
      val owner  = seedUser()
      val editor = seedUser()
      val dsId   = seedDataset(AuthenticatedUser(owner))
      val pid    = seedDeniedPipeline(owner, dsId)
      seedGrant(pid, editor, "editor")

      val editorDsId = seedDataset(AuthenticatedUser(editor))
      import PostgresProfile.api._
      await(db.run(sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
                            VALUES (${UUID.randomUUID().toString}, ${pid.value}, ${editorDsId.value}, 1)"""))

      val result = await(service.appendRows(editorDsId, Vector(Vector(JsString("r2"))), AuthenticatedUser(editor)))
        .getOrElse(fail("expected Right"))
      deniedIn(result.deniedPipelines, pid).map(_.canRun) shouldBe Some(true)
    }
  }

  "appendFormRow" should {
    "folds a denied-and-visible pipeline into the response" in {
      val owner = seedUser()
      val dsId  = seedDataset(AuthenticatedUser(owner))
      val pid   = seedDeniedPipeline(owner, dsId)

      val build = (_: Vector[DatasetFieldDeclaration], _: java.time.Instant) => Right(Vector[JsValue](JsString("form-row")))
      val result = await(service.appendFormRow(dsId, build, PanelId(UUID.randomUUID().toString), AuthenticatedUser(owner)))
        .getOrElse(fail("expected Right"))
      deniedIn(result.deniedPipelines, pid) shouldBe defined
    }
  }

  "replaceRows" should {
    "reports a denial identically to appendRows" in {
      val owner = seedUser()
      val dsId  = seedDataset(AuthenticatedUser(owner))
      val pid   = seedDeniedPipeline(owner, dsId)

      val result = await(service.replaceRows(dsId, Vector(Vector(JsString("replaced"))), AuthenticatedUser(owner)))
        .getOrElse(fail("expected Right"))
      deniedIn(result.deniedPipelines, pid) shouldBe defined
    }
  }

  "patchRow" should {
    "reports a denial identically to appendRows, on RowResponse's own deniedPipelines field" in {
      val owner = seedUser()
      val dsId  = seedDataset(AuthenticatedUser(owner))
      val pid   = seedDeniedPipeline(owner, dsId)

      val appended = await(service.appendRows(dsId, Vector(Vector(JsString("to-patch"))), AuthenticatedUser(owner)))
        .getOrElse(fail("expected Right"))
      val row = appended.rows.head

      val result = await(service.patchRow(dsId, row.id, row.updatedAt.toString, Vector(JsString("patched")), AuthenticatedUser(owner)))
        .getOrElse(fail("expected Right"))
      deniedIn(result.deniedPipelines, pid) shouldBe defined
    }
  }

  "deleteRow" should {
    "stays on the OLD fire-and-forget contract -- no deniedPipelines field, the denial is only " +
      "logged (HEL-1096 owner ruling, design.md Non-Goals)" in {
      val owner = seedUser()
      val dsId  = seedDataset(AuthenticatedUser(owner))
      seedDeniedPipeline(owner, dsId)

      val appended = await(service.appendRows(dsId, Vector(Vector(JsString("to-delete"))), AuthenticatedUser(owner)))
        .getOrElse(fail("expected Right"))
      val row = appended.rows.last

      // `deleteRow`'s return type is `Future[Either[ServiceError, Unit]]` -- there is no
      // `deniedPipelines` field to assert on AT ALL, which is itself the proof: the type alone
      // makes it impossible for this call site to ever carry denial data on the wire.
      val result: Either[ServiceError, Unit] =
        await(service.deleteRow(dsId, row.id, row.updatedAt.toString, AuthenticatedUser(owner)))
      result shouldBe a[Right[_, _]]
    }
  }
}
