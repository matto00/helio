package com.helio.services.pipelines

import com.helio.api.protocols.pipelines._
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1096 tasks.md 3.3 (design.md D1, `pipeline-analyze-api` spec delta): `analyze`'s
 *  `costVerdict.canRun` mirrors `POST /api/pipelines/:id/run`'s own owner-or-editor-grantee
 *  check -- true for the owner AND an editor grantee, false for a viewer grantee, computed
 *  regardless of `autoRunnable`. Mirrors `PipelineAnalyzeAnalyzeWithAiSpec`'s fixture pattern. */
class PipelineServiceCanRunSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

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
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRootRepo = new PipelineRootRepository(ctx)
    outputRepo       = new OutputRepository(ctx)
    service = new PipelineService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo,
      outputRepo = outputRepo, pipelineRootRepo = pipelineRootRepo
    )
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def newUser(): AuthenticatedUser = {
    import slick.jdbc.PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def newSource(owner: AuthenticatedUser): DataSourceId = {
    val now = Instant.now()
    val source = DatasetSource(
      DataSourceId(UUID.randomUUID().toString), "can-run-src", owner.id, now, now,
      inferredSchema = Vector(SchemaField("name", "string"))
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  private def seedGrant(pipelineId: PipelineId, granteeId: UserId, role: String): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                          VALUES ('pipeline', ${pipelineId.value}, ${granteeId.value}::uuid, $role, now())"""))
  }

  "PipelineService.analyze's costVerdict.canRun (HEL-1096 design.md D1)" should {

    "is true for the pipeline OWNER" in {
      val owner = newUser()
      val s     = newSource(owner)
      val req   = CreatePipelineRequest(name = "can-run-owner", roots = Vector(CreatePipelineRootRequest(sourceId = Some(s.value))))
      val pid   = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)

      val result = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      result.costVerdict.canRun shouldBe true
    }

    "is true for an EDITOR grantee (not the owner)" in {
      val owner  = newUser()
      val editor = newUser()
      val s      = newSource(owner)
      val req    = CreatePipelineRequest(name = "can-run-editor", roots = Vector(CreatePipelineRootRequest(sourceId = Some(s.value))))
      val pid    = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)
      seedGrant(pid, editor.id, "editor")

      val result = await(service.analyze(pid, editor)).getOrElse(fail("expected Right"))
      result.costVerdict.canRun shouldBe true
    }

    "is false for a VIEWER grantee" in {
      val owner  = newUser()
      val viewer = newUser()
      val s      = newSource(owner)
      val req    = CreatePipelineRequest(name = "can-run-viewer", roots = Vector(CreatePipelineRootRequest(sourceId = Some(s.value))))
      val pid    = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)
      seedGrant(pid, viewer.id, "viewer")

      val result = await(service.analyze(pid, viewer)).getOrElse(fail("expected Right"))
      result.costVerdict.canRun shouldBe false
    }
  }
}
