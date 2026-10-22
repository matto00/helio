package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{AuthenticatedUser, PipelineId, PipelineRootId, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.services.pipelines.PipelineService
import com.helio.testsupport.DraftSaveApiFixture
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.ExecutionContext.Implicits.global
import scala.util.Try

/** HEL-1652 D5: a root removal never reports success unless the root row was deleted. The only way to reach "0 rows deleted"
 *  is a racer removing the root between the service's phase 1 and the transaction, so it is driven at the shared method's seam
 *  with the in-transaction hook: the hook deletes the root row AFTER the cascade has deleted the root's steps and snapshots
 *  (deleting the root up front would not work: V98's `root_id ON DELETE CASCADE` would take the steps first). The cascade's
 *  deletes must then be rolled back, which is the proof the abort is real and not vacuous. */
class PipelineRootRemoveAtomicitySpec extends DraftSaveApiFixture {

  "PipelineRootRepository.removeRoot" should {
    "abort with RootAlreadyRemoved and roll back the cascade when the root row is already gone" in {
      val seed = seedPipeline()
      exec(s"DELETE FROM outputs WHERE id='${seed.od}'")
      exec(s"INSERT INTO node_snapshots (pipeline_id,node_step_id,row_index,data) VALUES ('${seed.pipeline}','${seed.t4}',0,'{}')")
      val rootRepo = new PipelineRootRepository(ctx)
      val stepRepo = new PipelineStepRepository(ctx)
      val before   = storedState(seed)

      val hook = sqlu"DELETE FROM pipeline_roots WHERE id=${seed.r2}"
      val result = Try(await(rootRepo.removeRoot(stepRepo, PipelineId(seed.pipeline), PipelineRootId(seed.r2), afterCascade = hook)))

      result.failed.get shouldBe PipelineRootRepository.RootAlreadyRemoved(PipelineRootId(seed.r2))
      // The cascade deleted t4 and its snapshot before the hook ran; both are back, and nothing else moved.
      queryStrings(s"SELECT id FROM pipeline_steps WHERE id='${seed.t4}'") shouldBe Vector(seed.t4)
      queryStrings(s"SELECT count(*) FROM node_snapshots WHERE pipeline_id='${seed.pipeline}' AND node_step_id='${seed.t4}'") shouldBe Vector("1")
      queryStrings(s"SELECT id FROM pipeline_roots WHERE id='${seed.r2}'") shouldBe Vector(seed.r2)
      storedState(seed) shouldBe before
    }
  }

  "PipelineService.removeRoot" should {
    "answer 404 Root not found (never a 500), as an editor, when a racer removes the root after phase 1, and roll the cascade back" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      exec(s"DELETE FROM outputs WHERE id='${seed.od}'")
      exec(s"INSERT INTO node_snapshots (pipeline_id,node_step_id,row_index,data) VALUES ('${seed.pipeline}','${seed.t4}',0,'{}')")
      // The racer: deletes the root row inside the removal transaction, after the cascade and before the root delete.
      val racing = new PipelineRootRepository(ctx) {
        override def removeRoot(stepRepo: PipelineStepRepository, pipelineId: PipelineId, rootId: PipelineRootId, afterCascade: DBIO[Any]) =
          super.removeRoot(stepRepo, pipelineId, rootId, sqlu"DELETE FROM pipeline_roots WHERE id=${rootId.value}")
      }
      val dataSourceRepo = new DataSourceRepository(ctx)
      val stepRepo       = new PipelineStepRepository(ctx)
      val service = new PipelineService(
        new PipelineRepository(ctx, dataSourceRepo), stepRepo, dataSourceRepo,
        outputRepo = new OutputRepository(ctx), pipelineRootRepo = racing
      )
      val before = storedState(seed)
      val result = await(service.removeRoot(PipelineId(seed.pipeline), PipelineRootId(seed.r2), AuthenticatedUser(UserId(userB))))
      result shouldBe Left(ServiceError.NotFound(s"Root not found: ${seed.r2}"))
      queryStrings(s"SELECT count(*) FROM node_snapshots WHERE pipeline_id='${seed.pipeline}' AND node_step_id='${seed.t4}'") shouldBe Vector("1")
      storedState(seed) shouldBe before
    }
  }
}
