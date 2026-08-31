package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model._
import com.helio.domain.steps.SelectConfig
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-904 task 1.6/1.7 (DB-backed remainder): sibling-scoped
 *  `insertInternal`/`insertAtInternal`/`reorderInternal` and splice-on-delete
 *  for `deleteInternal`, now that the real `parent_step_id` column exists
 *  (V94, task 2.2). See `PipelineStepRepositoryTreeOrderingSpec` for the
 *  pure-function `trunkOf`/`childrenOf`/`tailsOf` coverage this complements. */
class PipelineStepRepositorySpliceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var stepRepo: PipelineStepRepository   = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db       = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    stepRepo = new PipelineStepRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedPipeline(): PipelineId = {
    import PostgresProfile.api._
    val ownerId = "00000000-0000-0000-0000-000000000001"
    val dsId    = UUID.randomUUID().toString
    val dtId    = UUID.randomUUID().toString
    val pid     = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'owner@test.local', now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO data_sources
               (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, now(), now())"""
    )))
    PipelineId(pid)
  }

  "insertInternal / insertAtInternal (sibling-scoped positions)" should {

    "position root inserts among ONLY the root sibling group, ignoring a branch's positions" in {
      val pid    = seedPipeline()
      val root0  = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = None))
      // A branch off root0 with its own sibling positions 0, 1 -- must not
      // influence the next ROOT insert's position.
      await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(root0.id)))
      await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(root0.id)))

      val root1 = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = None))
      root1.position shouldBe 1 // second ROOT sibling, unaffected by the 2 branch children also at position 0/1
      root1.parentStepId shouldBe None
    }

    "insertAtInternal splices within one sibling group only, leaving other groups' positions untouched" in {
      val pid   = seedPipeline()
      val root0 = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = None))
      val branchA = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(root0.id)))
      val branchB = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(root0.id)))
      branchA.position shouldBe 0
      branchB.position shouldBe 1

      // Splice a new step at index 1 within root0's children -- should NOT
      // touch root0 itself (a different sibling group: the pipeline root).
      val spliced = await(stepRepo.insertAtInternal(pid, "select", SelectConfig(Vector.empty), index = 1, parentStepId = Some(root0.id)))
      spliced.position shouldBe 1
      spliced.parentStepId shouldBe Some(root0.id)

      val all = await(stepRepo.listByPipelineInternal(pid))
      all.find(_.id == root0.id).get.position shouldBe 0 // untouched
      all.find(_.id == branchA.id).get.position shouldBe 0
      all.find(_.id == spliced.id).get.position shouldBe 1
      all.find(_.id == branchB.id).get.position shouldBe 2 // pushed down by the splice
    }
  }

  "deleteInternal (splice-on-delete)" should {

    "re-parent the position-0 child into the deleted step's slot, preserving the trunk" in {
      val pid   = seedPipeline()
      val root0 = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = None))
      // root1 is root0's ONLY child (position-0 -- part of the trunk)
      val root1 = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(root0.id)))
      // child is root1's ONLY child (the trunk continuation)
      val child = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(root1.id)))

      val removed = await(stepRepo.deleteInternal(root1.id))
      removed shouldBe Some(0) // no tail subtree -- only the head child, which is re-parented, not deleted

      val remaining = await(stepRepo.listByPipelineInternal(pid))
      remaining.map(_.id) should not contain root1.id
      val reparentedChild = remaining.find(_.id == child.id).get
      reparentedChild.parentStepId shouldBe Some(root0.id) // took over root1's former parent slot
      reparentedChild.position shouldBe root1.position // took over root1's former position

      // The trunk is unbroken: root0 -> child (via trunkOf).
      val trunk = stepRepo.trunkOf(remaining)
      trunk.map(_.id) shouldBe Vector(root0.id, reparentedChild.id)
    }

    "delete every OTHER child (a tail) and its full descendant subtree, reporting the removed count" in {
      val pid   = seedPipeline()
      val root0 = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = None))
      val head  = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(root0.id)))
      val tailRoot  = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(root0.id)))
      val tailChild = await(stepRepo.insertInternal(pid, "select", SelectConfig(Vector.empty), parentStepId = Some(tailRoot.id)))

      val removed = await(stepRepo.deleteInternal(root0.id))
      removed shouldBe Some(2) // tailRoot + tailChild, NOT counting root0 itself or the re-parented head

      val remaining = await(stepRepo.listByPipelineInternal(pid))
      remaining.map(_.id) should contain theSameElementsAs Vector(head.id)
      remaining.map(_.id) should not contain tailRoot.id
      remaining.map(_.id) should not contain tailChild.id
      remaining.find(_.id == head.id).get.parentStepId shouldBe None // re-parented to root0's own parent (the pipeline root)
    }

    "return None for a step that does not exist" in {
      val pid = seedPipeline()
      val removed = await(stepRepo.deleteInternal(PipelineStepId(UUID.randomUUID().toString)))
      removed shouldBe None
      val _ = pid
    }
  }
}
