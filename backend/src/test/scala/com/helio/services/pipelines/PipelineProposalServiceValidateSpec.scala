package com.helio.services.pipelines


import com.helio.services.ServiceError
import com.helio.services.pipelines.PipelineProposalService
import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalSource}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.mockito.Mockito.{mock, verifyNoInteractions, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.JsString

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Unit coverage for `PipelineProposalService.validate` (HEL-662 tasks.md 6.1) — the new,
 *  non-mutating entry point required by the Hard Boundary (design.md D3).
 *
 *  Mocked `DataSourceRepository` only (a plain, non-final class — mockable, mirroring
 *  `DashboardProposalServiceValidateSpec`'s precedent). `sourceService`/`dataSourceService`/
 *  `pipelineService`/`pipelineRunService`/`dataTypeService`/`dataTypeRepo` are all passed `null`:
 *  `validate` never calls any of them (by construction — a NullPointerException would fail these
 *  tests loudly if that ever changed), which is itself the evidence that zero pipeline/source/run
 *  rows are ever created by `validate`. */
class PipelineProposalServiceValidateSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now     = Instant.parse("2026-01-01T00:00:00Z")
  private val ownerId = UserId(UUID.randomUUID().toString)
  private val user    = AuthenticatedUser(ownerId)

  private def newService(dataSourceRepo: DataSourceRepository): PipelineProposalService =
    new PipelineProposalService(null, null, null, null, null, dataSourceRepo, null)

  private def existingSource(source: DataSourceId): DataSource =
    StaticSource(source, "Existing", ownerId, now, now)

  private def existingSourceRef(sourceId: String): PipelineProposalSource =
    PipelineProposalSource(Some(sourceId), None, None, None, None, None, None)

  private def inlineStaticSource(name: String = "Inline"): PipelineProposalSource =
    PipelineProposalSource(
      sourceId     = None,
      `type`       = Some(DataSourceKind.Static),
      name         = Some(name),
      csvConfig    = None,
      restConfig   = None,
      sqlConfig    = None,
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("value", "string")), Vector(Vector(JsString("x")))))
    )

  private def proposal(source: PipelineProposalSource, pipelineName: String = "My Pipeline"): PipelineProposal =
    PipelineProposal(pipelineName, source, "My Output", Vector.empty)

  "PipelineProposalService.validate" should {

    "accept a structurally valid proposal referencing an existing, owned source" in {
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val dsRepo   = mock(classOf[DataSourceRepository])
      when(dsRepo.findByIdOwned(sourceId, user)).thenReturn(Future.successful(Some(existingSource(sourceId))))

      val result = await(newService(dsRepo).validate(proposal(existingSourceRef(sourceId.value)), user))

      result shouldBe Right(())
    }

    "reject a blank pipelineName before any repository lookup" in {
      val dsRepo = mock(classOf[DataSourceRepository])

      val result = await(newService(dsRepo).validate(proposal(inlineStaticSource(), pipelineName = "   "), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
      verifyNoInteractions(dsRepo)
    }

    "reject a nonexistent/unowned existing-source reference with NotFound" in {
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val dsRepo   = mock(classOf[DataSourceRepository])
      when(dsRepo.findByIdOwned(sourceId, user)).thenReturn(Future.successful(None))

      val result = await(newService(dsRepo).validate(proposal(existingSourceRef(sourceId.value)), user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.NotFound]
    }

    // design.md D3's accepted asymmetry: an inline source spec gets STRUCTURAL validation only —
    // resolving/creating it is exactly what `apply`'s resolveSource does, which a non-mutating
    // validate must never attempt. Zero DataSourceRepository interaction proves no resolution was
    // attempted.
    "accept a structurally valid inline source without touching the data source repository" in {
      val dsRepo = mock(classOf[DataSourceRepository])

      val result = await(newService(dsRepo).validate(proposal(inlineStaticSource()), user))

      result shouldBe Right(())
      verifyNoInteractions(dsRepo)
    }

    "reject a malformed inline source (missing config) before any repository lookup" in {
      val dsRepo   = mock(classOf[DataSourceRepository])
      val malformed = PipelineProposalSource(None, Some(DataSourceKind.Static), Some("Inline"), None, None, None, None)

      val result = await(newService(dsRepo).validate(proposal(malformed), user))

      result shouldBe a[Left[_, _]]
      verifyNoInteractions(dsRepo)
    }
  }
}
