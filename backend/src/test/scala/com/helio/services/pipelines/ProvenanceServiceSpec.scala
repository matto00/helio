package com.helio.services.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines.ProvenanceResponses
import com.helio.domain.model._
import com.helio.domain.steps.SecondaryInput
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.testsupport.ProvenanceFixtures
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1206: `ProvenanceService` chain resolution (one root, join Lane/Source secondaries, union,
 *  lookup, deleted source, root-bound), last run, assertion counts, ACL, and the bounded-read
 *  guarantee (design.md D6) measured at the `DbContext` seam, so ANY repository read -- not just
 *  the ones this test happens to know about -- is counted. */
class ProvenanceServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with JsonProtocols {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database            = _
  private var appDb: JdbcBackend.Database         = _
  private val reads                               = new AtomicInteger(0)

  private var outputRepo: OutputRepository         = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var service: ProvenanceService           = _
  private var fx: ProvenanceFixtures               = _

  private val ownerId   = UUID.randomUUID().toString
  private val viewerId  = UUID.randomUUID().toString
  private val strangerId = UUID.randomUUID().toString
  private val owner     = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    // Non-superuser app pool so `findById`'s RLS sharing check is REAL (a superuser bypasses RLS).
    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute("CREATE ROLE helio_app_test_provenance NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN")
      stmt.execute("GRANT helio_app_test_provenance TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test_provenance")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test_provenance")
      stmt.close()
    } finally superConn.close()
    val appCfg = new HikariConfig()
    appCfg.setDataSource(embeddedPostgres.getPostgresDatabase)
    appCfg.setMaximumPoolSize(10)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test_provenance")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(10))

    // Counts every `withUserContext`/`withSystemContext` call = one repository read/round trip.
    val ctx = new DbContext(appDb, db) {
      override def withUserContext[R](userId: String)(action: slick.dbio.DBIO[R]): Future[R] = { reads.incrementAndGet(); super.withUserContext(userId)(action) }
      override def withSystemContext[R](action: slick.dbio.DBIO[R]): Future[R]               = { reads.incrementAndGet(); super.withSystemContext(action) }
    }
    val dataSourceRepo = new DataSourceRepository(ctx)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    val stepRepo       = new PipelineStepRepository(ctx)
    val rootRepo       = new PipelineRootRepository(ctx)
    val runRepo        = new PipelineRunRepository(ctx)
    val snapshotRepo   = new NodeSnapshotRepository(ctx)
    outputRepo         = new OutputRepository(ctx)
    permissionRepo     = new ResourcePermissionRepository(ctx)
    service            = new ProvenanceService(outputRepo, pipelineRepo, stepRepo, rootRepo, dataSourceRepo, runRepo, snapshotRepo)
    fx                 = new ProvenanceFixtures(owner, dataSourceRepo, pipelineRepo, stepRepo, rootRepo, runRepo, snapshotRepo)

    import PostgresProfile.api._
    Seq(ownerId, viewerId, strangerId).foreach { id =>
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    }
  }

  override def afterAll(): Unit = { appDb.close(); db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def output(p: PipelineId, step: Option[PipelineStep], root: Option[PipelineRoot] = None): Output =
    await(outputRepo.insertInternal(p, step.map(_.id), owner.id, "out", OutputKind.Table, explicitRootId = root.map(_.id)))

  private def chain(o: Output): ProvenanceChain = await(service.forOutput(o))

  private def err(reason: String, observed: Option[String] = None, sev: String = "error", passed: Boolean, stepId: PipelineStepId) =
    AssertionResult(stepId.value, "notNull", Some("amount"), sev, passed, observed, None)

  "ProvenanceService" should {
    "one root: returns that source, the step path root-to-node, last run and own-node snapshot row count" in {
      val b  = fx.newPipeline("pipe-one", Vector("Sales"))
      val s1 = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      val s2 = fx.filterStep(b.pipelineId, Some(s1.id))
      val o  = output(b.pipelineId, Some(s2))
      fx.snapshot(b.pipelineId, Some(s2.id), None, rows = 3)
      fx.run(b.pipelineId, "succeeded")

      val c = chain(o)
      c.pipelineName shouldBe "pipe-one"
      c.sources.map(s => (s.name, s.kind)) shouldBe Vector(("Sales", "dataset"))
      c.nodePath shouldBe Vector("filter", "filter")
      c.lastRun.map(_.status) shouldBe Some("succeeded")
      c.lastRun.flatMap(_.rowCount) shouldBe Some(3L)
    }

    "two roots via a join Lane secondary: both roots' sources, trunk-first by root position" in {
      val b  = fx.newPipeline("pipe-lane", Vector("Left", "Right"))
      val sa = fx.filterStep(b.pipelineId, None, Some(b.roots(0)))
      val sb = fx.filterStep(b.pipelineId, None, Some(b.roots(1)))
      val j  = fx.joinStep(b.pipelineId, sa.id, SecondaryInput.Lane(sb.id.value))
      val c  = chain(output(b.pipelineId, Some(j)))
      c.sources.map(_.name) shouldBe Vector("Left", "Right")
      c.nodePath shouldBe Vector("filter", "join")
    }

    "join with a direct Source secondary: that data source is included (it is NOT a pipeline root)" in {
      val b      = fx.newPipeline("pipe-src", Vector("Main"))
      val extra  = fx.newSource("Extra")
      val sa     = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      val j      = fx.joinStep(b.pipelineId, sa.id, SecondaryInput.Source(extra.id.value))
      chain(output(b.pipelineId, Some(j))).sources.map(_.name) shouldBe Vector("Main", "Extra")
    }

    "union and lookup secondaries each contribute their Source; duplicates collapse" in {
      val b     = fx.newPipeline("pipe-ul", Vector("Base"))
      val u     = fx.newSource("UnionSrc")
      val l     = fx.newSource("LookupSrc")
      val sa    = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      val un    = fx.unionStep(b.pipelineId, sa.id, SecondaryInput.Source(u.id.value))
      val lk    = fx.lookupStep(b.pipelineId, un.id, SecondaryInput.Source(l.id.value))
      val dup   = fx.unionStep(b.pipelineId, lk.id, SecondaryInput.Source(u.id.value))
      val c     = chain(output(b.pipelineId, Some(dup)))
      c.sources.map(_.name) shouldBe Vector("Base", "UnionSrc", "LookupSrc")
      c.nodePath shouldBe Vector("filter", "union", "lookup", "union")
    }

    "a Source-kind secondary that no longer resolves is omitted, never a placeholder" in {
      val b  = fx.newPipeline("pipe-gone", Vector("Kept"))
      val sa = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      val j  = fx.joinStep(b.pipelineId, sa.id, SecondaryInput.Source(UUID.randomUUID().toString))
      chain(output(b.pipelineId, Some(j))).sources.map(_.name) shouldBe Vector("Kept")
    }

    "root-bound Output: that root's source only, empty nodePath, assertions defined=false rootBound=true" in {
      val b = fx.newPipeline("pipe-root", Vector("First", "Second"))
      val o = output(b.pipelineId, None, Some(b.roots(1)))
      fx.snapshot(b.pipelineId, None, Some(b.roots(1)), rows = 2)
      fx.run(b.pipelineId, "succeeded")
      val c = chain(o)
      c.sources.map(_.name) shouldBe Vector("Second")
      c.nodePath shouldBe Vector.empty
      c.assertions shouldBe ProvenanceAssertions(defined = false, 0, 0, 0, rootBound = true)
      c.lastRun.flatMap(_.rowCount) shouldBe Some(2L)
    }

    "no assert step at the node: defined=false and all counts zero (never 'all passed')" in {
      val b  = fx.newPipeline("pipe-noassert", Vector("S"))
      val s1 = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      fx.run(b.pipelineId, "succeeded")
      chain(output(b.pipelineId, Some(s1))).assertions shouldBe ProvenanceAssertions(defined = false, 0, 0, 0, rootBound = false)
    }

    "assert node: error failures -> failed, non-error failures -> warned, passes -> passed; dry runs ignored" in {
      val b  = fx.newPipeline("pipe-assert", Vector("S"))
      val a  = fx.assertStep(b.pipelineId, None, Some(b.roots.head))
      val o  = output(b.pipelineId, Some(a))
      fx.run(b.pipelineId, "succeeded", assertions = Seq(
        err("p", passed = true, stepId = a.id), err("p", passed = true, stepId = a.id),
        err("e", passed = false, stepId = a.id, observed = Some("SECRET-OBSERVED")),
        err("w", passed = false, stepId = a.id, sev = "warn")
      ))
      Thread.sleep(5)
      fx.dryRun(b.pipelineId, Seq(err("d", passed = false, stepId = a.id), err("d", passed = false, stepId = a.id)))
      chain(o).assertions shouldBe ProvenanceAssertions(defined = true, passed = 2, failed = 1, warned = 1, rootBound = false)
    }

    "never run: lastRun is None" in {
      val b  = fx.newPipeline("pipe-never", Vector("S"))
      val s1 = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      chain(output(b.pipelineId, Some(s1))).lastRun shouldBe None
    }

    "ACL: an unreadable Output is NotFound; a viewer grant on the pipeline can read it" in {
      val b  = fx.newPipeline("pipe-acl", Vector("S"))
      val s1 = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      val o  = output(b.pipelineId, Some(s1))
      await(service.forUser(o.id, AuthenticatedUser(UserId(strangerId)))) shouldBe Left(ServiceError.NotFound("Output not found"))
      await(permissionRepo.insert(ResourcePermission("pipeline", b.pipelineId.value, Some(UserId(viewerId)), Role.Viewer, Instant.now())))
      await(service.forUser(o.id, AuthenticatedUser(UserId(viewerId)))).map(_.pipelineName) shouldBe Right("pipe-acl")
    }

    "authenticated JSON: explicit nulls for a never-run pipeline, ids present; public projection has none of them" in {
      val b  = fx.newPipeline("pipe-json", Vector("S"))
      val s1 = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      val c  = chain(output(b.pipelineId, Some(s1)))
      val auth = ProvenanceResponses.authenticated(c).toJson.asJsObject
      auth.fields("lastRun") shouldBe JsNull
      auth.fields.keySet shouldBe Set("outputId", "pipeline", "sources", "nodePath", "lastRun", "assertions")
      auth.fields("pipeline").asJsObject.fields.keySet shouldBe Set("id", "name")
      val pub = ProvenanceResponses.public(c).toJson.asJsObject
      pub.fields.keySet shouldBe Set("pipeline", "sources", "nodePath", "lastRun", "assertions")
      pub.fields("pipeline").asJsObject.fields.keySet shouldBe Set("name")
      pub.fields("sources").convertTo[Vector[JsObject]].head.fields.keySet shouldBe Set("name", "kind")
      pub.fields("assertions").asJsObject.fields.keySet shouldBe Set("defined", "passed", "failed", "warned")
    }

    "bounded reads: a 1-root/1-step/1-assertion Output and a 3-root/many-step/many-assertion Output cost the SAME number of reads (<= 7 after the Output is known, <= 8 via forUser)" in {
      val a1 = fx.newPipeline("pipe-count-a", Vector("S"))
      val aa = fx.assertStep(a1.pipelineId, None, Some(a1.roots.head))
      val oa = output(a1.pipelineId, Some(aa))
      fx.run(a1.pipelineId, "succeeded", assertions = Seq(err("p", passed = true, stepId = aa.id)))
      fx.snapshot(a1.pipelineId, Some(aa.id), None, rows = 1)

      val b1 = fx.newPipeline("pipe-count-b", Vector("R1", "R2", "R3"))
      val extra = fx.newSource("Extra")
      val f1 = fx.filterStep(b1.pipelineId, None, Some(b1.roots(0)))
      val f2 = fx.filterStep(b1.pipelineId, None, Some(b1.roots(1)))
      val f3 = fx.filterStep(b1.pipelineId, None, Some(b1.roots(2)))
      val j1 = fx.joinStep(b1.pipelineId, f1.id, SecondaryInput.Lane(f2.id.value))
      val j2 = fx.joinStep(b1.pipelineId, j1.id, SecondaryInput.Lane(f3.id.value))
      val u1 = fx.unionStep(b1.pipelineId, j2.id, SecondaryInput.Source(extra.id.value))
      val ab = fx.assertStep(b1.pipelineId, Some(u1.id))
      val ob = output(b1.pipelineId, Some(ab))
      fx.run(b1.pipelineId, "succeeded", assertions = (1 to 6).map(i => err("x", passed = i % 2 == 0, stepId = ab.id)))
      fx.snapshot(b1.pipelineId, Some(ab.id), None, rows = 40)

      def measure(o: Output): Int = { val before = reads.get(); chain(o); reads.get() - before }
      val readsA = measure(oa)
      val readsB = measure(ob)
      readsA shouldBe readsB
      readsA should be <= 7

      def measureUser(o: Output): Int = { val before = reads.get(); await(service.forUser(o.id, owner)); reads.get() - before }
      val userA = measureUser(oa)
      val userB = measureUser(ob)
      userA shouldBe userB
      userA should be <= 8
      info(s"reads: forOutput=$readsA, forUser=$userA (fixture B: 3 roots + Source secondary + 6 assertions)")
    }
  }
}
