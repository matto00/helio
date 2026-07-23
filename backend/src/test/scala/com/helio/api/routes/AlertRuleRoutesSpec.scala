package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{AlertRuleResponse, AlertRulesResponse, JsonProtocols}
import com.helio.domain.{AuthenticatedUser, UserId}
import com.helio.infrastructure.{AlertRuleRepository, DataTypeRepository, DbContext}
import com.helio.services.AlertRuleService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-447 — HTTP-layer coverage for `/api/alert-rules`: happy-path CRUD,
 *  cross-user ownership failures, and 404/422 for a non-existent/non-owned
 *  target DataType on create. */
class AlertRuleRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var alertRuleRepo: AlertRuleRepository = _
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
    db            = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx       = new DbContext(db, db)(routeEc)
    alertRuleRepo = new AlertRuleRepository(ctx)(routeEc)
    dataTypeRepo  = new DataTypeRepository(ctx)(routeEc)
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

  private def seedDataType(ownerId: String): String = {
    import PostgresProfile.api._
    val dtId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, 'TestType', '[]', 1, $ownerId::uuid, now(), now())"""
    ))
    dtId
  }

  private def routesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new AlertRuleService(alertRuleRepo, dataTypeRepo)
    new AlertRuleRoutes(service, user)(typedSystem).routes
  }

  private def createBody(targetDataTypeId: String, name: String = "My Rule"): JsObject =
    JsObject(
      "targetDataTypeId" -> JsString(targetDataTypeId),
      "metric"           -> JsString("count"),
      "condition"        -> JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(5)),
      "severity"         -> JsString("warning"),
      "name"             -> JsString(name)
    )

  /** Creates a rule owned by `user` targeting `dtId` and returns its id. */
  private def createRule(user: AuthenticatedUser, dtId: String): String = {
    var id: String = null
    Post("/alert-rules", createBody(dtId)) ~> routesFor(user) ~> check {
      status shouldBe StatusCodes.Created
      id = responseAs[AlertRuleResponse].id
    }
    id
  }

  // ── Create ──────────────────────────────────────────────────────────────

  "POST /alert-rules" should {

    "create a rule and return 201 with the full rule" in {
      val dtId = seedDataType(ownerAId)
      Post("/alert-rules", createBody(dtId)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[AlertRuleResponse]
        resp.targetDataTypeId shouldBe dtId
        resp.metric shouldBe "count"
        resp.severity shouldBe "warning"
        resp.enabled shouldBe true
      }
    }

    "normalize an absent `enabled` field to true" in {
      val dtId = seedDataType(ownerAId)
      val body = JsObject(createBody(dtId).fields) // no "enabled" key present
      Post("/alert-rules", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[AlertRuleResponse].enabled shouldBe true
      }
    }

    "round-trip condition unchanged, including unknown/extra keys" in {
      val dtId = seedDataType(ownerAId)
      val condition = JsObject(
        "comparator" -> JsString("lte"),
        "threshold"  -> JsNumber(3),
        "window"     -> JsString("15m"),
        "futureKey"  -> JsArray(JsString("a"), JsString("b"))
      )
      val body = JsObject(createBody(dtId).fields + ("condition" -> condition))
      var createdId: String = null
      Post("/alert-rules", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[AlertRuleResponse]
        resp.condition shouldBe condition
        createdId = resp.id
      }
      Get(s"/alert-rules/$createdId") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AlertRuleResponse].condition shouldBe condition
      }
    }

    "return 422 for a non-existent targetDataTypeId" in {
      Post("/alert-rules", createBody(UUID.randomUUID().toString)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "return 422 for a targetDataTypeId owned by a different user" in {
      val dtId = seedDataType(ownerBId)
      Post("/alert-rules", createBody(dtId)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }
  }

  // ── List ────────────────────────────────────────────────────────────────

  "GET /alert-rules" should {

    "return an empty list when the user has no rules" in {
      Get("/alert-rules") ~> routesFor(AuthenticatedUser(UserId(UUID.randomUUID().toString))) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AlertRulesResponse].items shouldBe empty
      }
    }

    "return only the caller's rules" in {
      val dtIdA = seedDataType(ownerAId)
      val dtIdB = seedDataType(ownerBId)
      createRule(userA, dtIdA)
      createRule(userB, dtIdB)

      Get("/alert-rules") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[AlertRulesResponse].items
        items.map(_.targetDataTypeId) should contain(dtIdA)
        items.map(_.targetDataTypeId) should not contain dtIdB
      }
    }
  }

  // ── Get / Patch / Delete + ACL ─────────────────────────────────────────────

  "GET /alert-rules/:id" should {

    "return 200 for the owner" in {
      val dtId = seedDataType(ownerAId)
      val id   = createRule(userA, dtId)
      Get(s"/alert-rules/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "return 404 for an unknown id" in {
      Get(s"/alert-rules/${UUID.randomUUID().toString}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 403 or 404 for a cross-user caller (not the rule contents)" in {
      val dtId = seedDataType(ownerAId)
      val id   = createRule(userA, dtId)
      Get(s"/alert-rules/$id") ~> routesFor(userB) ~> check {
        status should (be(StatusCodes.NotFound) or be(StatusCodes.Forbidden))
      }
    }
  }

  "PATCH /alert-rules/:id" should {

    "apply only the provided fields" in {
      val dtId = seedDataType(ownerAId)
      val id   = createRule(userA, dtId)
      Patch(s"/alert-rules/$id", JsObject("enabled" -> JsBoolean(false))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AlertRuleResponse]
        resp.enabled shouldBe false
        resp.metric shouldBe "count"
      }
    }

    "return 403 or 404 for a cross-user caller and not mutate the rule" in {
      val dtId = seedDataType(ownerAId)
      val id   = createRule(userA, dtId)
      Patch(s"/alert-rules/$id", JsObject("enabled" -> JsBoolean(false))) ~> routesFor(userB) ~> check {
        status should (be(StatusCodes.NotFound) or be(StatusCodes.Forbidden))
      }
      Get(s"/alert-rules/$id") ~> routesFor(userA) ~> check {
        responseAs[AlertRuleResponse].enabled shouldBe true
      }
    }

    "return 404 for an unknown id" in {
      Patch(s"/alert-rules/${UUID.randomUUID().toString}", JsObject("enabled" -> JsBoolean(false))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "DELETE /alert-rules/:id" should {

    "return 204 for the owner and remove the rule" in {
      val dtId = seedDataType(ownerAId)
      val id   = createRule(userA, dtId)
      Delete(s"/alert-rules/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Get(s"/alert-rules/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 403 or 404 for a cross-user caller and leave the rule in place" in {
      val dtId = seedDataType(ownerAId)
      val id   = createRule(userA, dtId)
      Delete(s"/alert-rules/$id") ~> routesFor(userB) ~> check {
        status should (be(StatusCodes.NotFound) or be(StatusCodes.Forbidden))
      }
      Get(s"/alert-rules/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "return 404 for an unknown id" in {
      Delete(s"/alert-rules/${UUID.randomUUID().toString}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
