package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{CreatePipelineRequest, ErrorResponse, JsonProtocols, PipelineSummaryResponse}
import com.helio.api.protocols.pipelines.{CreatePipelineRootRequest, PipelineStepResponse}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DatasetSource, PipelineId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.PipelineService
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

/** HEL-1102 backend fix (cycle 2) task 3a.3: route-level regression coverage for
 *  `PipelineService.classifyDbError`'s new `PipelineCycleGuard.PipelineCycleRejected` arm.
 *
 *  Unlike `PipelineCycleDetectionServiceSpec`'s "API-level" describe blocks (which call
 *  `PipelineService.create`/`addStep`/`updateStep`/`duplicateStep` directly and assert only
 *  `result shouldBe a[Left[_, _]]`), every test here goes through the REAL Pekko HTTP route
 *  (`PipelineRoutes`/`PipelineStepRoutes`, via `ScalatestRouteTest`) and asserts the actual
 *  wire-level HTTP status code -- the thing `classifyDbError`'s missing arm actually broke
 *  (a 500 satisfies "rejected", it does not satisfy "400"). See design.md's "Backend fix"
 *  section for why the prior tests didn't catch this. */
class PipelineCycleRouteStatusSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var pipelineRootRepo: PipelineRootRepository = _
  private var outputRepo: OutputRepository             = _
  private var service: PipelineService                 = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc)
    outputRepo       = new OutputRepository(ctx)(routeEc)
    service = new PipelineService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo,
      outputRepo = outputRepo, pipelineRootRepo = pipelineRootRepo
    )(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def newUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def newSource(owner: AuthenticatedUser, name: String): DataSourceId = {
    val now = Instant.now()
    val source = DatasetSource(
      DataSourceId(UUID.randomUUID().toString), name, owner.id, now, now,
      inferredSchema = Vector(SchemaField("amount", "float"))
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  /** Seeds an already-persisted `upsertsource`-write-edge pipeline via `PipelineService.create`
   *  (the ordinary, already-registered path -- `upsertsource` has been a real `PipelineStep.
   *  Registry` member since HEL-1100) plus a raw-SQL write-edge step, mirroring
   *  `PipelineCycleDetectionServiceSpec.seedWriterPipeline`. Used to construct the OTHER
   *  pipeline half of a two-pipeline cycle. */
  private def seedWriterPipeline(owner: AuthenticatedUser, readFrom: DataSourceId, writeTo: DataSourceId, name: String): PipelineId = {
    val req = CreatePipelineRequest(name = name, roots = Vector(CreatePipelineRootRequest(sourceId = Some(readFrom.value))))
    val pid = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)
    import PostgresProfile.api._
    val stepId = UUID.randomUUID().toString
    val rootId = await(db.run(sql"select id from pipeline_roots where pipeline_id = ${pid.value} order by position limit 1".as[String].head))
    val configJson = s"""{"target":{"kind":"existingSource","dataSourceId":"${writeTo.value}"},"mode":"append"}"""
    await(db.run(sqlu"""INSERT INTO pipeline_steps
             (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
             VALUES ($stepId, ${pid.value}, 0, 'upsertsource', $configJson::text, now(), now(), $rootId)"""))
    pid
  }

  private def routesFor(user: AuthenticatedUser): Route =
    concat(new PipelineRoutes(service, user).routes, new PipelineStepRoutes(service, user).routes)

  private def upsertReq(dataSourceId: String): JsObject = JsObject(
    "type" -> JsString("upsertsource"),
    "config" -> JsObject(
      "target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(dataSourceId)),
      "mode"   -> JsString("append")
    )
  )

  "POST /pipelines (create) with an upsertsource step closing a direct self-cycle" should {
    "return 400 naming the cycle" in {
      val owner = newUser()
      val s     = newSource(owner, "rt-create-self-s")
      val body = JsObject(
        "name"  -> JsString("rt-create-self-cycle"),
        "roots" -> JsArray(JsObject("sourceId" -> JsString(s.value))),
        "steps" -> JsArray(
          JsObject(
            "clientId" -> JsString("s1"),
            "type"     -> JsString("upsertsource"),
            "config" -> JsObject(
              "target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(s.value)),
              "mode"   -> JsString("append")
            )
          )
        )
      )
      Post("/pipelines", body) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("rt-create-self-cycle")
      }
    }
  }

  "POST /pipelines/:id/steps (addStep) with an upsertsource target closing a transitive cycle" should {
    "return 400 naming the cycle" in {
      val owner = newUser()
      val s1    = newSource(owner, "rt-as-s1")
      val s2    = newSource(owner, "rt-as-s2")
      val createBody = JsObject(
        "name"  -> JsString("rt-as-pipe"),
        "roots" -> JsArray(JsObject("sourceId" -> JsString(s1.value)))
      )
      var pid = ""
      Post("/pipelines", createBody) ~> routesFor(owner) ~> check {
        pid = responseAs[PipelineSummaryResponse].id
      }
      // Another, already-persisted pipeline writes s1 from a read of s2 -- closing edge.
      seedWriterPipeline(owner, s2, s1, "rt-as-other-writer")

      Post(s"/pipelines/$pid/steps", upsertReq(s2.value)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("rt-as-other-writer")
      }
    }
  }

  "PATCH /pipeline-steps/:id (updateStep) retargeting an upsertsource step into a direct self-cycle" should {
    "return 400 naming the cycle" in {
      val owner  = newUser()
      val s      = newSource(owner, "rt-us-direct-s")
      val target = newSource(owner, "rt-us-direct-target")
      val createBody = JsObject(
        "name"  -> JsString("rt-us-direct-pipe"),
        "roots" -> JsArray(JsObject("sourceId" -> JsString(s.value)))
      )
      var pid = ""
      Post("/pipelines", createBody) ~> routesFor(owner) ~> check {
        pid = responseAs[PipelineSummaryResponse].id
      }
      var stepId = ""
      Post(s"/pipelines/$pid/steps", upsertReq(target.value)) ~> routesFor(owner) ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }

      val patchBody = JsObject("config" -> upsertReq(s.value).fields("config"))
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("rt-us-direct-pipe")
      }
    }
  }

  "POST /pipeline-steps/:id/duplicate on an upsertsource step whose target is this same pipeline's own root" should {
    "return 400 naming the cycle" in {
      val owner = newUser()
      val s     = newSource(owner, "rt-dup-direct-s")
      val createBody = JsObject(
        "name"  -> JsString("rt-dup-direct-pipe"),
        "roots" -> JsArray(JsObject("sourceId" -> JsString(s.value)))
      )
      var pid = ""
      Post("/pipelines", createBody) ~> routesFor(owner) ~> check {
        pid = responseAs[PipelineSummaryResponse].id
      }

      // Seeded via the repository test-seam (raw SQL) -- a real `addStep` call for this
      // config would already be rejected; `duplicateStep` must independently re-check the
      // graph, so the original row has to reach the table some other way (matches
      // `PipelineCycleDetectionServiceSpec`'s identical `duplicateStep` fixture convention).
      import PostgresProfile.api._
      val stepId = UUID.randomUUID().toString
      val rootId = await(db.run(sql"select id from pipeline_roots where pipeline_id = $pid order by position limit 1".as[String].head))
      val configJson = s"""{"target":{"kind":"existingSource","dataSourceId":"${s.value}"},"mode":"append"}"""
      await(db.run(sqlu"""INSERT INTO pipeline_steps
               (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
               VALUES ($stepId, $pid, 0, 'upsertsource', $configJson::text, now(), now(), $rootId)"""))

      Post(s"/pipeline-steps/$stepId/duplicate") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("rt-dup-direct-pipe")
      }
    }
  }
}
