package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{CreateMetricRequest, ErrorResponse, JsonProtocols, MetricResponse}
import com.helio.domain._
import com.helio.infrastructure.{DataTypeRepository, DbContext, MetricRepository}
import com.helio.services.MetricService
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

/** HEL-493 — HTTP-layer coverage for `/api/metrics`: happy-path CRUD +
 *  pagination envelope, each create/update validation rejection (dataTypeId
 *  ownership/shape, measureField/allowedDimensions membership, aggregation
 *  allow-list, empty name), PATCH absent-vs-null semantics, and cross-user
 *  404s. Mirrors `AlertRuleRoutesSpec`'s embedded-Postgres shape. */
class MetricRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var metricRepo: MetricRepository       = _
  private var dataTypeRepo: DataTypeRepository   = _

  private val ownerAId = UUID.randomUUID().toString
  private val ownerBId = UUID.randomUUID().toString
  private val userA    = AuthenticatedUser(UserId(ownerAId))
  private val userB    = AuthenticatedUser(UserId(ownerBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db          = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx     = new DbContext(db, db)(routeEc)
    metricRepo  = new MetricRepository(ctx)(routeEc)
    dataTypeRepo = new DataTypeRepository(ctx)(routeEc)
    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerAId::uuid, ${s"a-$ownerAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerBId::uuid, ${s"b-$ownerBId@helio.test"}, now())"""
    )))
  }

  /** Fresh, isolated user for tests that assert exact counts/membership —
   *  the suite shares one embedded database across every test case (no
   *  per-test `cleanDb`, mirroring `AlertRuleRoutesSpec`), so `userA`/`userB`
   *  accumulate metrics from earlier cases. */
  private def seedFreshUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  /** Pipeline-output DataType (`sourceId = None`) owned by `owner`, with
   *  `revenue`/`region` fields — the shape every happy-path test binds to. */
  private def seedPipelineOutputDataType(owner: UserId): DataType = {
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "TestType",
      fields    = Vector(
        DataField("revenue", "Revenue", "number", nullable = false),
        DataField("region", "Region", "string", nullable = false)
      ),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner
    )
    await(dataTypeRepo.insert(dt, AuthenticatedUser(owner)))
  }

  /** A source-linked DataType (`sourceId` defined) — used by the
   *  non-pipeline-output rejection test. Requires a real `data_sources` row
   *  for the FK. */
  private def seedSourceLinkedDataType(owner: UserId): DataType = {
    import PostgresProfile.api._
    val sourceId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at)
             VALUES ($sourceId, 'TestSource', 'static', '{}', now(), now())"""
    ))
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = Some(DataSourceId(sourceId)),
      name      = "SourceLinkedType",
      fields    = Vector(DataField("revenue", "Revenue", "number", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner
    )
    await(dataTypeRepo.insert(dt, AuthenticatedUser(owner)))
  }

  private def routesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new MetricService(metricRepo, dataTypeRepo)
    new MetricRoutes(service, user)(typedSystem).routes
  }

  private def createBody(
      dataTypeId: String,
      name: String = "Total Revenue",
      measureField: String = "revenue",
      aggregation: String = "sum",
      allowedDimensions: Vector[String] = Vector("region"),
      description: Option[String] = Some("A test metric")
  ): CreateMetricRequest =
    CreateMetricRequest(
      dataTypeId        = dataTypeId,
      name              = name,
      description       = description,
      measureField      = measureField,
      aggregation       = aggregation,
      allowedDimensions = allowedDimensions,
      format            = None
    )

  /** Creates a metric owned by `user` bound to `dtId` and returns the full response. */
  private def createMetric(user: AuthenticatedUser, dtId: String): MetricResponse = {
    var resp: MetricResponse = null
    Post("/metrics", createBody(dtId)) ~> routesFor(user) ~> check {
      status shouldBe StatusCodes.Created
      resp = responseAs[MetricResponse]
    }
    resp
  }

  // ── Create — happy path ────────────────────────────────────────────────────

  "POST /metrics" should {

    "create a metric and return 201 with the full metric" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      Post("/metrics", createBody(dt.id.value)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[MetricResponse]
        resp.dataTypeId        shouldBe dt.id.value
        resp.name              shouldBe "Total Revenue"
        resp.measureField      shouldBe "revenue"
        resp.aggregation       shouldBe "sum"
        resp.allowedDimensions shouldBe Vector("region")
        resp.description       shouldBe Some("A test metric")
        resp.deprecated        shouldBe false
        resp.ownerId            shouldBe ownerAId
      }
    }

    "return 422 for a dataTypeId not owned by the caller" in {
      val dt = seedPipelineOutputDataType(UserId(ownerBId))
      Post("/metrics", createBody(dt.id.value)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "return 422 for a dataTypeId that does not resolve to any DataType" in {
      Post("/metrics", createBody(UUID.randomUUID().toString)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "return 422 for a dataTypeId that is not pipeline-output (sourceId defined)" in {
      val dt = seedSourceLinkedDataType(UserId(ownerAId))
      Post("/metrics", createBody(dt.id.value)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "return 422 when measureField is not a field of the bound DataType" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      Post("/metrics", createBody(dt.id.value, measureField = "does-not-exist")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "return 422 when an allowedDimensions entry is not a field of the bound DataType" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      Post("/metrics", createBody(dt.id.value, allowedDimensions = Vector("region", "does-not-exist"))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "return 422 for an aggregation outside the allow-list" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      Post("/metrics", createBody(dt.id.value, aggregation = "median")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "return 400 for an empty name" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      Post("/metrics", createBody(dt.id.value, name = "   ")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("name")
      }
    }
  }

  // ── List ────────────────────────────────────────────────────────────────

  "GET /metrics" should {

    "return an empty paginated envelope when the user has no metrics" in {
      Get("/metrics") ~> routesFor(AuthenticatedUser(UserId(UUID.randomUUID().toString))) ~> check {
        status shouldBe StatusCodes.OK
        val result = responseAs[PagedResult[MetricResponse]]
        result.items shouldBe empty
        result.total shouldBe 0
      }
    }

    "return only the caller's own metrics, wrapped in the PagedResult envelope" in {
      val freshA = seedFreshUser()
      val freshB = seedFreshUser()
      val dtA = seedPipelineOutputDataType(freshA.id)
      val dtB = seedPipelineOutputDataType(freshB.id)
      createMetric(freshA, dtA.id.value)
      createMetric(freshA, dtA.id.value)
      createMetric(freshB, dtB.id.value)

      Get("/metrics") ~> routesFor(freshA) ~> check {
        status shouldBe StatusCodes.OK
        val result = responseAs[PagedResult[MetricResponse]]
        result.items.map(_.dataTypeId) should contain only dtA.id.value
        result.items should have size 2
        result.total shouldBe 2
        result.offset shouldBe 0
      }
    }
  }

  // ── Get / Patch / Delete + ACL ─────────────────────────────────────────────

  "GET /metrics/:id" should {

    "return 200 for the owner" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Get(s"/metrics/${m.id}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[MetricResponse].id shouldBe m.id
      }
    }

    "return 404 for an unknown id" in {
      Get(s"/metrics/${UUID.randomUUID().toString}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for a metric owned by a different user" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Get(s"/metrics/${m.id}") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "PATCH /metrics/:id" should {

    "apply only the provided fields, leaving an absent field unchanged" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Patch(s"/metrics/${m.id}", JsObject("name" -> JsString("Renamed"))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[MetricResponse]
        resp.name        shouldBe "Renamed"
        resp.description shouldBe m.description
      }
    }

    "clear description on explicit null" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      m.description shouldBe defined
      Patch(s"/metrics/${m.id}", JsObject("description" -> JsNull)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[MetricResponse].description shouldBe None
      }
    }

    "leave description unchanged when absent from the patch body" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Patch(s"/metrics/${m.id}", JsObject("measureField" -> JsString("revenue"))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[MetricResponse].description shouldBe m.description
      }
    }

    "replace format whole on an object value, and clear it on explicit null" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      val fmt = JsObject("unit" -> JsString("USD"), "decimals" -> JsNumber(2))
      Patch(s"/metrics/${m.id}", JsObject("format" -> fmt)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[MetricResponse]
        resp.format.unit     shouldBe Some("USD")
        resp.format.decimals shouldBe Some(2)
      }
      Patch(s"/metrics/${m.id}", JsObject("format" -> JsNull)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[MetricResponse]
        resp.format shouldBe MetricFormat(None, None, None, None)
      }
    }

    "return 422 for a patched aggregation outside the allow-list, without modifying the metric" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Patch(s"/metrics/${m.id}", JsObject("aggregation" -> JsString("median"))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      Get(s"/metrics/${m.id}") ~> routesFor(userA) ~> check {
        responseAs[MetricResponse].aggregation shouldBe "sum"
      }
    }

    // `dataTypeId` itself is not patchable (design.md Decision 3), so the
    // "non-owned/non-pipeline-output dataTypeId" rejection can only be
    // exercised on create (covered above) — PATCH re-validates
    // measureField/allowedDimensions/aggregation against the metric's
    // existing (unchanged) dataTypeId instead, exercised here for
    // measureField/allowedDimensions.
    "return 422 for a patched measureField not in the bound DataType's fields, without modifying the metric" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Patch(s"/metrics/${m.id}", JsObject("measureField" -> JsString("does-not-exist"))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      Get(s"/metrics/${m.id}") ~> routesFor(userA) ~> check {
        responseAs[MetricResponse].measureField shouldBe "revenue"
      }
    }

    "return 422 for a patched allowedDimensions entry not in the bound DataType's fields, without modifying the metric" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Patch(s"/metrics/${m.id}", JsObject("allowedDimensions" -> JsArray(JsString("does-not-exist")))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      Get(s"/metrics/${m.id}") ~> routesFor(userA) ~> check {
        responseAs[MetricResponse].allowedDimensions shouldBe m.allowedDimensions
      }
    }

    "return 404 for an unknown id" in {
      Patch(s"/metrics/${UUID.randomUUID().toString}", JsObject("name" -> JsString("X"))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for a cross-user caller and not mutate the metric" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Patch(s"/metrics/${m.id}", JsObject("name" -> JsString("Hijacked"))) ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/metrics/${m.id}") ~> routesFor(userA) ~> check {
        responseAs[MetricResponse].name shouldBe m.name
      }
    }
  }

  "DELETE /metrics/:id" should {

    "return 204 for the owner and remove the metric" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Delete(s"/metrics/${m.id}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Get(s"/metrics/${m.id}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for a cross-user caller and leave the metric in place" in {
      val dt = seedPipelineOutputDataType(UserId(ownerAId))
      val m  = createMetric(userA, dt.id.value)
      Delete(s"/metrics/${m.id}") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/metrics/${m.id}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "return 404 for an unknown id" in {
      Delete(s"/metrics/${UUID.randomUUID().toString}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
