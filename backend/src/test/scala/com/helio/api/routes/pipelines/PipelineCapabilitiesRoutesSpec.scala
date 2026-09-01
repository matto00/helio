package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.pipelines.{ExpressionValidationResponse, NodeCapabilitiesResponse, ValidateExpressionRequest}
import com.helio.domain.{AggregateConfig, AggregateField, Aggregation, SelectConfig}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.PipelineService
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-906 (P1.3, task 3.4) — `GET /api/pipelines/:id/capabilities?stepId=`, evaluating
 *  `OutputBindingSpec` against `PipelineAnalyzeService.analyzeNodes`'s per-node projection
 *  (task 3.3). ACL uses `pipelineRepo.findByIdShared` directly (not `AccessChecker`, unlike
 *  Output CRUD) -- there is no "authenticated non-grantee sees 403" branch for pipelines, so
 *  the ACL triad here really is owner/grantee/other -> 200/200/404, matching AC 1's wording
 *  verbatim (see `OutputRoutesSpec`'s comment on why Output CRUD's triad is 200/200/403
 *  instead).
 *
 *  RLS-VACUITY NOTE (HEL-906 cycle 4): unlike `OutputRoutesSpec`, this suite's `DbContext(db,
 *  db)` uses the SAME superuser connection for both the app and privileged pool -- there is no
 *  `SET ROLE` to a non-superuser here. `pipelineRepo.findByIdShared`'s ACL check is an explicit
 *  app-level WHERE-clause predicate (JOIN through `resource_permissions`), not an RLS policy, so
 *  the ACL assertions above are still real. But this suite proves NOTHING about Postgres RLS
 *  policies specifically (`pipelines`/`pipeline_steps`/`outputs` row-level security) -- a
 *  superuser bypasses RLS unconditionally, so any RLS-enforced predicate would silently pass
 *  here even if broken. Do not cite this file as RLS evidence; see `OutputRoutesSpec`'s
 *  `helio_app_test_output_routes` non-superuser role setup for what that actually looks like. */
class PipelineCapabilitiesRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineService: PipelineService         = _

  private val ownerId   = UUID.randomUUID().toString
  private val granteeId = UUID.randomUUID().toString
  private val otherId   = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))
  private val grantee = AuthenticatedUser(UserId(granteeId))
  private val other   = AuthenticatedUser(UserId(otherId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)

    dataSourceRepo    = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo  = new PipelineStepRepository(ctx)(routeEc)
    permissionRepo    = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)(routeEc)

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($granteeId::uuid, ${s"grantee-$granteeId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherId::uuid, ${s"other-$otherId@helio.test"}, now())"""
    )))
  }

  private def routesFor(user: AuthenticatedUser): Route =
    new PipelineRoutes(pipelineService, user)(routeEc).routes

  /** A pipeline over a source with one numeric ("amount": float) and one string ("label")
   *  column, with an editor grant on the pipeline for `grantee`. */
  private def newSharedPipeline(): PipelineId = {
    val now = Instant.now()
    val source = StaticSource(
      DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now,
      inferredSchema = Vector(SchemaField("amount", "float"), SchemaField("label", "string"))
    )
    val createdSource = await(dataSourceRepo.insert(source, owner))
    val pipeline = await(pipelineRepo.create("pipe", createdSource.id, owner)).getOrElse(
      throw new IllegalStateException("newSharedPipeline fixture: pipeline create failed")
    )
    val pipelineId = PipelineId(pipeline.id)
    await(permissionRepo.insert(ResourcePermission("pipeline", pipelineId.value, Some(grantee.id), Role.Editor, now)))
    pipelineId
  }

  "GET /pipelines/:id/capabilities" should {

    "report the source (stepId absent) as metric- and chart-bindable when a numeric column is present" in {
      val pipelineId = newSharedPipeline()
      Get(s"/pipelines/${pipelineId.value}/capabilities") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[NodeCapabilitiesResponse]
        resp.stepId shouldBe None
        resp.capabilities("metric").bindable shouldBe true
        resp.capabilities("chart").bindable shouldBe true
      }
    }

    "report a tail step's dropped numeric column as metric-unbindable, independent of the trunk (CR1 in a route context)" in {
      val pipelineId = newSharedPipeline()
      val selectStep = await(pipelineStepRepo.insertInternal(
        pipelineId, "select", SelectConfig(Vector("label"))
      ))

      Get(s"/pipelines/${pipelineId.value}/capabilities?stepId=${selectStep.id.value}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[NodeCapabilitiesResponse]
        resp.stepId shouldBe Some(selectStep.id.value)
        resp.capabilities("metric").bindable shouldBe false
        resp.capabilities("metric").reason shouldBe Some("missing-required-column-type")
      }
      // The source-level projection is unaffected by the step's select -- proves the two
      // projections are independent, not a shared mutable schema.
      Get(s"/pipelines/${pipelineId.value}/capabilities") ~> routesFor(owner) ~> check {
        responseAs[NodeCapabilitiesResponse].capabilities("metric").bindable shouldBe true
      }
    }

    "a metric Output binds over a sum/avg aggregate (HEL-895/638 repro)" in {
      val pipelineId = newSharedPipeline()
      val aggStep = await(pipelineStepRepo.insertInternal(
        pipelineId, "aggregate",
        AggregateConfig(Vector.empty, Vector(Aggregation("total", "sum", "amount")))
      ))

      Get(s"/pipelines/${pipelineId.value}/capabilities?stepId=${aggStep.id.value}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[NodeCapabilitiesResponse]
        // The bug this repro guards: `aggResultType`'s sum/avg branch used to emit the
        // non-canonical "number" (never a real DataFieldType wire value), which
        // `DataFieldType.fromString` silently drops -- a sum aggregate's own output column
        // would then be ABSENT from `columns` and never counted as eligible for "value",
        // making a metric Output over a sum aggregate look unbindable.
        resp.columns.map(_.name) should contain("total")
        resp.columns.find(_.name == "total").map(_.dataType) shouldBe Some("float")
        resp.capabilities("metric").bindable shouldBe true
        resp.capabilities("metric").eligibleColumns("value") should contain("total")
      }
    }

    "a select-produced column is retained in the projected schema and stays bindable (HEL-644)" in {
      val pipelineId = newSharedPipeline()
      val selectStep = await(pipelineStepRepo.insertInternal(
        pipelineId, "select", SelectConfig(Vector("amount"))
      ))

      Get(s"/pipelines/${pipelineId.value}/capabilities?stepId=${selectStep.id.value}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[NodeCapabilitiesResponse]
        resp.columns.map(_.name) shouldBe Vector("amount")
        resp.capabilities("metric").bindable shouldBe true
        resp.capabilities("metric").eligibleColumns("value") should contain("amount")
      }
    }

    "404 an unknown stepId" in {
      val pipelineId = newSharedPipeline()
      Get(s"/pipelines/${pipelineId.value}/capabilities?stepId=${UUID.randomUUID()}") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "200 for the owner and the editor grantee, 404 for an unrelated caller (no existence leak)" in {
      val pipelineId = newSharedPipeline()
      Get(s"/pipelines/${pipelineId.value}/capabilities") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }
      Get(s"/pipelines/${pipelineId.value}/capabilities") ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
      }
      Get(s"/pipelines/${pipelineId.value}/capabilities") ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "POST /pipelines/:id/validate-expression?stepId=" should {

    "valid = true for an expression referencing a real source-level column (stepId absent)" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/validate-expression", ValidateExpressionRequest("$amount * 2")) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[ExpressionValidationResponse]
        resp.valid shouldBe true
        resp.error shouldBe None
      }
    }

    "valid = false naming the unknown field for an expression referencing a column not in the projected schema" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/validate-expression", ValidateExpressionRequest("$doesNotExist + 1")) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[ExpressionValidationResponse]
        resp.valid shouldBe false
        resp.error.get should include("doesNotExist")
      }
    }

    "validates against the NODE's own projected schema, not the source's -- a column dropped by a select step is unknown there" in {
      val pipelineId = newSharedPipeline()
      val selectStep = await(pipelineStepRepo.insertInternal(pipelineId, "select", SelectConfig(Vector("label"))))

      // "amount" still validates against the pipeline's raw source (stepId absent)...
      Post(s"/pipelines/${pipelineId.value}/validate-expression", ValidateExpressionRequest("$amount")) ~> routesFor(owner) ~> check {
        responseAs[ExpressionValidationResponse].valid shouldBe true
      }
      // ...but NOT against the select step's own projection, which dropped it.
      Post(s"/pipelines/${pipelineId.value}/validate-expression?stepId=${selectStep.id.value}", ValidateExpressionRequest("$amount")) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[ExpressionValidationResponse].valid shouldBe false
      }
    }

    "404 an unknown stepId" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/validate-expression?stepId=${UUID.randomUUID()}", ValidateExpressionRequest("$amount")) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "200 for the owner and the editor grantee, 404 for an unrelated caller (no existence leak)" in {
      val pipelineId = newSharedPipeline()
      Post(s"/pipelines/${pipelineId.value}/validate-expression", ValidateExpressionRequest("$amount")) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/pipelines/${pipelineId.value}/validate-expression", ValidateExpressionRequest("$amount")) ~> routesFor(grantee) ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/pipelines/${pipelineId.value}/validate-expression", ValidateExpressionRequest("$amount")) ~> routesFor(other) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
