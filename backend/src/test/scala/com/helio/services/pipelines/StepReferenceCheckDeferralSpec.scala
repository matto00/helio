package com.helio.services.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import com.helio.api.routes.pipelines.StepWriteRoutesFixture
import com.helio.domain.model.{AuthenticatedUser, Pipeline, PipelineId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Future

/** HEL-1515: create's pipeline lookup and editor check are the shared chain's `beforeUpsertF` stage, so they must
 *  not START until ownership and the lane check have passed. Counting `findByIdShared` calls proves the deferral
 *  (statuses alone cannot: results were sequenced either way). */
class StepReferenceCheckDeferralSpec extends AnyWordSpec with Matchers with StepWriteRoutesFixture {

  private val lookups = new AtomicInteger(0)

  override def beforeAll(): Unit = {
    super.beforeAll()
    val ctx = new DbContext(db, db)(routeEc)
    val ds  = new DataSourceRepository(ctx)(routeEc)
    val countingRepo = new PipelineRepository(ctx, ds)(routeEc) {
      override def findByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[Pipeline]] = {
        lookups.incrementAndGet()
        super.findByIdShared(id, callerOpt)
      }
    }
    pipelineService = new PipelineService(
      countingRepo, new PipelineStepRepository(ctx)(routeEc), ds,
      outputRepo = new OutputRepository(ctx)(routeEc), pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc)
    )(routeEc)
  }

  private def sourceJoin(dsId: String): JsValue =
    s"""{"secondaryInput":{"kind":"source","dataSourceId":"$dsId"},"joinKey":"id","joinType":"inner"}""".parseJson

  "create" should {
    "not look the pipeline up when the secondary-source ownership check fails" in {
      val owner = newUser(); val other = newUser(); val pid = emptyPipeline(owner)
      lookups.set(0)
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("join"), "config" -> sourceJoin(newSource(other)))) ~>
        routesFor(owner) ~> check { status shouldBe StatusCodes.NotFound }
      lookups.get shouldBe 0
    }

    "not look the pipeline up when the lane check fails" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      lookups.set(0)
      createJoin(owner, pid, UUID.randomUUID().toString) { status shouldBe StatusCodes.UnprocessableEntity }
      lookups.get shouldBe 0
    }

    "look the pipeline up exactly once when the earlier stages pass" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      lookups.set(0)
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("rename"), "config" -> JsObject("renames" -> JsObject()))) ~>
        routesFor(owner) ~> check { status shouldBe StatusCodes.Created }
      lookups.get shouldBe 1
    }
  }
}
