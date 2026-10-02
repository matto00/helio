package com.helio.services.patchsets

import com.helio.testkit.TempDirectorySupport
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.services.ServiceError
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1148 design.md D4 "Patch-set create": a patch-set `panel create` of a `form` panel must
 *  carry a `config.dataSourceId` that is caller-owned and a `dataset` source whose declared schema
 *  the form's fields fit — checked in the patch-set resolver (patch-set-specific; direct
 *  `PanelService.create` stays permissive because the builder creates unbound forms). A rejection
 *  names the edit and creates nothing. */
class PatchSetApplyFormCreateSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with TempDirectorySupport
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer = SystemMaterializer(system.toTyped).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dashboardService: DashboardService = _
  private var panelRepo: PanelRepository         = _
  private var service: PatchSetApplyService      = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))

  private var ownDatasetId     = ""
  private var foreignDatasetId = ""
  private var csvSourceId      = ""

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    val dashboardRepo    = new DashboardRepository(ctx)
    panelRepo            = new PanelRepository(ctx)
    val dataSourceRepo   = new DataSourceRepository(ctx)
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val applicationRepo  = new PatchSetApplicationRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("patch-set-form-create-spec"))

    dashboardService = new DashboardService(dashboardRepo, accessChecker)
    // Wired like production: the real PanelService has the data-source repo.
    val panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo, dataSourceRepo = dataSourceRepo)
    val dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)
    service = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo
    )

    import PostgresProfile.api._
    ownDatasetId     = UUID.randomUUID().toString
    foreignDatasetId = UUID.randomUUID().toString
    csvSourceId      = UUID.randomUUID().toString
    val schema = """[{"name":"quantity","type":"integer","required":true},{"name":"note","type":"string","required":false}]"""
    Await.result(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
             VALUES ($ownDatasetId::uuid, 'own', 'dataset', '{}'::jsonb, $userAId::uuid, now(), now(), $schema::jsonb)""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
             VALUES ($foreignDatasetId::uuid, 'foreign', 'dataset', '{}'::jsonb, $userBId::uuid, now(), now(), $schema::jsonb)""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($csvSourceId::uuid, 'csv', 'csv', '{"path":"csv/test.csv"}'::jsonb, $userAId::uuid, now(), now())"""
    )), 10.seconds)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val goodFields = """[{"sourceField":"quantity","control":"number","step":1,"required":true}]"""

  private def formCreate(dashboardId: String, config: Option[String]): PatchSet = {
    val configField = config.map(c => s""","config":$c""").getOrElse("")
    val patch = s"""{"dashboardId":"$dashboardId","title":"Patch Form","type":"form"$configField}""".parseJson.asJsObject
    PatchSet(None, Vector(Edit(EditTarget("panel", None), "create", None, None, None, None, None, Some(patch))))
  }

  private def formConfig(dataSourceId: String, fields: String = goodFields): String =
    s"""{"dataSourceId":"$dataSourceId","fields":$fields,"submit":{"writeMode":"append"}}"""

  private def panelCountOn(dashboardId: DashboardId): Int = {
    import PostgresProfile.api._
    val id = dashboardId.value
    await(db.run(sql"""SELECT count(*) FROM panels WHERE dashboard_id = $id""".as[Int].head))
  }

  private def rejected(patchSet: PatchSet, dashboardId: DashboardId): ServiceError = {
    val result = await(service.apply(patchSet, userA))
    panelCountOn(dashboardId) shouldBe 0
    result.left.getOrElse(fail(s"expected a rejection, got $result"))
  }

  private def newDashboard(): DashboardId =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Patch Form Dashboard")), userA))._1.id

  "PatchSetApplyService with a form panel create" should {

    "create a form bound to a caller-owned dataset source" in {
      val dashboardId = newDashboard()
      await(service.apply(formCreate(dashboardId.value, Some(formConfig(ownDatasetId))), userA)) match {
        case Right(_)  => panelCountOn(dashboardId) shouldBe 1
        case Left(err) => fail(s"expected success, got $err")
      }
    }

    "reject a form with no config at all, naming the edit and dataSourceId" in {
      val dashboardId = newDashboard()
      rejected(formCreate(dashboardId.value, None), dashboardId) should matchPattern {
        case ServiceError.BadRequest(m) if m.startsWith("edit 0:") && m.contains("dataSourceId") =>
      }
    }

    "reject a form whose config has an empty dataSourceId" in {
      val dashboardId = newDashboard()
      rejected(formCreate(dashboardId.value, Some(formConfig(""))), dashboardId) should matchPattern {
        case ServiceError.BadRequest(m) if m.startsWith("edit 0:") && m.contains("dataSourceId") =>
      }
    }

    "reject another tenant's dataset source, naming the edit" in {
      val dashboardId = newDashboard()
      rejected(formCreate(dashboardId.value, Some(formConfig(foreignDatasetId))), dashboardId) should matchPattern {
        case ServiceError.NotFound(m) if m.startsWith("edit 0:") && m.contains("Data source not found") =>
      }
    }

    "reject a nonexistent source identically to a foreign one" in {
      val dashboardId = newDashboard()
      rejected(formCreate(dashboardId.value, Some(formConfig(UUID.randomUUID().toString))), dashboardId) should matchPattern {
        case ServiceError.NotFound(m) if m.startsWith("edit 0:") && m.contains("Data source not found") =>
      }
    }

    "reject a non-dataset source" in {
      val dashboardId = newDashboard()
      rejected(formCreate(dashboardId.value, Some(formConfig(csvSourceId))), dashboardId) should matchPattern {
        case ServiceError.BadRequest(m) if m.startsWith("edit 0:") && m.contains("dataset") =>
      }
    }

    "reject a field the bound dataset does not declare" in {
      val dashboardId = newDashboard()
      val bad = formConfig(ownDatasetId, """[{"sourceField":"nope","control":"text"}]""")
      rejected(formCreate(dashboardId.value, Some(bad)), dashboardId) should matchPattern {
        case ServiceError.BadRequest(m) if m.startsWith("edit 0:") && m.contains("nope") =>
      }
    }
  }
}
