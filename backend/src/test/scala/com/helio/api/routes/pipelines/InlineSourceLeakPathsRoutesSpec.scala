package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineTransactionalOutputRequest}
import com.helio.api.protocols.sources.{RestApiConfigPayload, StaticColumnPayload, StaticDataPayload}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.{DataSourceService, ImplicitConnectorConfig, SourceService}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1475: the inline-source leak paths HEL-1469 left open, through the real pipeline routes. Every case counts
 *  `data_sources` and `connectors` rows by the exact test owner id before and after: the leak is invisible in
 *  a response. `PipelineRootRepository.add` is fault-injected where the real failure (a concurrent pipeline
 *  delete, a DB error) cannot be reproduced deterministically. */
class InlineSourceLeakPathsRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var route: Route                         = _
  private var dataSourceRepo: DataSourceRepository = _
  private var connectorRepo: ConnectorRepository   = _
  private var service: PipelineService             = _

  @volatile private var beforeAdd: () => Future[Unit] = () => Future.unit
  @volatile private var failAdd                       = false

  private val owner: AuthenticatedUser = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  override def beforeAll(): Unit = {
    import PostgresProfile.api._
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    implicit val ec: ExecutionContext = routeEc
    val ctx = new DbContext(db, db)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    connectorRepo  = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    val rootRepo = new PipelineRootRepository(ctx)(routeEc) {
      override def add(pipelineId: PipelineId, dataSourceId: DataSourceId, user: AuthenticatedUser): Future[PipelineRoot] =
        beforeAdd().flatMap { _ =>
          if (failAdd) Future.failed(new IllegalStateException("boom: pipelineRootRepo.add")) else super.add(pipelineId, dataSourceId, user)
        }
    }
    val rest = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Right(JsArray(JsObject("amount" -> JsNumber(1)))))))
    service = new PipelineService(
      pipelineRepo, new PipelineStepRepository(ctx)(routeEc), dataSourceRepo,
      outputRepo = new OutputRepository(ctx)(routeEc), pipelineRootRepo = rootRepo,
      sourceService = new SourceService(dataSourceRepo, rest, connectorRepo = connectorRepo),
      dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("inline-source-leak-paths-routes-spec")), connectorRepo = connectorRepo)
    )(routeEc)
    route = Route.seal(new PipelineRoutes(service, owner).routes)
    val id = owner.id.value
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def count(table: String): Int = {
    import PostgresProfile.api._
    val id = owner.id.value
    await(db.run(sql"SELECT count(*) FROM #$table WHERE owner_id = $id::uuid".as[Int])).head
  }
  private def sources(): Int    = count("data_sources")
  private def connectors(): Int = count("connectors")

  private def datasetRoot(): CreatePipelineRootRequest =
    CreatePipelineRootRequest(
      `type`       = Some("dataset"),
      name         = Some(s"inline-${UUID.randomUUID()}"),
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))))
    )

  private def bareUrlRestRoot(): CreatePipelineRootRequest =
    CreatePipelineRootRequest(
      `type`     = Some("rest_api"),
      name       = Some(s"rest-${UUID.randomUUID()}"),
      restConfig = Some(RestApiConfigPayload(url = Some("http://example.invalid/data"), method = Some("GET")))
    )

  private def existingDataset(): DataSourceId = {
    val now = Instant.now()
    await(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "existing", owner.id, now, now, inferredSchema = Vector(SchemaField("amount", "float"))), owner)).id
  }

  private def pipelineOn(source: DataSourceId): String = {
    var pid = ""
    Post("/pipelines", CreatePipelineRequest(s"p-${UUID.randomUUID()}", Vector(CreatePipelineRootRequest(sourceId = Some(source.value))))) ~> route ~> check {
      status shouldBe StatusCodes.Created
      pid = responseAs[JsObject].fields("id").convertTo[String]
    }
    pid
  }

  private def rootCount(pipelineId: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM pipeline_roots WHERE pipeline_id = $pipelineId".as[Int])).head
  }

  private val badMappingOutput =
    CreatePipelineTransactionalOutputRequest(None, "metric", "o", config = Some(JsObject("fieldMapping" -> JsObject("value" -> JsString("does_not_exist")))))

  "POST /pipelines/:id/roots with an inline root (HEL-1475 path 1)" should {

    "leave no data source when the root insert fails after the inline source was created (500)" in {
      val pid = pipelineOn(existingDataset())
      val sourcesBefore = sources()
      failAdd = true
      try Post(s"/pipelines/$pid/roots", datasetRoot()) ~> route ~> check { status shouldBe StatusCodes.InternalServerError }
      finally failAdd = false
      sources() shouldBe sourcesBefore
      rootCount(pid) shouldBe 1
    }

    // Evidence for the ticket's named trigger: a fresh inline id has no inbound write edge, so the cycle guard cannot
    // reach it. Not a leak -- the request is accepted and nothing is left over.
    "NOT hit the cycle guard for a fresh inline source on a pipeline that has an upsertsource write target (accepted, 201)" in {
      val readSource = existingDataset()
      val writeTarget = existingDataset()
      val pid = pipelineOn(readSource)
      import PostgresProfile.api._
      val stepId = UUID.randomUUID().toString
      val rootId = await(db.run(sql"SELECT id FROM pipeline_roots WHERE pipeline_id = $pid LIMIT 1".as[String].head))
      val cfg    = s"""{"target":{"kind":"existingSource","dataSourceId":"${writeTarget.value}"},"mode":"append"}"""
      await(db.run(sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
                          VALUES ($stepId, $pid, 0, 'upsertsource', $cfg::text, now(), now(), $rootId)"""))
      val sourcesBefore = sources()
      Post(s"/pipelines/$pid/roots", datasetRoot()) ~> route ~> check { status shouldBe StatusCodes.Created }
      sources() shouldBe sourcesBefore + 1
      rootCount(pid) shouldBe 2
    }
  }

  "a bare-url REST inline root's implicit Connector (HEL-1475 path 2)" should {

    "be removed with its source when single-call create fails after the root was created (400)" in {
      val sourcesBefore = sources(); val connectorsBefore = connectors()
      Post("/pipelines", CreatePipelineRequest("p", Vector(bareUrlRestRoot()), outputs = Vector(badMappingOutput))) ~> route ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("does_not_exist")
      }
      sources() shouldBe sourcesBefore
      connectors() shouldBe connectorsBefore
    }

    "be removed with its source when addRoot fails after the root was created (500)" in {
      val pid = pipelineOn(existingDataset())
      val sourcesBefore = sources(); val connectorsBefore = connectors()
      failAdd = true
      try Post(s"/pipelines/$pid/roots", bareUrlRestRoot()) ~> route ~> check { status shouldBe StatusCodes.InternalServerError }
      finally failAdd = false
      sources() shouldBe sourcesBefore
      connectors() shouldBe connectorsBefore
    }

    // GUARD (green before the fix): an explicitly named Connector is never the helper's to delete.
    "never remove an explicitly named Connector when the inline source naming it is compensated (guard)" in {
      val (cname, cfg, plain, credName) = ImplicitConnectorConfig.forLegacySource("Explicit", "http://example.invalid", RestApiAuth.NoAuth)
      val explicit = await(connectorRepo.create(owner.id, cname, DataSourceKind.RestApi, "http://example.invalid", cfg, plain, credName))
      val named = CreatePipelineRootRequest(
        `type` = Some("rest_api"), name = Some(s"named-${UUID.randomUUID()}"),
        restConfig = Some(RestApiConfigPayload(connectorId = Some(explicit.id.value), endpoint = Some("/data"), method = Some("GET")))
      )
      val sourcesBefore = sources(); val connectorsBefore = connectors()
      Post("/pipelines", CreatePipelineRequest("p", Vector(named), outputs = Vector(badMappingOutput))) ~> route ~> check { status shouldBe StatusCodes.BadRequest }
      sources() shouldBe sourcesBefore
      connectors() shouldBe connectorsBefore
      await(connectorRepo.findByIdOwned(explicit.id, owner)) should not be empty
    }

    // HEL-1497 (owner Q3, narrowing HEL-1475's "explicit Connector is never removed"): an UNREFERENCED, unadopted
    // Auto Connector named by connectorId is removed with the compensated source; a user-created one is not (above).
    "remove an unreferenced, unadopted Auto Connector named by connectorId when its inline source is compensated (HEL-1497)" in {
      val (cname, cfg, plain, credName) = ImplicitConnectorConfig.forLegacySource(s"Auto: leftover-${UUID.randomUUID()}", "http://example.invalid", RestApiAuth.NoAuth)
      val leftover = await(connectorRepo.create(owner.id, cname, DataSourceKind.RestApi, "http://example.invalid", cfg, plain, credName))
      val named = CreatePipelineRootRequest(
        `type` = Some("rest_api"), name = Some(s"named-${UUID.randomUUID()}"),
        restConfig = Some(RestApiConfigPayload(connectorId = Some(leftover.id.value), endpoint = Some("/data"), method = Some("GET")))
      )
      val sourcesBefore = sources()
      Post("/pipelines", CreatePipelineRequest("p", Vector(named), outputs = Vector(badMappingOutput))) ~> route ~> check { status shouldBe StatusCodes.BadRequest }
      sources() shouldBe sourcesBefore
      await(connectorRepo.findByIdOwned(leftover.id, owner)) shouldBe empty
    }

    // Red before the fix on the source count (addRoot never compensated); the Connector assertion is the dependents guard.
    "keep the Auto Connector when a second source references it, while still removing the call-created source" in {
      val pid = pipelineOn(existingDataset())
      val connectorsBefore = connectors()
      beforeAdd = () => {
        val autoId = await(connectorIdOfLatestAuto())
        val now    = Instant.now()
        val cfg    = RestApiConfig(connectorId = autoId, endpoint = "/data", method = "GET", queryParams = QueryParams(Vector.empty), headers = Map.empty, body = None, bodyContentType = None, rootSelector = None, parameters = Map.empty)
        dataSourceRepo.insert(RestSource(DataSourceId(UUID.randomUUID().toString), "second-referrer", owner.id, now, now, cfg), owner).map(_ => ())
      }
      failAdd = true
      val sourcesBefore = sources()
      try Post(s"/pipelines/$pid/roots", bareUrlRestRoot()) ~> route ~> check { status shouldBe StatusCodes.InternalServerError }
      finally { failAdd = false; beforeAdd = () => Future.unit }
      sources() shouldBe sourcesBefore + 1
      connectors() shouldBe connectorsBefore + 1
    }
  }

  private def connectorIdOfLatestAuto(): Future[String] = {
    import PostgresProfile.api._
    val id = owner.id.value
    db.run(sql"SELECT id FROM connectors WHERE owner_id = $id::uuid AND name LIKE 'Auto: %' ORDER BY created_at DESC LIMIT 1".as[String].head)
  }
}
