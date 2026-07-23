package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{AlertEventResponse, AlertEventsResponse, JsonProtocols}
import com.helio.domain._
import com.helio.infrastructure.{AlertEventRepository, AlertRuleRepository, DataTypeRepository, DbContext}
import com.helio.services.AlertEventService
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

/** HEL-455 — HTTP-layer coverage for `/api/alerts`: list w/ `?state=`
 *  (including expired-snooze), get, acknowledge/snooze/resolve happy paths,
 *  409 on illegal transition, 404 on unknown id, 404 for a cross-user
 *  caller. */
class AlertEventRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database                = _
  private var alertEventRepo: AlertEventRepository    = _
  private var alertRuleRepo: AlertRuleRepository       = _
  private var dataTypeRepo: DataTypeRepository         = _

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
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)(routeEc)
    alertEventRepo = new AlertEventRepository(ctx)(routeEc)
    alertRuleRepo  = new AlertRuleRepository(ctx)(routeEc)
    dataTypeRepo   = new DataTypeRepository(ctx)(routeEc)
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

  private def routesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new AlertEventService(alertEventRepo)
    new AlertEventRoutes(service, user)(typedSystem).routes
  }

  /** Seeds a DataType + AlertRule + firing AlertEvent owned by `ownerId`
   *  (via the privileged upsert path — no HTTP endpoint creates events; that
   *  is HEL-466's engine callsite). Returns the event id. */
  private def seedFiringEvent(ownerId: String): String = {
    val user = AuthenticatedUser(UserId(ownerId))
    val now  = Instant.now()
    val dt = await(dataTypeRepo.insert(
      DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "MyType",
        fields    = Vector(DataField("value", "Value", "integer", nullable = false)),
        version   = 1,
        createdAt = now,
        updatedAt = now,
        ownerId   = UserId(ownerId)
      ),
      user
    ))
    val rule = await(alertRuleRepo.insert(
      AlertRule(
        id               = AlertRuleId(UUID.randomUUID().toString),
        ownerId          = UserId(ownerId),
        targetDataTypeId = dt.id,
        metric           = "count",
        condition        = JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(5)),
        name             = "My Rule",
        enabled          = true,
        severity         = Severity.Warning,
        createdAt        = now,
        updatedAt        = now
      ),
      user
    ))
    val event = await(alertEventRepo.upsertFiringInternal(
      rule.id, UserId(ownerId), dt.id, JsNumber(10), Some("run-1"), Severity.Warning
    ))
    event.id.value
  }

  // ── List ────────────────────────────────────────────────────────────────

  "GET /alerts" should {

    "return an empty list when the user has no events" in {
      Get("/alerts") ~> routesFor(AuthenticatedUser(UserId(UUID.randomUUID().toString))) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AlertEventsResponse].items shouldBe empty
      }
    }

    "return only the caller's events" in {
      val idA = seedFiringEvent(ownerAId)
      val idB = seedFiringEvent(ownerBId)

      Get("/alerts") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[AlertEventsResponse].items
        items.map(_.id) should contain(idA)
        items.map(_.id) should not contain idB
      }
    }

    "filter by state" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/resolve") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }

      Get("/alerts?state=resolved") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AlertEventsResponse].items.map(_.id) should contain(id)
      }
      Get("/alerts?state=firing") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AlertEventsResponse].items.map(_.id) should not contain id
      }
    }

    "include an expired-snoozed event in ?state=firing" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/snooze", JsObject("snoozedUntil" -> JsString(Instant.now().minusSeconds(3600).toString))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }

      Get("/alerts?state=firing") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AlertEventsResponse].items.map(_.id) should contain(id)
      }
    }

    "exclude a not-yet-expired-snoozed event from ?state=firing" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/snooze", JsObject("snoozedUntil" -> JsString(Instant.now().plusSeconds(3600).toString))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }

      Get("/alerts?state=firing") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AlertEventsResponse].items.map(_.id) should not contain id
      }
    }
  }

  // ── Get + ACL ───────────────────────────────────────────────────────────

  "GET /alerts/:id" should {

    "return 200 for the owner" in {
      val id = seedFiringEvent(ownerAId)
      Get(s"/alerts/$id") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[AlertEventResponse].state shouldBe "firing"
      }
    }

    "return 404 for an unknown id" in {
      Get(s"/alerts/${UUID.randomUUID().toString}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 403 or 404 for a cross-user caller (not the event contents)" in {
      val id = seedFiringEvent(ownerAId)
      Get(s"/alerts/$id") ~> routesFor(userB) ~> check {
        status should (be(StatusCodes.NotFound) or be(StatusCodes.Forbidden))
      }
    }
  }

  // ── Acknowledge ─────────────────────────────────────────────────────────

  "POST /alerts/:id/acknowledge" should {

    "return 200 with state=acknowledged for the owner" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/acknowledge") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AlertEventResponse]
        resp.state shouldBe "acknowledged"
        resp.acknowledgedAt shouldBe defined
      }
    }

    "return 409 for an illegal transition and leave the event unchanged" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/resolve") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/alerts/$id/acknowledge") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Conflict
      }
      Get(s"/alerts/$id") ~> routesFor(userA) ~> check {
        responseAs[AlertEventResponse].state shouldBe "resolved"
      }
    }

    "return 403 or 404 for a cross-user caller and not mutate the event" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/acknowledge") ~> routesFor(userB) ~> check {
        status should (be(StatusCodes.NotFound) or be(StatusCodes.Forbidden))
      }
      Get(s"/alerts/$id") ~> routesFor(userA) ~> check {
        responseAs[AlertEventResponse].state shouldBe "firing"
      }
    }

    "return 404 for an unknown id" in {
      Post(s"/alerts/${UUID.randomUUID().toString}/acknowledge") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // ── Snooze ──────────────────────────────────────────────────────────────

  "POST /alerts/:id/snooze" should {

    "return 200 with state=snoozed and the given snoozedUntil for the owner" in {
      val id = seedFiringEvent(ownerAId)
      val until = Instant.now().plusSeconds(3600)
      Post(s"/alerts/$id/snooze", JsObject("snoozedUntil" -> JsString(until.toString))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AlertEventResponse]
        resp.state shouldBe "snoozed"
        resp.snoozedUntil shouldBe Some(until.toString)
      }
    }

    "return 409 for an illegal transition" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/resolve") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/alerts/$id/snooze", JsObject("snoozedUntil" -> JsString(Instant.now().plusSeconds(60).toString))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Conflict
      }
    }

    "return 403 or 404 for a cross-user caller" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/snooze", JsObject("snoozedUntil" -> JsString(Instant.now().plusSeconds(60).toString))) ~> routesFor(userB) ~> check {
        status should (be(StatusCodes.NotFound) or be(StatusCodes.Forbidden))
      }
    }
  }

  // ── Resolve ─────────────────────────────────────────────────────────────

  "POST /alerts/:id/resolve" should {

    "return 200 with state=resolved for the owner" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/resolve") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[AlertEventResponse]
        resp.state shouldBe "resolved"
        resp.resolvedAt shouldBe defined
      }
    }

    "return 409 for an already-resolved event" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/resolve") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/alerts/$id/resolve") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Conflict
      }
    }

    "return 403 or 404 for a cross-user caller" in {
      val id = seedFiringEvent(ownerAId)
      Post(s"/alerts/$id/resolve") ~> routesFor(userB) ~> check {
        status should (be(StatusCodes.NotFound) or be(StatusCodes.Forbidden))
      }
    }
  }
}
