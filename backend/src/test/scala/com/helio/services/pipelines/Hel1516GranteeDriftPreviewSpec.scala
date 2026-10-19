package com.helio.services.pipelines

import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome}
import com.helio.domain.model._
import com.helio.domain.ai.{AiStepClient, AiStepFailure, AiStepRequest}
import com.helio.domain.steps.{AnalyzeWithAiConfig, AnalyzeWithAiOutputField, AssertConfig, AssertRule}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunGuardRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.api.protocols.pipelines.SourceSchemaDriftResponse
import com.helio.services.ServiceError
import com.helio.spark.PipelineRunCache
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.helio.testsupport.DatasetRowsTestSupport
import com.typesafe.config.ConfigFactory
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api.DBIO
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.util.UUID
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1516: follow-ups to HEL-1503.
 *
 *  1. A grantee's analyze reports the same `sourceSchemaDrift` the pipeline OWNER's analyze reports (baseline and
 *     current primary-root schema both read as the owner sees them).
 *  2. A step / Output preview re-verifies access immediately before it executes: a grant revoked after the preview's
 *     last ACL read -> 403, a pipeline deleted in that window -> 404, never executing.
 *
 *  Runs the service as a NOSUPERUSER NOBYPASSRLS role (shape of `Hel1503EditorRunGapsSpec`); seeding and measuring use
 *  the privileged pool. Cases labelled DEFECT are red on unchanged main; GUARD / PIN cases pass on main by
 *  construction (see openspec/changes/grantee-drift-preview-recheck/red-run.md for the mutation each is shown
 *  failable by). Seam R = revoke after `previewAtNode`'s own `findByIdShared` and its root read; S1 = delete right
 *  after `previewAtNode`'s `findByIdShared`; S2 = delete at the step-list read (after roots resolved). */
class Hel1516GranteeDriftPreviewSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var pg: EmbeddedPostgres                  = _
  private var url: String                           = _
  private var appDb: JdbcBackend.Database           = _
  private var privDb: JdbcBackend.Database          = _
  private var ctx: DbContext                        = _
  private var pipelineRepo: PipelineRepository      = _
  private var stepRepo: PipelineStepRepository      = _
  private var runRepo: PipelineRunRepository        = _
  private var guardRepo: PipelineRunGuardRepository = _
  private var dsRepo: DataSourceRepository          = _
  private var snapRepo: NodeSnapshotRepository      = _
  private var outRepo: OutputRepository             = _

  override def beforeAll(): Unit = {
    pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val sc = pg.getPostgresDatabase.getConnection
    try {
      val st = sc.createStatement()
      st.execute("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      st.execute("ALTER SCHEMA public OWNER TO helio_migration_test")
      st.execute("GRANT CREATE, USAGE ON SCHEMA public TO helio_migration_test")
      st.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      st.execute("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
      st.close()
    } finally sc.close()
    url = pg.getJdbcUrl("helio_migration_test", "postgres")
    Flyway.configure().dataSource(url, "helio_migration_test", "test").locations("classpath:db/migration").load().migrate()
    val full = s"$url${if (url.contains('?')) "&" else "?"}stringtype=unspecified"
    appDb = JdbcBackend.Database.forURL(full, user = "helio_migration_test", password = "test", driver = "org.postgresql.Driver")
    privDb = JdbcBackend.Database.forConfig("privileged", ConfigFactory.parseString(
      s"""privileged { url = "$full", user = "helio_migration_test", password = "test",
         |  driver = "org.postgresql.Driver", connectionInitSql = "SET ROLE helio_privileged",
         |  numThreads = 4, connectionPool = "HikariCP" }""".stripMargin))
    ctx          = new DbContext(appDb, privDb)
    dsRepo       = new DataSourceRepository(ctx)
    stepRepo     = new PipelineStepRepository(ctx)
    pipelineRepo = new PipelineRepository(ctx, dsRepo)
    runRepo      = new PipelineRunRepository(ctx)
    guardRepo    = new PipelineRunGuardRepository(ctx)
    snapRepo     = new NodeSnapshotRepository(ctx)
    outRepo      = new OutputRepository(ctx)
  }

  override def afterAll(): Unit = {
    appDb.close(); privDb.close(); pg.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)
  private def priv[T](a: DBIO[T]): T = await(privDb.run(a))

  /** Counts executions and delegates to the real in-process engine. */
  private final class SpyBackend extends PipelineExecutionBackend {
    val executions = new AtomicInteger(0)
    private val real = new InProcessExecutionBackend(new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/"))), stepRepo)
    override def supportsWriteBack: Boolean = real.supportsWriteBack
    override def execute(
        pipeline: Pipeline, roots: Vector[(String, DataSource)], steps: Vector[PipelineStep], dataSourceRepo: DataSourceRepository,
        assertionSink: AssertionSink, truncationSink: TruncationSink, retain: Set[NodeKey], onNodeProgress: (NodeKey, Long) => Unit,
        writeBackSink: WriteBackSink, ownerUserId: Option[String]
    )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = {
      executions.incrementAndGet()
      real.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, retain, onNodeProgress, writeBackSink, ownerUserId)
    }
  }

  private val roomy = PipelineRunGuardConfig(1000, 3600, 1000, 15, 1000)

  private def service(backend: PipelineExecutionBackend, pRepo: PipelineRepository = pipelineRepo, sRepo: PipelineStepRepository = stepRepo): PipelineRunService =
    new PipelineRunService(
      pRepo, sRepo, dsRepo, runRepo, new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      outputRepo = outRepo, nodeSnapshotRepo = snapRepo, pipelineRunGuardRepo = guardRepo,
      executionBackend = backend, guardConfig = roomy
    )

  private val SrcSchema = """[{"name":"name","type":"string"},{"name":"score","type":"float"}]"""
  private val Rows      = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0]]}"""

  private def seedUser(): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    priv(sqlu"""INSERT INTO users (id, email, display_name, created_at, updated_at)
                VALUES ($id::uuid, ${"u-" + id + "@example.test"}, 'U', now(), now())""")
    id
  }

  private def seedSource(ownerId: String, inferred: String = SrcSchema): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    priv(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, Rows),
      sqlu"UPDATE data_sources SET inferred_schema = $inferred::jsonb WHERE id = $dsId"
    ))
    dsId
  }

  /** A pipeline of a brand-new owner over a source that owner owns, with one passing assert step. */
  private def seedPipeline(ownerId: String): PipelineId = {
    import PostgresProfile.api._
    val dsId = seedSource(ownerId)
    val pid  = UUID.randomUUID().toString
    priv(DBIO.seq(
      sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())",
      sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"
    ))
    val p = PipelineId(pid)
    val parent0 = stepRepo.trunkOf(await(stepRepo.listByPipelineInternal(p))).lastOption.map(_.id)
    await(stepRepo.insertInternal(p, "assert", AssertConfig(Vector(AssertRule("notNull", Some("name"), JsObject.empty, "error"))), true, parent0, explicitRootId = None))
    p
  }

  private def grant(p: PipelineId, role: String): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = seedUser()
    priv(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                VALUES ('pipeline', ${p.value}, $id::uuid, $role, now())""")
    AuthenticatedUser(UserId(id))
  }
  private def grantEditor(p: PipelineId): AuthenticatedUser = grant(p, "editor")
  private def grantViewer(p: PipelineId): AuthenticatedUser = grant(p, "viewer")

  private def revoke(p: PipelineId, who: AuthenticatedUser): Unit = {
    import PostgresProfile.api._
    priv(sqlu"DELETE FROM resource_permissions WHERE resource_type = 'pipeline' AND resource_id = ${p.value} AND grantee_id = ${who.id.value}::uuid")
  }

  private def deletePipeline(p: PipelineId): Unit = {
    import PostgresProfile.api._
    priv(sqlu"DELETE FROM pipelines WHERE id = ${p.value}")
  }

  private def setSourceSchema(p: PipelineId, inferred: String): Unit = {
    import PostgresProfile.api._
    priv(sqlu"""UPDATE data_sources SET inferred_schema = $inferred::jsonb
                WHERE id = (SELECT data_source_id FROM pipeline_roots WHERE pipeline_id = ${p.value} ORDER BY position LIMIT 1)""")
  }

  private def pipelineService: PipelineService = new PipelineService(pipelineRepo, stepRepo, dsRepo, outputRepo = outRepo)

  private def drift(p: PipelineId, who: AuthenticatedUser): Option[SourceSchemaDriftResponse] = {
    val r = await(pipelineService.analyze(p, who))
    withClue(s"analyze got $r: ") { r.isRight shouldBe true }
    r.toOption.get.sourceSchemaDrift
  }

  private def firstStep(p: PipelineId): PipelineStep = await(stepRepo.listByPipelineInternal(p)).head

  private def seedOutput(p: PipelineId, ownerId: String, stepBound: Boolean): OutputId =
    await(outRepo.insertInternal(p, if (stepBound) Some(firstStep(p).id) else None, UserId(ownerId), "out", OutputKind.Table, explicitRootId = None)).id

  private def isNotFound(r: Either[ServiceError, _]): Boolean = r.left.toOption.exists(_.isInstanceOf[ServiceError.NotFound])
  private def isForbidden(r: Either[ServiceError, _]): Boolean = r.left.toOption.exists(_.isInstanceOf[ServiceError.Forbidden])
  private def notFoundMessage(r: Either[ServiceError, _]): String =
    r.left.toOption.collect { case ServiceError.NotFound(m) => m }.getOrElse("")

  /** Seam R: the grant is revoked when the roots are read inside `previewAtNode` -- after its own `findByIdShared`. */
  private final class RevokeAfterRootsRepository(who: AuthenticatedUser, p: PipelineId) extends PipelineRepository(ctx, dsRepo) {
    override def listRootDataSourceIdsInternal(id: PipelineId): Future[Vector[(PipelineRootId, DataSourceId)]] =
      super.listRootDataSourceIdsInternal(id).map { roots => revoke(p, who); roots }
  }

  /** S1: the pipeline is deleted right after a `findByIdShared` returned it (the all-Outputs arm's outer read is
   *  never used with this fixture; see the single-Output and step cases). */
  private final class DeleteAfterAccessCheckRepository extends PipelineRepository(ctx, dsRepo) {
    override def findByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[Pipeline]] =
      super.findByIdShared(id, callerOpt).map { found => deletePipeline(id); found }
  }

  /** S2: the pipeline is deleted when the step list is read -- after the roots resolved. */
  private final class DeleteAtStepListRepository extends PipelineStepRepository(ctx) {
    private val armed = new AtomicBoolean(true)
    override def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[PipelineStep]] =
      super.listByPipelineInternal(pipelineId).map { steps => if (armed.compareAndSet(true, false)) deletePipeline(pipelineId); steps }
  }

  private final class SpyAiClient extends AiStepClient {
    val calls = new AtomicInteger(0)
    override def complete(request: AiStepRequest): Future[Either[AiStepFailure, String]] = {
      calls.incrementAndGet()
      Future.successful(Left(AiStepFailure.Unavailable("spy: not a real client")))
    }
  }

  private def aiService(spy: AiStepClient): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, stepRepo, dsRepo, runRepo, new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      outputRepo = outRepo, nodeSnapshotRepo = snapRepo, pipelineRunGuardRepo = guardRepo, aiStepClient = spy, guardConfig = roomy
    )

  private def seedAiStep(p: PipelineId): PipelineStep = {
    val parent = stepRepo.trunkOf(await(stepRepo.listByPipelineInternal(p))).lastOption.map(_.id)
    val cfg = AnalyzeWithAiConfig("name", "go", Vector(AnalyzeWithAiOutputField("sentiment", "string")))
    await(stepRepo.insertInternal(p, "analyzewithai", cfg, true, parent, explicitRootId = None))
  }

  private val Widened = """[{"name":"name","type":"string"},{"name":"score","type":"float"},{"name":"extra","type":"string"}]"""

  // ---------------------------------------------------------------------------------------------------------------
  "a grantee's analyze schema drift" should {

    "[DEFECT, red on main] equal the owner's drift (non-empty) for an editor and for a viewer" in {
      val ownerId = seedUser(); val owner = AuthenticatedUser(UserId(ownerId)); val p = seedPipeline(ownerId)
      val ed = grantEditor(p); val vw = grantViewer(p)
      await(service(new SpyBackend).submit(p, isDry = false, owner)).isRight shouldBe true
      setSourceSchema(p, Widened)
      val ownerDrift = drift(p, owner)
      withClue("the owner's drift must name the added column: ") { ownerDrift.map(_.addedColumns.map(_.name)) shouldBe Some(Vector("extra")) }
      drift(p, ed) shouldBe ownerDrift
      drift(p, vw) shouldBe ownerDrift
    }

    "[GUARD, failable by M2] report NO drift to an editor or a viewer when the source schema is unchanged since the baseline" in {
      val ownerId = seedUser(); val owner = AuthenticatedUser(UserId(ownerId)); val p = seedPipeline(ownerId)
      val ed = grantEditor(p); val vw = grantViewer(p)
      await(service(new SpyBackend).submit(p, isDry = false, owner)).isRight shouldBe true
      drift(p, owner) shouldBe None
      drift(p, ed) shouldBe None
      drift(p, vw) shouldBe None
    }

    "[PIN, no mutation] leave the owner's own drift unchanged" in {
      val ownerId = seedUser(); val owner = AuthenticatedUser(UserId(ownerId)); val p = seedPipeline(ownerId)
      await(service(new SpyBackend).submit(p, isDry = false, owner)).isRight shouldBe true
      setSourceSchema(p, Widened)
      drift(p, owner).map(_.addedColumns.map(_.name)) shouldBe Some(Vector("extra"))
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  "a step preview whose grant is revoked after the last ACL read (seam R)" should {

    "[DEFECT, red on main] be refused 403 for an editor and for a viewer (non-AI closure), never executing" in {
      for (role <- Seq("editor", "viewer")) {
        val ownerId = seedUser(); val p = seedPipeline(ownerId); val who = grant(p, role)
        val backend = new SpyBackend
        val r = await(service(backend, new RevokeAfterRootsRepository(who, p)).previewStep(p, firstStep(p).id.value, who))
        withClue(s"$role got $r: ") { isForbidden(r) shouldBe true }
        withClue(s"$role: ") { backend.executions.get shouldBe 0 }
      }
    }
  }

  "an Output preview whose grant is revoked after the last ACL read (seam R)" should {

    "[DEFECT, red on main] be refused 403 on the single-Output and the all-Outputs arm, step-bound and source-bound, never executing" in {
      for (role <- Seq("editor", "viewer"); stepBound <- Seq(true, false); single <- Seq(true, false)) {
        val ownerId = seedUser(); val p = seedPipeline(ownerId); val who = grant(p, role)
        val oid = seedOutput(p, ownerId, stepBound)
        val backend = new SpyBackend
        val svc = service(backend, new RevokeAfterRootsRepository(who, p))
        val r = await(svc.previewOutputs(p, if (single) Some(oid) else None, who))
        withClue(s"$role stepBound=$stepBound single=$single got $r: ") { isForbidden(r) shouldBe true }
        withClue(s"$role stepBound=$stepBound single=$single: ") { backend.executions.get shouldBe 0 }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  "a preview of a pipeline deleted mid-request" should {

    "[DEFECT, red on main] answer a step preview 404 (S1), never executing" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId); val ed = grantEditor(p)
      val stepId = firstStep(p).id.value
      val backend = new SpyBackend
      val r = await(service(backend, new DeleteAfterAccessCheckRepository).previewStep(p, stepId, ed))
      withClue(s"got $r: ") { isNotFound(r) shouldBe true }
      notFoundMessage(r) should startWith("Pipeline not found")
      backend.executions.get shouldBe 0
    }

    "[DEFECT, red on main] answer a single-Output preview 404 (S1), step-bound and source-bound, never executing" in {
      for (stepBound <- Seq(true, false)) {
        val ownerId = seedUser(); val p = seedPipeline(ownerId); val ed = grantEditor(p)
        val oid = seedOutput(p, ownerId, stepBound)
        val backend = new SpyBackend
        val r = await(service(backend, new DeleteAfterAccessCheckRepository).previewOutputs(p, Some(oid), ed))
        withClue(s"stepBound=$stepBound got $r: ") { isNotFound(r) shouldBe true }
        withClue(s"stepBound=$stepBound: ") { notFoundMessage(r) should startWith("Pipeline not found") }
        backend.executions.get shouldBe 0
      }
    }

    "[DEFECT, red on main] answer a step preview and a step-bound single-Output preview 404 'Pipeline not found' when deleted at the step-list read (S2)" in {
      val ownerId = seedUser(); val p1 = seedPipeline(ownerId); val ed1 = grantEditor(p1)
      val p2 = seedPipeline(ownerId); val ed2 = grantEditor(p2); val oid = seedOutput(p2, ownerId, stepBound = true)
      val backend = new SpyBackend
      val rStep = await(service(backend, sRepo = new DeleteAtStepListRepository).previewStep(p1, firstStep(p1).id.value, ed1))
      val rOut  = await(service(backend, sRepo = new DeleteAtStepListRepository).previewOutputs(p2, Some(oid), ed2))
      withClue(s"step got $rStep: ") { isNotFound(rStep) shouldBe true }
      notFoundMessage(rStep) should startWith("Pipeline not found")
      withClue(s"output got $rOut: ") { isNotFound(rOut) shouldBe true }
      notFoundMessage(rOut) should startWith("Pipeline not found")
      backend.executions.get shouldBe 0
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  "live previews" should {

    "[GUARD, failable by M5] still let a viewer preview a non-AI closure; deny a viewer an AI closure with zero model calls; allow an editor an AI closure" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId); val vw = grantViewer(p)
      await(service(new SpyBackend).previewStep(p, firstStep(p).id.value, vw)).isRight shouldBe true

      val q = seedPipeline(ownerId); val ai = seedAiStep(q); val vw2 = grantViewer(q); val ed2 = grantEditor(q)
      val denied = new SpyAiClient
      val rViewer = await(aiService(denied).previewStep(q, ai.id.value, vw2))
      withClue(s"viewer got $rViewer: ") { isForbidden(rViewer) shouldBe true }
      denied.calls.get shouldBe 0

      val reached = new SpyAiClient
      val rEditor = await(aiService(reached).previewStep(q, ai.id.value, ed2))
      withClue(s"editor got $rEditor: ") { isForbidden(rEditor) shouldBe false }
      reached.calls.get should be > 0
    }

    "[PIN, no mutation] still let the owner and a live editor/viewer preview a step, a single Output and all Outputs" in {
      val ownerId = seedUser(); val owner = AuthenticatedUser(UserId(ownerId)); val p = seedPipeline(ownerId)
      val ed = grantEditor(p); val vw = grantViewer(p)
      val oid = seedOutput(p, ownerId, stepBound = true)
      val svc = service(new SpyBackend)
      for (who <- Seq(owner, ed, vw)) {
        await(svc.previewStep(p, firstStep(p).id.value, who)).isRight shouldBe true
        await(svc.previewOutputs(p, Some(oid), who)).isRight shouldBe true
        await(svc.previewOutputs(p, None, who)).isRight shouldBe true
      }
    }
  }
}
