package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model._
import com.helio.domain.pipelines.PipelineCycleValidator
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.dbio.DBIO
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1101 tasks 1.1/1.2: `PipelineRootRepository.findReadEdgesVisibleTo` and
 *  `PipelineStepRepository.findUpsertWriteEdges` are the two graph-read queries
 *  `PipelineCycleValidator`'s callers compose the cycle check from. Both must be scoped by an
 *  EXPLICIT join (owner or named `resource_permissions` grantee), never RLS/the
 *  `app.current_user_id` GUC -- proven here by running each query under BOTH `withUserContext`
 *  AND `withSystemContext` and asserting the returned set is identical either way (design.md
 *  Decision 2's round-2 revision). */
class PipelineCycleGraphQueriesSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContextLike                 = _
  private var rootRepo: PipelineRootRepository   = _
  private var stepRepo: PipelineStepRepository   = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val realCtx = new DbContext(db, db)
    ctx      = new DbContextLike(realCtx)
    rootRepo = new PipelineRootRepository(realCtx)
    stepRepo = new PipelineStepRepository(realCtx)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Thin wrapper exposing both `withUserContext`/`withSystemContext` for the "run the same DBIO
   *  under both connections" proof below, without importing Slick's DBIO type into every test
   *  line. */
  private class DbContextLike(real: DbContext) {
    def asUser[R](userId: String)(action: DBIO[R]): Future[R] = real.withUserContext(userId)(action)
    def asSystem[R](action: DBIO[R]): Future[R]                = real.withSystemContext(action)
  }

  private def newUser(): UserId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    UserId(id)
  }

  private def newDataSource(owner: UserId, name: String): DataSourceId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO data_sources
             (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($id, $name, 'dataset', '{"columns":[],"rows":[]}', ${owner.value}::uuid, now(), now())"""))
    DataSourceId(id)
  }

  private def newPipeline(owner: UserId, name: String, roots: Vector[DataSourceId]): PipelineId = {
    import PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at)
             VALUES ($pid, $name, ${owner.value}::uuid, now(), now())"""))
    roots.zipWithIndex.foreach { case (dsId, pos) =>
      val rid = UUID.randomUUID().toString
      await(db.run(sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position, created_at)
               VALUES ($rid, $pid, ${dsId.value}, $pos, now())"""))
    }
    PipelineId(pid)
  }

  /** Seeds an `upsertsource`-kind row DIRECTLY (the repository test-seam design.md's
   *  Testability section describes -- `upsertsource` is unregistered, so no live API path can
   *  create one). `root_id` must reference an actual persisted `pipeline_roots.id` (the CHECK
   *  constraint requires a parentless row to carry one) -- resolved here rather than assuming it
   *  equals the pipeline id. */
  private def newUpsertWriteStep(pipelineId: PipelineId, target: DataSourceId, mode: String = "append"): Unit = {
    import PostgresProfile.api._
    val id     = UUID.randomUUID().toString
    val rootId = await(db.run(sql"select id from pipeline_roots where pipeline_id = ${pipelineId.value} order by position limit 1".as[String].head))
    val configJson = s"""{"target":{"kind":"existingSource","dataSourceId":"${target.value}"},"mode":"$mode"}"""
    await(db.run(sqlu"""INSERT INTO pipeline_steps
             (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
             VALUES ($id, ${pipelineId.value}, 0, 'upsertsource', $configJson::text, now(), now(), $rootId)"""))
  }

  private def grantEditor(pipelineId: PipelineId, grantee: UserId): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', ${pipelineId.value}, ${grantee.value}::uuid, 'editor', now())"""))
  }

  "PipelineRootRepository.findReadEdgesVisibleTo" should {

    "return only the caller's own (owned or shared) read edges, under both withUserContext and withSystemContext" in {
      val owner    = newUser()
      val other    = newUser()
      val grantee  = newUser()
      val ds1      = newDataSource(owner, "owned-src")
      val ds2      = newDataSource(other, "other-src")
      val ownedPid = newPipeline(owner, "owned-pipe", Vector(ds1))
      val otherPid = newPipeline(other, "other-pipe", Vector(ds2))
      grantEditor(ownedPid, grantee)

      // The owner sees only their own pipeline's read edge.
      val ownerEdgesViaUser   = await(ctx.asUser(owner.value)(rootRepo.findReadEdgesVisibleTo(owner.value)))
      val ownerEdgesViaSystem = await(ctx.asSystem(rootRepo.findReadEdgesVisibleTo(owner.value)))
      ownerEdgesViaUser.map(_.pipelineId) shouldBe Vector(ownedPid)
      ownerEdgesViaSystem shouldBe ownerEdgesViaUser

      // The editor grantee sees the SAME edge via their sharing grant (not ownership).
      val granteeEdges = await(ctx.asSystem(rootRepo.findReadEdgesVisibleTo(grantee.value)))
      granteeEdges.map(_.pipelineId) shouldBe Vector(ownedPid)

      // An unrelated caller sees neither.
      val strangerEdges = await(ctx.asSystem(rootRepo.findReadEdgesVisibleTo(newUser().value)))
      strangerEdges shouldBe empty

      // The other owner's own read edge is never visible to `owner`.
      ownerEdgesViaUser.map(_.pipelineId) should not contain otherPid
    }
  }

  "PipelineStepRepository.findUpsertWriteEdges" should {

    "return only ExistingSource-targeted upsertsource write edges visible to the caller" in {
      val owner   = newUser()
      val target  = newDataSource(owner, "target-src")
      val srcRoot = newDataSource(owner, "src-root")
      val pid     = newPipeline(owner, "writer-pipe", Vector(srcRoot))
      newUpsertWriteStep(pid, target)

      val edges = await(ctx.asSystem(stepRepo.findUpsertWriteEdges(owner.value)))
      edges should have size 1
      edges.head.pipelineId shouldBe pid
      edges.head.dataSourceId shouldBe target
    }

    "skip a NewSource-targeted upsertsource step (nothing to close a cycle with yet)" in {
      val owner   = newUser()
      val srcRoot = newDataSource(owner, "src-root-2")
      val pid     = newPipeline(owner, "writer-pipe-2", Vector(srcRoot))
      import PostgresProfile.api._
      val id     = UUID.randomUUID().toString
      val rootId = await(db.run(sql"select id from pipeline_roots where pipeline_id = ${pid.value} order by position limit 1".as[String].head))
      await(db.run(sqlu"""INSERT INTO pipeline_steps
               (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
               VALUES ($id, ${pid.value}, 0, 'upsertsource', '{"target":{"kind":"newSource","name":"fresh"},"mode":"append"}'::text, now(), now(), $rootId)"""))

      val edges = await(ctx.asSystem(stepRepo.findUpsertWriteEdges(owner.value)))
      edges shouldBe empty
    }

    "skip a malformed/undecodable config without throwing" in {
      val owner   = newUser()
      val srcRoot = newDataSource(owner, "src-root-3")
      val pid     = newPipeline(owner, "writer-pipe-3", Vector(srcRoot))
      import PostgresProfile.api._
      val id     = UUID.randomUUID().toString
      val rootId = await(db.run(sql"select id from pipeline_roots where pipeline_id = ${pid.value} order by position limit 1".as[String].head))
      await(db.run(sqlu"""INSERT INTO pipeline_steps
               (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
               VALUES ($id, ${pid.value}, 0, 'upsertsource', '{"target":{"kind":"bogus"}}'::text, now(), now(), $rootId)"""))

      noException should be thrownBy await(ctx.asSystem(stepRepo.findUpsertWriteEdges(owner.value)))
      await(ctx.asSystem(stepRepo.findUpsertWriteEdges(owner.value))) shouldBe empty
    }

    "exclude another tenant's write edge even though this query runs under withSystemContext (BYPASSRLS)" in {
      val owner       = newUser()
      val otherOwner  = newUser()
      val ownTarget   = newDataSource(owner, "own-target")
      val ownRoot     = newDataSource(owner, "own-root")
      val otherTarget = newDataSource(otherOwner, "other-target")
      val otherRoot   = newDataSource(otherOwner, "other-root")
      val ownPid      = newPipeline(owner, "own-writer", Vector(ownRoot))
      val otherPid    = newPipeline(otherOwner, "other-writer", Vector(otherRoot))
      newUpsertWriteStep(ownPid, ownTarget)
      newUpsertWriteStep(otherPid, otherTarget)

      val edges = await(ctx.asSystem(stepRepo.findUpsertWriteEdges(owner.value)))
      edges.map(_.pipelineId) shouldBe Vector(ownPid)
      edges.map(_.pipelineId) should not contain otherPid
    }
  }
}
