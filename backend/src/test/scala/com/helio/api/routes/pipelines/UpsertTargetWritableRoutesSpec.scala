package com.helio.api.routes.pipelines

import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{CreatePipelineRequest, ErrorResponse, JsonProtocols, StepConfigErrorResponse}
import com.helio.api.protocols.pipelines.CreatePipelineRootRequest
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRootRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.{PipelineRunService, PipelineService}
import com.helio.spark.PipelineRunCache
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
import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._

/** HEL-1265: an `upsertsource` existing-source target must be a dataset the pipeline owner owns,
 *  checked at save (create/add/update), reported by analyze, and refused on every execution
 *  surface with HEL-1147's named `STEP_CONFIG_INVALID` body before any write. */
class UpsertTargetWritableRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var pipelineService: PipelineService     = _
  private var runService: PipelineRunService       = _
  private var outputRepo: OutputRepository         = _
  private var dataSourceRepo: DataSourceRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx          = new DbContext(db, db)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    val stepRepo     = new PipelineStepRepository(ctx)(routeEc)
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    val rootRepo     = new PipelineRootRepository(ctx)(routeEc)
    outputRepo       = new OutputRepository(ctx)(routeEc)
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

  private def seedSource(owner: AuthenticatedUser, kind: String): DataSource = {
    val now = Instant.now()
    val id  = DataSourceId(UUID.randomUUID().toString)
    val schema = Vector(SchemaField("name", "string"), SchemaField("score", "float"))
    val source: DataSource = kind match {
      case "csv"     => CsvSource(id, s"orders-$kind", owner.id, now, now, CsvSourceConfig(s"csv/${id.value}.csv"), inferredSchema = schema)
      case "sql"     => SqlSource(id, s"orders-$kind", owner.id, now, now, SqlSourceConfig("postgresql", "h", 5432, "d", "u", "p", "select 1"), inferredSchema = schema)
      case "dataset" => DatasetSource(id, s"orders-$kind", owner.id, now, now, inferredSchema = schema)
      case other     => fail(s"unsupported fixture kind $other")
    }
    await(dataSourceRepo.insert(source, owner))
  }

  private def upsertConfig(targetId: String): JsObject = JsObject(
    "target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(targetId)),
    "mode"   -> JsString("append")
  )

  private def stepBody(op: String, config: JsObject, parent: Option[String] = None): JsObject =
    JsObject(Map("type" -> JsString(op), "config" -> config) ++ parent.map(p => "parentStepId" -> JsString(p)))

  private def addStep(owner: AuthenticatedUser, pid: PipelineId, op: String, config: JsObject, parent: Option[String] = None): String = {
    var id = ""
    Post(s"/pipelines/${pid.value}/steps", stepBody(op, config, parent)) ~> routesFor(owner) ~> check {
      status shouldBe StatusCodes.Created
      id = responseAs[JsObject].fields("id").convertTo[String]
    }
    id
  }

  /** Inserts an upsert step straight into `pipeline_steps`, past every write-time check, to model a step
   *  stored before this ticket (or written by any path that bypasses the service). */
  private def insertStoredUpsert(pid: PipelineId, targetId: String, parent: Option[String] = None): String = {
    import PostgresProfile.api._
    val stepId = UUID.randomUUID().toString
    val rootId = if (parent.isDefined) "" else await(db.run(sql"select id from pipeline_roots where pipeline_id = ${pid.value} order by position limit 1".as[String].head))
    val raw    = upsertConfig(targetId).compactPrint
    val parentVal = parent.getOrElse("")
    await(db.run(sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, root_id, parent_step_id)
                        VALUES ($stepId, ${pid.value}, 0, 'upsertsource', $raw::text, now(), now(), NULLIF($rootId, ''), NULLIF($parentVal, ''))"""))
    stepId
  }

  private def storedConfig(steps: JsArray, sid: String): JsValue =
    steps.elements.map(_.asJsObject).find(_.fields("id") == JsString(sid)).get.fields("config")

  private def stepCount(pid: PipelineId): Int = {
    import PostgresProfile.api._
    await(db.run(sql"select count(*) from pipeline_steps where pipeline_id = ${pid.value}".as[Int].head))
  }

  private def datasetRowCount(): Int = {
    import PostgresProfile.api._
    await(db.run(sql"select count(*) from dataset_rows".as[Int].head))
  }

  private def withLogCapture[T](body: => T): (T, Seq[ILoggingEvent]) = {
    val logger   = LoggerFactory.getLogger(classOf[PipelineRunService]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]()
    appender.start()
    logger.addAppender(appender)
    try { val result = body; (result, appender.list.asScala.toSeq) }
    finally { logger.detachAppender(appender); appender.stop() }
  }

  "adding an upsertsource step (HEL-1265 save time)" should {

    for (kind <- Seq("csv", "sql")) {
      s"reject an owned $kind target with a 422 naming its id, name and kind, persisting nothing" in {
        val owner = newUser(); val pid = newPipeline(owner); val target = seedSource(owner, kind)
        Post(s"/pipelines/${pid.value}/steps", stepBody("upsertsource", upsertConfig(target.id.value))) ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          val msg = responseAs[ErrorResponse].message
          msg should (include(target.id.value) and include(target.name) and include(kind) and include("dataset"))
        }
        stepCount(pid) shouldBe 0
      }
    }

    "accept a dataset target owned by the pipeline owner" in {
      val owner = newUser(); val pid = newPipeline(owner); val target = seedSource(owner, "dataset")
      Post(s"/pipelines/${pid.value}/steps", stepBody("upsertsource", upsertConfig(target.id.value))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    "return the same 404, without kind or name, for a foreign CSV source and for an unknown id" in {
      val owner = newUser(); val other = newUser(); val pid = newPipeline(owner)
      val foreign = seedSource(other, "csv")
      val unknown = UUID.randomUUID().toString
      def probe(id: String): (StatusCode, String) = {
        var out: (StatusCode, String) = null
        Post(s"/pipelines/${pid.value}/steps", stepBody("upsertsource", upsertConfig(id))) ~> routesFor(owner) ~> check {
          out = (status, responseAs[ErrorResponse].message.replace(id, "<id>"))
        }
        out
      }
      val (foreignStatus, foreignMsg) = probe(foreign.id.value)
      val (unknownStatus, unknownMsg) = probe(unknown)
      foreignStatus shouldBe StatusCodes.NotFound
      (foreignStatus, foreignMsg) shouldBe ((unknownStatus, unknownMsg))
      foreignMsg should not include foreign.name
      foreignMsg should not include "csv"
    }
  }

  "updating an upsertsource step's config (HEL-1265 save time)" should {

    "reject a switch to a CSV target with a 422 and leave the stored config unchanged" in {
      val owner = newUser(); val pid = newPipeline(owner)
      val good = seedSource(owner, "dataset"); val bad = seedSource(owner, "csv")
      val sid  = addStep(owner, pid, "upsertsource", upsertConfig(good.id.value))
      Patch(s"/pipeline-steps/$sid", JsObject("config" -> upsertConfig(bad.id.value))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[ErrorResponse].message should (include(bad.id.value) and include(bad.name))
      }
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check {
        storedConfig(responseAs[JsArray], sid) shouldBe upsertConfig(good.id.value)
      }
    }

    "still allow a position/enabled-only update on a stored step with a non-dataset target" in {
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      val sid   = insertStoredUpsert(pid, bad.id.value)
      Patch(s"/pipeline-steps/$sid", JsObject("enabled" -> JsBoolean(false))) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  "a single-call pipeline create with an inline upsertsource step (HEL-1265 save time)" should {

    "reject a SQL target with a 422 and persist no pipeline" in {
      val owner = newUser(); val target = seedSource(owner, "sql"); val root = seedSource(owner, "dataset")
      val name  = s"inline-${UUID.randomUUID()}"
      val body = JsObject(
        "name"  -> JsString(name),
        "roots" -> JsArray(JsObject("sourceId" -> JsString(root.id.value))),
        "steps" -> JsArray(JsObject("clientId" -> JsString("s1"), "type" -> JsString("upsertsource"), "config" -> upsertConfig(target.id.value)))
      )
      Post("/pipelines", body) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[ErrorResponse].message should (include(target.id.value) and include("sql"))
      }
      import PostgresProfile.api._
      await(db.run(sql"select count(*) from pipelines where name = $name".as[Int].head)) shouldBe 0
    }
  }

  "a stored upsertsource step whose target is not a dataset (HEL-1265 execution time)" should {

    "list cleanly with its stored config" in {
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      val sid   = insertStoredUpsert(pid, bad.id.value)
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        storedConfig(responseAs[JsArray], sid) shouldBe upsertConfig(bad.id.value)
      }
    }

    "be flagged by analyze as that step's validationError naming the target" in {
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      val sid   = insertStoredUpsert(pid, bad.id.value)
      Get(s"/pipelines/${pid.value}/analyze") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val step = responseAs[JsObject].fields("steps").convertTo[Vector[JsObject]].find(_.fields("id") == JsString(sid)).get
        step.fields.get("validationError").map(_.convertTo[String]).getOrElse("") should (include(bad.id.value) and include("dataset"))
      }
      Get(s"/pipelines/${pid.value}/analyze?concise=true") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should (include("validationError") and include(bad.id.value))
      }
    }

    "be refused by step preview with the full STEP_CONFIG_INVALID body" in {
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      val sid   = insertStoredUpsert(pid, bad.id.value)
      Get(s"/pipelines/${pid.value}/steps/$sid/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val body = responseAs[StepConfigErrorResponse]
        body.code shouldBe "STEP_CONFIG_INVALID"
        body.stepId shouldBe sid
        body.stepKind shouldBe "upsertsource"
        body.reason should (include(bad.id.value) and include(bad.name))
      }
    }

    "be refused by Output preview" in {
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      val sid   = insertStoredUpsert(pid, bad.id.value)
      await(outputRepo.insertInternal(pid, Some(PipelineStepId(sid)), owner.id, "out", OutputKind.Table, explicitRootId = None))
      Post(s"/pipelines/${pid.value}/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[StepConfigErrorResponse].stepId shouldBe sid
      }
    }

    "be refused by a dry run, logging a single WARN and no ERROR" in {
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      val sid   = insertStoredUpsert(pid, bad.id.value)
      val (_, events) = withLogCapture {
        Post(s"/pipelines/${pid.value}/run?dry=true") ~> routesFor(owner) ~> check {
          status shouldBe StatusCodes.UnprocessableEntity
          responseAs[StepConfigErrorResponse].stepId shouldBe sid
        }
      }
      events.exists(_.getLevel == Level.ERROR) shouldBe false
      events.count(_.getLevel == Level.WARN) shouldBe 1
    }

    "fail a real run with the same body before writing any row, recording a failed run" in {
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      val sid   = insertStoredUpsert(pid, bad.id.value)
      val rowsBefore = datasetRowCount()
      Post(s"/pipelines/${pid.value}/run") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val body = responseAs[StepConfigErrorResponse]
        body.code shouldBe "STEP_CONFIG_INVALID"
        body.stepId shouldBe sid
      }
      datasetRowCount() shouldBe rowsBefore
      import PostgresProfile.api._
      await(db.run(sql"select status from pipeline_runs where pipeline_id = ${pid.value}".as[String].head)) shouldBe "failed"
    }

    "not affect the preview of a sibling branch that avoids the upsert step" in {
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      val trunk = addStep(owner, pid, "select", JsObject("fields" -> JsArray(JsString("name"))))
      insertStoredUpsert(pid, bad.id.value, parent = Some(trunk))
      val sibling = addStep(owner, pid, "select", JsObject("fields" -> JsArray(JsString("name"))), parent = Some(trunk))
      Get(s"/pipelines/${pid.value}/steps/$sibling/preview") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "still block deleting its source (HEL-1252 reference semantics unchanged)" in {
      import com.helio.services.sources.DataSourceService
      val owner = newUser(); val pid = newPipeline(owner); val bad = seedSource(owner, "csv")
      insertStoredUpsert(pid, bad.id.value)
      val service = new DataSourceService(dataSourceRepo, new LocalFileSystem(Paths.get("/")))
      await(service.delete(bad.id, owner)).left.map(_.err.getClass.getSimpleName) shouldBe Left("Conflict")
    }
  }

  "a dataset-targeted upsertsource (HEL-1265 control)" should {
    "preview and dry-run without a config failure" in {
      val owner = newUser(); val pid = newPipeline(owner); val target = seedSource(owner, "dataset")
      val sid = addStep(owner, pid, "upsertsource", upsertConfig(target.id.value))
      Get(s"/pipelines/${pid.value}/steps/$sid/preview") ~> routesFor(owner) ~> check { status shouldBe StatusCodes.OK }
      Post(s"/pipelines/${pid.value}/run?dry=true") ~> routesFor(owner) ~> check { status shouldBe StatusCodes.OK }
    }
  }
}
