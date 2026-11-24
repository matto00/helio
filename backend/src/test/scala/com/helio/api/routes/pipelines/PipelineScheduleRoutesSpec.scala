package com.helio.api.routes.pipelines

import com.helio.api.routes.pipelines.PipelineScheduleRoutes
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{JsonProtocols, PipelineScheduleResponse}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineScheduleRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.pipelines.PipelineScheduleService
import com.helio.testkit.HelioRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-414 — HTTP-layer coverage for `/api/pipelines/:id/schedule`:
 *  GET/PUT/DELETE happy paths, 404s for an unknown/non-owned pipeline, and
 *  400s for invalid cron/interval/timezone expressions. */
class PipelineScheduleRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var pipelineRepo: PipelineRepository   = _
  private var scheduleRepo: PipelineScheduleRepository = _

  private val ownerAId = UUID.randomUUID().toString
  private val ownerBId = UUID.randomUUID().toString
  private val userA    = AuthenticatedUser(UserId(ownerAId))
  private val userB    = AuthenticatedUser(UserId(ownerBId))
  // HEL-1837: grantees (editor / viewer) and a stranger with no grant.
  private val editorId   = UUID.randomUUID().toString
  private val viewerId   = UUID.randomUUID().toString
  private val strangerId = UUID.randomUUID().toString
  private val editor     = AuthenticatedUser(UserId(editorId))
  private val viewer     = AuthenticatedUser(UserId(viewerId))
  private val stranger   = AuthenticatedUser(UserId(strangerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    scheduleRepo = new PipelineScheduleRepository(ctx)(routeEc)
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
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerBId::uuid, ${s"b-$ownerBId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($editorId::uuid, ${s"e-$editorId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($viewerId::uuid, ${s"v-$viewerId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($strangerId::uuid, ${s"s-$strangerId@helio.test"}, now())"""
    )))
  }

  private def grant(pipelineId: String, granteeId: String, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pipelineId, $granteeId::uuid, $role, now())"""
    ))
  }

  private def seedPipeline(ownerId: String): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources
               (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'dataset', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    pid
  }

  private def routesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new PipelineScheduleService(scheduleRepo, pipelineRepo)
    new PipelineScheduleRoutes(service, user)(routeEc).routes
  }

  private def putBody(
      kind: String = "cron",
      expression: String = "*/5 * * * *",
      timezone: String = "UTC",
      includeEnabled: Boolean = true,
      enabled: Boolean = true
  ): JsObject = {
    val base = Map(
      "kind"       -> JsString(kind),
      "expression" -> JsString(expression),
      "timezone"   -> JsString(timezone)
    )
    JsObject(if (includeEnabled) base + ("enabled" -> JsBoolean(enabled)) else base)
  }


  "PUT /pipelines/:id/schedule" should {

    "create a schedule and return 200/201 with the created schedule" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody()) ~> routesFor(userA) ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
        val resp = responseAs[PipelineScheduleResponse]
        resp.pipelineId shouldBe pid
        resp.kind shouldBe "cron"
        resp.expression shouldBe "*/5 * * * *"
        resp.enabled shouldBe true
        resp.timezone shouldBe "UTC"
      }
    }

    "a subsequent GET returns the same kind/expression/enabled/timezone" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody(expression = "0 9 * * 1-5")) ~> routesFor(userA) ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
      }
      Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineScheduleResponse]
        resp.kind shouldBe "cron"
        resp.expression shouldBe "0 9 * * 1-5"
        resp.enabled shouldBe true
        resp.timezone shouldBe "UTC"
      }
    }

    "calling PUT twice replaces the schedule (second call's expression wins)" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody(expression = "0 * * * *")) ~> routesFor(userA) ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
      }
      Put(s"/pipelines/$pid/schedule", putBody(expression = "0 0 * * *")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PipelineScheduleResponse].expression shouldBe "0 0 * * *"
      }
    }

    "normalize an absent `enabled` field to true" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody(includeEnabled = false)) ~> routesFor(userA) ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
        responseAs[PipelineScheduleResponse].enabled shouldBe true
      }
    }

    "return 400 for a malformed cron expression" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody(expression = "not a cron")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "return 400 for a malformed interval expression" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody(kind = "interval", expression = "5x")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "return 400 for an invalid timezone" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody(timezone = "Not/AZone")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "return 404 for an unknown pipeline id" in {
      Put(s"/pipelines/${UUID.randomUUID().toString}/schedule", putBody()) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for a pipeline owned by a different user, and create no schedule" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody()) ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }


  "GET /pipelines/:id/schedule" should {

    "return 404 for an owned pipeline with no schedule" in {
      val pid = seedPipeline(ownerAId)
      Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for an unknown pipeline id" in {
      Get(s"/pipelines/${UUID.randomUUID().toString}/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for a pipeline owned by a different user" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody()) ~> routesFor(userA) ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
      }
      Get(s"/pipelines/$pid/schedule") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }


  "DELETE /pipelines/:id/schedule" should {

    "return 204 for the owner and remove the schedule" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody()) ~> routesFor(userA) ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
      }
      Delete(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 when no schedule exists" in {
      val pid = seedPipeline(ownerAId)
      Delete(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for a pipeline owned by a different user, and leave the schedule in place" in {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody()) ~> routesFor(userA) ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
      }
      Delete(s"/pipelines/$pid/schedule") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "return 404 for an unknown pipeline id" in {
      Delete(s"/pipelines/${UUID.randomUUID().toString}/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // HEL-1837: read all, owner writes. A grantee's PUT/DELETE is the same 404 the owner-only pipeline rename/delete give.
  "pipeline schedule access by role (HEL-1837)" should {

    def scheduledPipelineWithGrants(): String = {
      val pid = seedPipeline(ownerAId)
      Put(s"/pipelines/$pid/schedule", putBody(expression = "0 9 * * 1-5")) ~> routesFor(userA) ~> check {
        status should (be(StatusCodes.OK) or be(StatusCodes.Created))
      }
      grant(pid, editorId, "editor")
      grant(pid, viewerId, "viewer")
      pid
    }

    "owner reads, writes and deletes" in {
      val pid = scheduledPipelineWithGrants()
      Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PipelineScheduleResponse].expression shouldBe "0 9 * * 1-5"
      }
      Put(s"/pipelines/$pid/schedule", putBody(expression = "0 10 * * *")) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
      Delete(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }

    for ((label, who) <- Seq("editor" -> editor, "viewer" -> viewer)) {
      s"$label GET returns 200 with the same body as the owner and no owner or grantee id" in {
        val pid = scheduledPipelineWithGrants()
        val ownerBody = Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check { responseAs[String].parseJson.asJsObject }
        Get(s"/pipelines/$pid/schedule") ~> routesFor(who) ~> check {
          status shouldBe StatusCodes.OK
          val body = responseAs[String].parseJson.asJsObject
          body shouldBe ownerBody
          body.fields.keySet.exists(k => k.toLowerCase.contains("owner") || k.toLowerCase.contains("grantee")) shouldBe false
          body.compactPrint should not include ownerAId
        }
      }

      s"$label GET on a shared pipeline with no schedule is 404" in {
        val pid = seedPipeline(ownerAId)
        grant(pid, who.id.value, label)
        Get(s"/pipelines/$pid/schedule") ~> routesFor(who) ~> check {
          status shouldBe StatusCodes.NotFound
        }
      }

      s"$label PUT is 404 and leaves the schedule unchanged" in {
        val pid = scheduledPipelineWithGrants()
        Put(s"/pipelines/$pid/schedule", putBody(expression = "0 1 * * *")) ~> routesFor(who) ~> check {
          status shouldBe StatusCodes.NotFound
        }
        Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
          responseAs[PipelineScheduleResponse].expression shouldBe "0 9 * * 1-5"
        }
      }

      s"$label PUT creates nothing on a pipeline with no schedule" in {
        val pid = seedPipeline(ownerAId)
        grant(pid, who.id.value, label)
        Put(s"/pipelines/$pid/schedule", putBody()) ~> routesFor(who) ~> check {
          status shouldBe StatusCodes.NotFound
        }
        Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
          status shouldBe StatusCodes.NotFound
        }
      }

      s"$label DELETE is 404 and the schedule still exists" in {
        val pid = scheduledPipelineWithGrants()
        Delete(s"/pipelines/$pid/schedule") ~> routesFor(who) ~> check {
          status shouldBe StatusCodes.NotFound
        }
        Get(s"/pipelines/$pid/schedule") ~> routesFor(userA) ~> check {
          status shouldBe StatusCodes.OK
          responseAs[PipelineScheduleResponse].expression shouldBe "0 9 * * 1-5"
        }
      }
    }

    "a stranger with no grant gets 404 on GET, PUT and DELETE" in {
      val pid = scheduledPipelineWithGrants()
      Get(s"/pipelines/$pid/schedule") ~> routesFor(stranger) ~> check { status shouldBe StatusCodes.NotFound }
      Put(s"/pipelines/$pid/schedule", putBody()) ~> routesFor(stranger) ~> check { status shouldBe StatusCodes.NotFound }
      Delete(s"/pipelines/$pid/schedule") ~> routesFor(stranger) ~> check { status shouldBe StatusCodes.NotFound }
    }

    "an unknown pipeline id is 404 for a grantee on GET" in {
      Get(s"/pipelines/${UUID.randomUUID().toString}/schedule") ~> routesFor(editor) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
