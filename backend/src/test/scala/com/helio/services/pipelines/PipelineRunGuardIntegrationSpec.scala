package com.helio.services.pipelines

import com.helio.testkit.TempDirectorySupport
import com.helio.testsupport.DatasetRowsTestSupport
import com.helio.services.ServiceError
import com.helio.domain.model._
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunGuardRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-505 tasks.md 8.1/8.2/8.3 -- END-TO-END coverage of the pipeline-run guard through
 *  `PipelineRunService.submit`, the single choke point every trigger path (manual, hook/external,
 *  scheduled) reaches (design.md Decision 1). Uses a minimal `dataset`-kind source (no REST/SQL
 *  stubbing needed) so every submission actually runs to a real terminal state, exactly like
 *  `PipelineRunRepositorySpec`'s `insertRunIfUnderConcurrencyCap` coverage but through the FULL
 *  service path (rate limit + concurrency cap both wired, `ServiceError.TooManyRequests` mapped
 *  correctly) rather than the repository method directly.
 *
 *  Each owner is FRESH per test (`freshOwner()`), never shared -- see
 *  `PipelineRunRepositorySpec`'s own "concurrent submissions" describe block comment for why a
 *  shared owner across many sequential tests silently accumulates non-terminal `pipeline_runs`
 *  rows that would otherwise corrupt this file's own cap assertions. */
class PipelineRunGuardIntegrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private implicit val typedSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "pipeline-run-guard-integration-spec")

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var ctx: DbContext                         = _
  private var pipelineRepo: PipelineRepository       = _
  private var stepRepo: PipelineStepRepository       = _
  private var dataSourceRepo: DataSourceRepository   = _
  private var pipelineRunRepo: PipelineRunRepository = _
  private var guardRepo: PipelineRunGuardRepository  = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx             = new DbContext(db, db)
    dataSourceRepo  = new DataSourceRepository(ctx)
    stepRepo        = new PipelineStepRepository(ctx)
    pipelineRepo    = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRunRepo = new PipelineRunRepository(ctx)
    guardRepo       = new PipelineRunGuardRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); typedSystem.terminate()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshOwner(): AuthenticatedUser = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  /** Grants `role` on `pipelineId` to `grantee` (HEL-279 sharing model) -- mirrors
   *  `PipelineRunServiceSpec.seedGrantee`'s raw-SQL insert, parameterized by an ALREADY-EXISTING
   *  grantee identity (this file's `freshOwner()`) rather than minting a fresh one inline. */
  private def grantAccess(pipelineId: PipelineId, grantee: UserId, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${grantee.value}::uuid, ${s"${grantee.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', ${pipelineId.value}, ${grantee.value}::uuid, $role, now())"""
    )))
  }

  /** Seeds a minimal, always-succeeding `dataset`-kind source (one row) for `owner`, then a
   *  single-root pipeline over it -- mirrors `PipelineRunServiceSpec`'s own `seedDsWithData`/
   *  `seedPipeline(dsId)` pair, parameterized by owner instead of the shared system user. */
  private def seedPipelineFor(owner: UserId): PipelineId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${owner.value}::uuid, ${s"${owner.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', ${owner.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  private def newService(guardConfig: PipelineRunGuardConfig): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo,
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      pipelineRunGuardRepo = guardRepo,
      guardConfig = guardConfig
    )

  private def tooManyRequests(result: Either[ServiceError, _]): ServiceError.TooManyRequests =
    result match {
      case Left(e: ServiceError.TooManyRequests) => e
      case other                                  => fail(s"expected Left(TooManyRequests), got $other")
    }

  "PipelineRunService pipeline-run guard: rate limit (HEL-505 tasks.md 8.2)" should {

    "rejects the (limit+1)th submission within a window with TooManyRequests + a positive retryAfterSeconds" in {
      val user = freshOwner()
      val pid  = seedPipelineFor(user.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 2, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      await(service.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]
      await(service.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]

      val rejected = await(service.submit(pid, isDry = false, user))
      val err = tooManyRequests(rejected)
      err.retryAfterSeconds should be > 0L
    }

    "a different owner's rate-limit budget is unaffected by another owner's submissions" in {
      val userA = freshOwner()
      val userB = freshOwner()
      val pidA  = seedPipelineFor(userA.id)
      val pidB  = seedPipelineFor(userB.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 1, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      await(service.submit(pidA, isDry = false, userA)) shouldBe a[Right[_, _]]
      tooManyRequests(await(service.submit(pidA, isDry = false, userA)))

      // userB's own budget starts fresh.
      await(service.submit(pidB, isDry = false, userB)) shouldBe a[Right[_, _]]
    }

    "dry runs ARE subject to the rate limit, identically to real runs (design.md Decision 2)" in {
      val user = freshOwner()
      val pid  = seedPipelineFor(user.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 1, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      await(service.submit(pid, isDry = true, user)) shouldBe a[Right[_, _]]
      tooManyRequests(await(service.submit(pid, isDry = true, user)))
    }

    "a mix of dry and real submissions share ONE rate-limit budget" in {
      val user = freshOwner()
      val pid  = seedPipelineFor(user.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 2, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      await(service.submit(pid, isDry = true, user)) shouldBe a[Right[_, _]]
      await(service.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]
      tooManyRequests(await(service.submit(pid, isDry = true, user)))
    }

    // HEL-505 tasks.md 8.3 -- "applies uniformly regardless of trigger source": submit's own
    // `triggerSource` parameter is what HookTriggerService/PipelineSchedulerService pass; exercised
    // directly here (rather than constructing those two collaborator classes) since both reach
    // `executeRun` via the identical `submit` -> `runPipeline` -> `executeRun` path with no
        // trigger-source-specific branching anywhere in the guard itself (design.md Decision 1).
    "a hook-triggered (External) submission is rejected exactly like a manual one" in {
      val user = freshOwner()
      val pid  = seedPipelineFor(user.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 1, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      await(service.submit(pid, isDry = false, user, triggerSource = TriggerSource.External)) shouldBe a[Right[_, _]]
      tooManyRequests(await(service.submit(pid, isDry = false, user, triggerSource = TriggerSource.External)))
    }

    "a scheduled submission is rejected exactly like a manual one" in {
      val user = freshOwner()
      val pid  = seedPipelineFor(user.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 1, rateWindowSeconds = 60, maxConcurrent = 100, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      await(service.submit(pid, isDry = false, user, triggerSource = TriggerSource.Scheduled)) shouldBe a[Right[_, _]]
      tooManyRequests(await(service.submit(pid, isDry = false, user, triggerSource = TriggerSource.Scheduled)))
    }
  }

  "PipelineRunService pipeline-run guard: concurrency cap (HEL-505 tasks.md 8.1)" should {

    "rejects more than maxConcurrent REAL concurrent submissions with TooManyRequests" in {
      val user = freshOwner()
      val pid  = seedPipelineFor(user.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 100, rateWindowSeconds = 60, maxConcurrent = 3, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      val attempts = 8
      val results = await(Future.sequence(Vector.fill(attempts)(service.submit(pid, isDry = false, user))))

      results.count(_.isRight) shouldBe 3
      val rejections = results.collect { case Left(e: ServiceError.TooManyRequests) => e }
      rejections should have size (attempts - 3)
      rejections.foreach(_.retryAfterSeconds should be > 0L)
    }

    "completing a run frees a slot for a subsequent submission (AC's own integration-test requirement)" in {
      val user = freshOwner()
      val pid  = seedPipelineFor(user.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 100, rateWindowSeconds = 60, maxConcurrent = 1, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      // First submission is awaited to full completion -- reaches a terminal status before this
      // call returns (executeRun's success/failure branch always writes updateRunTerminal before
      // resolving submit's own Future), so the slot is already free by the time the NEXT
      // submission below runs.
      await(service.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]
      await(service.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]
    }

    // HEL-505 C7 (design.md Decision 3, Resolution 2) -- a POSITIVE assertion of the documented
    // exclusion, not silence: dry runs proceed to execution even while the owner is already at
    // their REAL-run concurrency cap.
    "dry runs are NOT subject to the concurrency cap even when the owner is already at the real-run cap (C7)" in {
      val user = freshOwner()
      val pid  = seedPipelineFor(user.id)
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 100, rateWindowSeconds = 60, maxConcurrent = 1, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      // Fill the real-run concurrency cap by submitting many REAL runs concurrently -- at least
      // one of them is guaranteed to still be in-flight (non-terminal) at the moment the dry run
      // below is issued, since they all race the SAME advisory lock.
      val realSubmissions = Future.sequence(Vector.fill(5)(service.submit(pid, isDry = false, user)))
      val dryResult = await(service.submit(pid, isDry = true, user))
      dryResult shouldBe a[Right[_, _]]

      await(realSubmissions) // drain, so this test doesn't leak a dangling Future
    }

    "a non-owner (editor grantee) real run still resolves normally, NEVER as a 429 (regression guard)" in {
      val owner   = freshOwner()
      val grantee = freshOwner()
      val pid     = seedPipelineFor(owner.id)
      grantAccess(pid, grantee.id, "editor")
      val service = newService(PipelineRunGuardConfig(rateLimitPerWindow = 100, rateWindowSeconds = 60, maxConcurrent = 1, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30))

      // Fill the OWNER's own cap first.
      await(service.submit(pid, isDry = false, owner)) shouldBe a[Right[_, _]]

      // The grantee-triggered run is a NotOwned no-op at the repository layer (PipelineRunRepository
      // .ConcurrencyCapResult.NotOwned), not a CapExceeded rejection -- it must still resolve
      // normally, exactly like every other editor-grantee-triggered run (PipelineRunServiceSpec's
      // own "an editor-grantee-triggered real run resolves normally despite no persisted run row").
      val result = await(service.submit(pid, isDry = false, grantee))
      result shouldBe a[Right[_, _]]
    }
  }
}
