package com.helio.services

import com.helio.api.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.{CreateAgentMemoryRequest, PutAgentPreferencesRequest, WorkspaceContextAgentSection}
import com.helio.domain._
import com.helio.infrastructure._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile
import slick.jdbc.PostgresProfile.api._

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-521 (420-C) tasks.md 7.1/7.2 — `WorkspaceContextService.assemble`'s `agentContext`
 *  composition: population from stored `AgentPreferences`/`AgentMemoryEntry` records, the
 *  empty-default degrade paths (neither stored; the underlying services not wired), the top-20
 *  ranking (design.md Decision 3), and the touch-on-surface side effect (design.md Decision 4,
 *  the persistence spec's two touch scenarios).
 *
 *  A new file, not folded into the already-968-line `WorkspaceContextServiceSpec` — mirrors that
 *  spec's existing split-into-focused-files precedent (`WorkspaceContextServiceClassifySemanticRoleSpec`
 *  / `WorkspaceContextServiceApplyBudgetSpec` / etc.), and needs its own DB-backed
 *  `AgentPreferencesService`/`AgentMemoryService` collaborators the base spec doesn't wire. */
class WorkspaceContextServiceAgentContextSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  // DataSourceService (a WorkspaceContextService collaborator) needs an implicit Materializer +
  // typed ActorSystem in scope -- ScalatestRouteTest supplies the classic `system`/Materializer;
  // this converts it to the typed flavor, mirroring WorkspaceContextServiceSpec's identical setup.
  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  private var agentMemoryRepo: AgentMemoryRepository             = _
  private var agentPreferencesService: AgentPreferencesService   = _
  private var agentMemoryService: AgentMemoryService              = _
  private var serviceWithAgent: WorkspaceContextService           = _
  private var serviceWithoutAgent: WorkspaceContextService         = _

  private val theUserId = UUID.randomUUID().toString
  private val theUser   = AuthenticatedUser(UserId(theUserId))

  // A retention window large enough that none of this file's non-retention-focused tests are
  // ever affected by pruning (HEL-531 / 420-E; retention itself is covered by
  // AgentMemoryRepositorySpec).
  private val NoPruning = 36500

  override def beforeAll(): Unit = {
    // Local (method-scoped), not a class-level field -- shadows RouteTest's inherited `executor`
    // cleanly instead of competing with it, mirroring WorkspaceContextServiceSpec's identical
    // local-scope pattern (a class-level `implicit val ec` is ambiguous with a trait member at the
    // same scope depth).
    implicit val ec: ExecutionContext = routeEc

    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    val dataSourceRepo   = new DataSourceRepository(ctx)
    val dataTypeRepo     = new DataTypeRepository(ctx)
    val dataTypeRowRepo  = new DataTypeRowRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val dashboardRepo    = new DashboardRepository(ctx)

    val tmpDir = Files.createTempDirectory("helio-workspace-context-agent-spec")
    val fs     = new LocalFileSystem(tmpDir)
    val dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    val dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    val registry       = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo  = new ResourcePermissionRepository(ctx)
    val accessChecker   = new AccessCheckerImpl(permissionRepo, registry)
    val dashboardService = new DashboardService(dashboardRepo, accessChecker)

    agentMemoryRepo = new AgentMemoryRepository(ctx)
    val agentPreferencesRepo = new AgentPreferencesRepository(ctx)
    agentPreferencesService = new AgentPreferencesService(agentPreferencesRepo)
    agentMemoryService      = new AgentMemoryService(agentMemoryRepo, agentPreferencesService)

    serviceWithAgent = new WorkspaceContextService(
      dashboardService, dataSourceService, dataTypeService, pipelineService,
      Some(agentPreferencesService), Some(agentMemoryService)
    )
    // Deliberately omits the two agent-service params (defaults to None, None) — the
    // "underlying services aren't wired" degrade path (design.md Decision 2).
    serviceWithoutAgent = new WorkspaceContextService(dashboardService, dataSourceService, dataTypeService, pipelineService)

    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($theUserId::uuid, ${s"$theUserId@test.local"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def cleanDb(): Unit = {
    await(db.run(sqlu"DELETE FROM agent_memory"))
    await(db.run(sqlu"DELETE FROM agent_preferences"))
  }

  private def rawEntry(content: String, createdAt: Instant, lastUsedAt: Option[Instant] = None): AgentMemoryEntry =
    AgentMemoryEntry(
      id         = AgentMemoryId(UUID.randomUUID().toString),
      ownerId    = UserId(theUserId),
      kind       = AgentMemoryKind.Fact,
      content    = content,
      createdAt  = createdAt,
      lastUsedAt = lastUsedAt
    )

  // ── 7.1 population ───────────────────────────────────────────────────────

  "assemble (7.1 agentContext population)" should {
    "populate agentContext.preferences and agentContext.memory for a caller with both stored" in {
      cleanDb()
      await(agentPreferencesService.put(
        theUser,
        PutAgentPreferencesRequest(defaultSeriesColors = Some(Vector("#abcabc")), defaultPanelStyle = None, namingConventions = None, extras = None)
      ))
      await(agentMemoryService.add(CreateAgentMemoryRequest("fact", "loves netflix dashboards"), theUser))
      await(agentMemoryService.add(CreateAgentMemoryRequest("goal", "always add sentiment coloring"), theUser))

      val resp = await(serviceWithAgent.assemble(theUser))

      resp.agentContext.preferences.defaultSeriesColors shouldBe Some(Vector("#abcabc"))
      resp.agentContext.memory.map(_.content) should contain allOf ("loves netflix dashboards", "always add sentiment coloring")
      resp.agentContext.memory should have size 2
    }
  }

  // ── 7.1 empty defaults ───────────────────────────────────────────────────

  "assemble (7.1 empty defaults)" should {
    "report empty agentContext when the caller has stored neither preferences nor memory" in {
      cleanDb()
      val resp = await(serviceWithAgent.assemble(theUser))
      resp.agentContext shouldBe WorkspaceContextAgentSection.empty
    }

    "report empty agentContext when agentPreferencesServiceOpt/agentMemoryServiceOpt are None, " +
      "even though the caller has stored data (a partially-wired environment degrades to fully empty)" in {
        cleanDb()
        await(agentPreferencesService.put(theUser, PutAgentPreferencesRequest(Some(Vector("#111111")), None, None, None)))
        await(agentMemoryService.add(CreateAgentMemoryRequest("fact", "should not surface"), theUser))

        val resp = await(serviceWithoutAgent.assemble(theUser))
        resp.agentContext shouldBe WorkspaceContextAgentSection.empty
      }
  }

  // ── 7.1 top-20 ranking ───────────────────────────────────────────────────

  "assemble (7.1 top-20 ranking)" should {
    "surface exactly 20 entries: touched entries most-recently-used first, never-used entries last" in {
      cleanDb()
      // HEL-531 (420-E): relative to "now", not a hardcoded past calendar date -- assemble()'s
      // internal AgentMemoryService.list call now prunes entries past the retention window
      // (default 90 days), so a fixed past date would eventually fall outside it and break this
      // test's own assertions independent of retention (this test isn't about retention at all).
      val base = Instant.now()

      // 15 touched entries, distinct ascending lastUsedAt (touched-15 is the most recently used).
      val touchedEntries = (1 to 15).map(i => rawEntry(s"touched-$i", base.plusSeconds(i.toLong), lastUsedAt = Some(base.plusSeconds(1000L + i.toLong))))
      touchedEntries.foreach(e => await(agentMemoryRepo.add(e, cap = 100, retentionDays = NoPruning)))

      // 10 never-used entries, distinct createdAt, all newer than every touched entry's createdAt.
      val untouchedEntries = (1 to 10).map(i => rawEntry(s"untouched-$i", base.plusSeconds(2000L + i.toLong)))
      untouchedEntries.foreach(e => await(agentMemoryRepo.add(e, cap = 100, retentionDays = NoPruning)))

      val resp = await(serviceWithAgent.assemble(theUser))

      resp.agentContext.memory should have size 20

      val expectedTouchedOrder = touchedEntries.sortBy(_.lastUsedAt.get.toEpochMilli)(Ordering.Long.reverse).map(_.content)
      resp.agentContext.memory.take(15).map(_.content) shouldBe expectedTouchedOrder

      // list()'s createdAt-desc order puts untouched-10 first; only the top 5 (of 10) untouched
      // entries fit once the 15 touched entries have already claimed their slots (15 + 5 = 20).
      resp.agentContext.memory.drop(15).map(_.content) shouldBe
        Vector("untouched-10", "untouched-9", "untouched-8", "untouched-7", "untouched-6")
    }
  }

  // ── 7.2 touch side effect ────────────────────────────────────────────────

  "assemble (7.2 touch side effect)" should {
    "touch each surfaced memory entry's lastUsedAt, leaving non-surfaced entries unchanged" in {
      cleanDb()
      // HEL-531 (420-E): relative to "now" -- see the top-20-ranking test's identical comment.
      val base = Instant.now()

      // 25 never-used entries, distinct createdAt -- rankMemoryEntries keeps list()'s
      // createdAt-desc order for untouched entries, so the 20 most-recently-created are exactly
      // the ones assemble() surfaces (and therefore touches).
      val entries = (1 to 25).map(i => rawEntry(s"entry-$i", base.plusSeconds(i.toLong)))
      entries.foreach(e => await(agentMemoryRepo.add(e, cap = 100, retentionDays = NoPruning)))

      val surfacedIds    = entries.sortBy(_.createdAt.toEpochMilli)(Ordering.Long.reverse).take(20).map(_.id).toSet
      val nonSurfacedIds = entries.map(_.id).toSet -- surfacedIds

      val resp = await(serviceWithAgent.assemble(theUser))
      resp.agentContext.memory should have size 20
      // The wire response reflects PRE-touch values (never re-fetched, design.md Decision 3) --
      // every surfaced entry's lastUsedAt is still absent on THIS response.
      resp.agentContext.memory.foreach(_.lastUsedAt shouldBe None)

      val afterTouch = await(agentMemoryRepo.list(theUser, NoPruning))
      afterTouch.filter(e => surfacedIds.contains(e.id)).foreach(_.lastUsedAt shouldBe defined)
      afterTouch.filter(e => nonSurfacedIds.contains(e.id)).foreach(_.lastUsedAt shouldBe None)
    }
  }

  // ── 7.3 memoryEnabled opt-out (HEL-531 / 420-E tasks.md 5.4) ─────────────

  "assemble (7.3 memoryEnabled opt-out)" should {
    "produce an empty agentContext.memory when memoryEnabled is false, while agentContext.preferences " +
      "still reflects the caller's stored preferences" in {
        cleanDb()
        await(agentPreferencesService.put(
          theUser,
          PutAgentPreferencesRequest(defaultSeriesColors = Some(Vector("#abcabc")), defaultPanelStyle = None, namingConventions = None, extras = None)
        ))
        await(agentPreferencesService.setMemoryEnabled(theUser, enabled = false))
        // Inserted directly via the repository (bypassing AgentMemoryService.add's own opt-out
        // no-op) so this entry genuinely EXISTS and is within the retention window -- proving
        // buildAgentContext skips the list/touch call entirely (design.md Decision 4), not merely
        // that the entry happens to be absent.
        await(agentMemoryRepo.add(rawEntry("should not surface", Instant.now()), cap = 100, retentionDays = NoPruning))

        val resp = await(serviceWithAgent.assemble(theUser))

        resp.agentContext.memory shouldBe Vector.empty
        resp.agentContext.preferences.defaultSeriesColors shouldBe Some(Vector("#abcabc"))
        resp.agentContext.preferences.memoryEnabled shouldBe false
      }
  }
}
