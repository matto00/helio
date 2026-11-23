package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, PipelineProposal, PipelineProposalSource, ProposalRestApiConfig}
import com.helio.api.protocols.sources.CreateSourceRequest
import com.helio.domain.model._
import com.helio.services.ServiceError
import com.helio.services.ratelimit.{InMemoryRateLimiter, SourceFetchBudget}
import com.helio.services.sources.SourceService
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, never, times, verify, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1727: hardening of the propose-time dry run's live schema fetch. (1) A failed fetch's remote error text is capped
 *  (500 code points + marker) before it reaches the rejection message (and so the assistant's `is_error` tool result), for
 *  every shape of text (short, astral, a surrogate pair straddling the cut). (2) The request-only preflight (step checks)
 *  runs BEFORE the charged fetch, so a retry after a step error neither fetches nor spends a source-fetch unit. */
class ProposalDryRunFetchHardeningSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T     = Await.result(f, 10.seconds)

  private val user = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  private val Marker = " … [truncated]"

  private def failingFetch(error: String): SourceService = {
    val ss = mock(classOf[SourceService])
    // Like the real `dryRunRestSchema`: `beforeFetch` (the source-fetch budget charge) runs first, and a refusal skips the fetch.
    when(ss.dryRunRestSchema(any[CreateSourceRequest](), any[AuthenticatedUser](), any[() => Either[ServiceError, Unit]]()))
      .thenAnswer { inv =>
        val beforeFetch = inv.getArgument[() => Either[ServiceError, Unit]](2)
        Future.successful(beforeFetch().map(_ => SourceService.InlineDryRunSchema(Vector.empty, Some(error))))
      }
    ss
  }

  private def service(ss: SourceService, budget: SourceFetchBudget = SourceFetchBudget.default()) =
    new PipelineProposalService(ss, null, null, null, null, null, budget)

  private val rest = PipelineProposalSource(None, Some(DataSourceKind.RestApi), Some("Inline"), None, Some(ProposalRestApiConfig(url = Some("https://api.example.com/rows"))), None, None, None)

  private val chart = CreatePipelineTransactionalOutputRequest(
    None, "chart", "Out", Some("""{"chartType":"bar","fieldMapping":{"xAxis":"x","yAxis":"y"}}""".parseJson.asJsObject), None
  )

  /** The rejection message a failed fetch with `error` produces (Output with a fieldMapping on the failed root). */
  private def rejection(error: String): String = {
    val result = await(service(failingFetch(error)).validate(PipelineProposal("P", Vector(rest), Vector.empty, Vector(chart)), user))
    result.swap.toOption.getOrElse(fail("accepted")).message
  }

  private def quoted(message: String): String = {
    val open  = "could not read the source schema ("
    val start = message.indexOf(open)
    withClue(message) { start should be >= 0 }
    val end = message.lastIndexOf("), so fieldMapping cannot be checked")
    message.substring(start + open.length, end)
  }

  "the fetch-failure text in a propose rejection" should {

    "truncate an oversized (100,000-char) remote body to 500 code points plus a marker" in {
      val q = quoted(rejection("HTTP 500: " + ("x" * 100000)))
      q shouldBe ("HTTP 500: " + ("x" * 490)) + Marker
    }

    "leave text of exactly 500 code points unchanged" in {
      val text = "e" * 500
      quoted(rejection(text)) shouldBe text
    }

    "leave short text unchanged" in {
      quoted(rejection("HTTP 404: not found")) shouldBe "HTTP 404: not found"
    }

    "leave 400 emoji (400 code points, 800 UTF-16 units) unchanged, without throwing" in {
      val text = "😀" * 400
      text.length shouldBe 800
      quoted(rejection(text)) shouldBe text
    }

    "cut by code point, never splitting a surrogate pair at the boundary" in {
      val text = ("a" * 499) + ("😀" * 10)
      val q    = quoted(rejection(text))
      q shouldBe ("a" * 499) + "😀" + Marker
      q.codePointCount(0, q.length) shouldBe 500 + Marker.length
      q.exists(Character.isSurrogate) shouldBe true
      q.zipWithIndex.foreach { case (c, i) =>
        if (Character.isHighSurrogate(c)) Character.isLowSurrogate(q.charAt(i + 1)) shouldBe true
      }
    }
  }

  "the propose dry run's check order" should {

    "reject a preflight-failing step before any fetch, without charging the source-fetch budget" in {
      val ss      = failingFetch("HTTP 500: nope")
      val limiter = new InMemoryRateLimiter()
      val budget  = new SourceFetchBudget(limiter, 1, 60)
      // A union whose lane reference names no step of the proposal passes the structural check but is rejected by the
      // request-only preflight (lane pass), which must therefore run before the charged fetch.
      val step    = CreatePipelineTransactionalStepRequest("s1", "union", """{"secondaryInput":{"kind":"lane","stepId":"ghost"}}""".parseJson.asJsObject)
      val result  = await(service(ss, budget).validate(PipelineProposal("P", Vector(rest), Vector(step), Vector.empty), user))

      val err = result.swap.toOption.getOrElse(fail("accepted"))
      err.message should include("Lane reference 'ghost' does not exist in this request")
      verify(ss, never()).dryRunRestSchema(any[CreateSourceRequest](), any[AuthenticatedUser](), any[() => Either[ServiceError, Unit]]())
      // the single unit of budget is still available: nothing was charged
      budget.charge(user) shouldBe Right(())
    }

    "still dry-run the root (one fetch) when preflight passes" in {
      val ss = failingFetch("HTTP 500: nope")
      val result = await(service(ss).validate(PipelineProposal("P", Vector(rest), Vector.empty, Vector.empty), user))
      result shouldBe Right(())
      verify(ss, times(1)).dryRunRestSchema(any[CreateSourceRequest](), any[AuthenticatedUser](), any[() => Either[ServiceError, Unit]]())
    }
  }
}
