package com.helio.api.routes.pipelines

import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import com.helio.api.{CreatePipelineRequest, ErrorResponse, JsonProtocols, StepConfigErrorResponse}
import com.helio.api.protocols.pipelines.{CreatePipelineRootRequest, PipelineStepResponse}
import com.helio.domain.model.{AuthenticatedUser, OutputKind, PipelineId, PipelineStepId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRootRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.{PipelineRunService, PipelineService}
import com.helio.spark.PipelineRunCache
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._

/** HEL-1147: route-level contract for step-configuration failures on every pipeline-execution
 *  surface (step preview, Output preview, dry run, real run).
 *
 *  Tests labelled "GUARD" are green on the pre-change tree on purpose -- they pin that a data
 *  failure (datebucket on unparsable values) and a provider failure (an AI step with no model
 *  configured) are NOT reclassified as step-configuration problems; their proof is a mutation
 *  that classifies any `IllegalArgumentException` as config, which turns them red. */
class StepConfigInvalidRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var pipelineService: PipelineService   = _
  private var runService: PipelineRunService     = _
  private var outputRepo: OutputRepository       = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    val stepRepo       = new PipelineStepRepository(ctx)(routeEc)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    val rootRepo       = new PipelineRootRepository(ctx)(routeEc)
    outputRepo         = new OutputRepository(ctx)(routeEc)
    pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = rootRepo
    )(routeEc)
    runService = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, new PipelineRunRepository(ctx)(routeEc), new PipelineRunCache(), null,
      new LocalFileSystem(Paths.get("/")), null, null,
      outputRepo = outputRepo, nodeSnapshotRepo = new NodeSnapshotRepository(ctx)(routeEc)
    )(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def newUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def routesFor(user: AuthenticatedUser): Route =
    concat(
      new PipelineRoutes(pipelineService, user).routes,
      new PipelineStepRoutes(pipelineService, user).routes,
      new PipelineRunSubmitRoutes(runService, user).routes,
      new PipelineRunStatusRoutes(runService, user).routes
    )

  /** A pipeline over a two-row dataset source (name/score), owned by `owner`. */
  private def newPipeline(owner: AuthenticatedUser): PipelineId = {
    import PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, ${s"ds-$dsId"}, 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
    )))
    val req = CreatePipelineRequest(name = s"p-${UUID.randomUUID()}", roots = Vector(CreatePipelineRootRequest(sourceId = Some(dsId))))
    PipelineId(await(pipelineService.create(req, owner)).getOrElse(fail("pipeline create failed")).id)
  }

  private def stepBody(op: String, config: JsObject, parent: Option[String] = None): JsObject =
    JsObject(
      Map("type" -> JsString(op), "config" -> config) ++ parent.map(p => "parentStepId" -> JsString(p))
    )

  /** Create a step through the real route; returns its id. */
  private def addStep(owner: AuthenticatedUser, pid: PipelineId, op: String, config: JsObject, parent: Option[String] = None): String = {
    var id = ""
    Post(s"/pipelines/${pid.value}/steps", stepBody(op, config, parent)) ~> routesFor(owner) ~> check {
      status shouldBe StatusCodes.Created
      id = responseAs[JsObject].fields("id").convertTo[String]
    }
    id
  }

  private val emptyName: JsObject = JsObject(
    "target" -> JsObject("kind" -> JsString("newSource"), "name" -> JsString("")),
    "mode"   -> JsString("append")
  )
  private val EmptyNameReason = "'upsertsource' step requires a non-empty 'target.name' for a new source"

  private def withLogCapture[T](body: => T): (T, Seq[ILoggingEvent]) = {
    val logger   = LoggerFactory.getLogger(classOf[PipelineRunService]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]()
    appender.start()
    logger.addAppender(appender)
    try {
      val result = body
      (result, appender.list.asScala.toSeq)
    } finally { logger.detachAppender(appender); appender.stop() }
  }

  "GET /pipelines/:id/steps/:stepId/preview (HEL-1147)" should {

    "return the named 422 for an upsertsource with an empty new-source name" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val sid   = addStep(owner, pid, "upsertsource", emptyName)
      Get(s"/pipelines/${pid.value}/steps/$sid/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val body = responseAs[StepConfigErrorResponse]
        body.code shouldBe "STEP_CONFIG_INVALID"
        body.stepId shouldBe sid
        body.stepKind shouldBe "upsertsource"
        body.reason shouldBe EmptyNameReason
        // `message` is byte-identical to the pre-change generic body (prefix + root lane path).
        body.message should startWith(s"Pipeline execution failed at step $sid (upsertsource) [path: root:")
        body.message should endWith(s"]: $EmptyNameReason")
      }
    }

    "return the named 422 for a whitespace-only new-source name" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val cfg   = JsObject("target" -> JsObject("kind" -> JsString("newSource"), "name" -> JsString("   ")), "mode" -> JsString("append"))
      val sid   = addStep(owner, pid, "upsertsource", cfg)
      Get(s"/pipelines/${pid.value}/steps/$sid/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[StepConfigErrorResponse].reason shouldBe EmptyNameReason
      }
    }

    "attribute an ancestor's invalid config to the ancestor when a child is previewed" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val computeId = addStep(owner, pid, "compute", JsObject("column" -> JsString(""), "expression" -> JsString("1")))
      val childId   = addStep(owner, pid, "select", JsObject("fields" -> JsArray(JsString("name"))), Some(computeId))
      Get(s"/pipelines/${pid.value}/steps/$childId/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val body = responseAs[StepConfigErrorResponse]
        body.stepId shouldBe computeId
        body.stepKind shouldBe "compute"
        body.reason shouldBe "compute step is missing required config value 'column'."
      }
    }

    "name an evaluate-time config failure (fillnull constant without a value)" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val sid = addStep(owner, pid, "fillnull", JsObject("strategy" -> JsString("constant"), "columns" -> JsArray(JsString("name"))))
      Get(s"/pipelines/${pid.value}/steps/$sid/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val body = responseAs[StepConfigErrorResponse]
        body.stepKind shouldBe "fillnull"
        body.reason shouldBe "fillnull strategy 'constant' requires 'value'"
      }
    }

    "log a config failure as a single WARN with no throwable and no ERROR" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val sid   = addStep(owner, pid, "upsertsource", emptyName)
      val (_, events) = withLogCapture {
        Get(s"/pipelines/${pid.value}/steps/$sid/preview") ~> routesFor(owner) ~> check { status shouldBe StatusCodes.UnprocessableEntity }
      }
      events.exists(_.getLevel == Level.ERROR) shouldBe false
      val warns = events.filter(_.getLevel == Level.WARN)
      warns should have size 1
      Option(warns.head.getThrowableProxy) shouldBe None
      warns.head.getFormattedMessage should (include(sid) and include("upsertsource") and include(EmptyNameReason))
    }

    // GUARD (green on the pre-change tree): a data failure is not a config problem.
    "GUARD: keep a datebucket data failure as an unnamed 422 logged at ERROR with its throwable" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val sid = addStep(owner, pid, "datebucket", JsObject("field" -> JsString("name"), "granularity" -> JsString("day"), "outputColumn" -> JsString("d")))
      val (_, events) = withLogCapture {
        Get(s"/pipelines/${pid.value}/steps/$sid/preview") ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          responseAs[JsObject].fields.keySet shouldBe Set("message")
          responseAs[ErrorResponse].message should include("could be parsed as a timestamp/date")
        }
      }
      val errors = events.filter(_.getLevel == Level.ERROR)
      errors should not be empty
      errors.foreach(e => Option(e.getThrowableProxy) should not be None)
    }

    // GUARD (green on the pre-change tree): an AI-step provider failure is not a config problem.
    "GUARD: keep an AI step failure (ai-unavailable) as an unnamed 422 logged at ERROR" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val cfg = JsObject(
        "inputField" -> JsString("name"), "instruction" -> JsString("classify"),
        "outputSchema" -> JsArray(JsObject("name" -> JsString("o"), "type" -> JsString("string")))
      )
      val sid = addStep(owner, pid, "analyzewithai", cfg)
      val (_, events) = withLogCapture {
        Get(s"/pipelines/${pid.value}/steps/$sid/preview") ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          responseAs[JsObject].fields.keySet shouldBe Set("message")
          responseAs[ErrorResponse].message should include("analyzewithai ai-unavailable")
        }
      }
      val errors = events.filter(_.getLevel == Level.ERROR)
      errors should not be empty
      errors.foreach(e => Option(e.getThrowableProxy) should not be None)
    }
  }

  "the other execution surfaces (HEL-1147)" should {

    "return the named 422 from Output preview" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val sid   = addStep(owner, pid, "upsertsource", emptyName)
      await(outputRepo.insertInternal(pid, Some(PipelineStepId(sid)), owner.id, "out", OutputKind.Table, explicitRootId = None))
      Post(s"/pipelines/${pid.value}/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val body = responseAs[StepConfigErrorResponse]
        body.code shouldBe "STEP_CONFIG_INVALID"
        body.stepId shouldBe sid
      }
    }

    "return the named 422 from a dry run, logging a single WARN and no ERROR" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val sid   = addStep(owner, pid, "upsertsource", emptyName)
      val (_, events) = withLogCapture {
        Post(s"/pipelines/${pid.value}/run?dry=true") ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val body = responseAs[StepConfigErrorResponse]
          body.stepId shouldBe sid
          body.reason shouldBe EmptyNameReason
        }
      }
      events.exists(_.getLevel == Level.ERROR) shouldBe false
      events.count(_.getLevel == Level.WARN) shouldBe 1
    }

    "return the named 422 from a real run, persist the unchanged generic message, and log no ERROR" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val sid   = addStep(owner, pid, "upsertsource", emptyName)
      val (message, events) = withLogCapture {
        Post(s"/pipelines/${pid.value}/run") ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val body = responseAs[StepConfigErrorResponse]
          body.stepId shouldBe sid
          body.message
        }
      }
      events.exists(_.getLevel == Level.ERROR) shouldBe false
      events.count(_.getLevel == Level.WARN) shouldBe 1
      // The persisted run errorLog is the same text the response `message` carries.
      import PostgresProfile.api._
      val errorLog = await(db.run(sql"select error_log from pipeline_runs where pipeline_id = ${pid.value}".as[String].head))
      errorLog shouldBe message
    }
  }

  "upsertsource target.name on the read/write paths (HEL-1147 D7)" should {

    "reject a create with an absent name (422) without logging ERROR" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val cfg   = JsObject("target" -> JsObject("kind" -> JsString("newSource")), "mode" -> JsString("append"))
      val (_, events) = withLogCapture {
        Post(s"/pipelines/${pid.value}/steps", stepBody("upsertsource", cfg)) ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          responseAs[ErrorResponse].message should include("requires a string 'name'")
        }
      }
      events.exists(_.getLevel == Level.ERROR) shouldBe false
    }

    "list and name-preview a stored row whose newSource has no name (inserted past write validation)" in {
      import PostgresProfile.api._
      val owner  = newUser(); val pid = newPipeline(owner)
      val stepId = UUID.randomUUID().toString
      val rootId = await(db.run(sql"select id from pipeline_roots where pipeline_id = ${pid.value} order by position limit 1".as[String].head))
      val raw    = """{"target":{"kind":"newSource"},"mode":"append"}"""
      await(db.run(sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
                          VALUES ($stepId, ${pid.value}, 0, 'upsertsource', $raw::text, now(), now(), $rootId)"""))
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[PipelineStepResponse]].map(_.id) should contain(stepId)
      }
      Get(s"/pipelines/${pid.value}/steps/$stepId/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[StepConfigErrorResponse].reason shouldBe EmptyNameReason
      }
    }
  }
}
