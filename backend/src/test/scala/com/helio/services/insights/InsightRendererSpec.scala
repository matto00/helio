package com.helio.services.insights

import com.helio.domain.insights.InsightFixtures._
import com.helio.domain.insights._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1741 tasks 2.3, 3.1 (renderer level), 3.3 (zero calls), 3.5: the renderer over a fake client. */
class InsightRendererSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val usage = InsightUsage(100, 20)

  private final class FakeClient(script: Vector[Either[InsightModelFailure, String]], model: String = "claude-opus-4-8") extends InsightModelClient {
    private val count    = new AtomicInteger(0)
    private val received = new ConcurrentLinkedQueue[InsightModelRequest]()
    def calls: Int                       = count.get()
    def requests: Vector[InsightModelRequest] = received.asScala.toVector
    override def render(request: InsightModelRequest): Future[Either[InsightModelFailure, InsightModelResponse]] = {
      received.add(request)
      Future.successful(script(math.min(count.getAndIncrement(), script.size - 1)).map(InsightModelResponse(_, usage, model)))
    }
  }

  private val cur = idOf(pack(), "revenue.current")
  private val good = s"Revenue is 1,234 [$cur]."
  private val bad  = s"Revenue is 999 [$cur]."
  private val previous = InsightRender("Earlier text.", Vector.empty, InsightPreset.Summary, "claude-opus-4-8")

  private def render(client: InsightModelClient, in: InsightInputs = inputs, lastGood: Option[InsightRender] = None, spec: InsightRenderSpec = InsightFixtures.spec) =
    Await.result(new InsightRenderer(client).render(in, InsightPreset.Summary, spec, lastGood), 10.seconds)

  "a fabricated number" should {
    "be rejected by the renderer, after one retry, and nothing is accepted" in {
      val client = new FakeClient(Vector(Right(bad)))
      render(client) match {
        case InsightRenderOutcome.Rejected(reasons, _, _, _) => reasons.head should include("'999'")
        case other                                           => fail(s"expected Rejected, got $other")
      }
    }
  }

  "a grounded answer" should {
    "be accepted with its citations, usage and cost" in {
      val client = new FakeClient(Vector(Right(good)))
      render(client) match {
        case InsightRenderOutcome.Accepted(r, u, cost) =>
          r.text shouldBe good
          r.citationsUsed shouldBe Vector(cur)
          r.model shouldBe "claude-opus-4-8"
          u shouldBe usage
          cost shouldBe InsightPriceTable.Default.costMicros("claude-opus-4-8", usage)
        case other => fail(s"expected Accepted, got $other")
      }
      client.calls shouldBe 1
      client.requests.head.maxOutputTokens shouldBe 4096
      client.requests.head.system should not be empty
    }
    "be accepted on the retry after one rejection, with usage and cost summed" in {
      val client = new FakeClient(Vector(Right(bad), Right(good)))
      render(client) match {
        case InsightRenderOutcome.Accepted(_, u, cost) =>
          u shouldBe (usage + usage)
          cost shouldBe InsightPriceTable.Default.costMicros("claude-opus-4-8", usage).map(_ * 2)
        case other => fail(s"expected Accepted, got $other")
      }
      client.calls shouldBe 2
      client.requests(1).user should include("rejected")
      client.requests(1).user should include("'999'")
    }
    "record no cost for an unknown model but still accept" in {
      render(new FakeClient(Vector(Right(good)), model = "claude-unknown")) match {
        case InsightRenderOutcome.Accepted(_, _, cost) => cost shouldBe None
        case other                                     => fail(s"expected Accepted, got $other")
      }
    }
  }

  "two rejections" should {
    "keep the last good render, call the client exactly twice and store nothing new" in {
      val client = new FakeClient(Vector(Right(bad), Right(s"Revenue is 555 [$cur].")))
      val out    = render(client, lastGood = Some(previous))
      client.calls shouldBe 2
      out match {
        case InsightRenderOutcome.Rejected(reasons, u, _, lastGood) =>
          lastGood shouldBe Some(previous)
          reasons.head should include("'555'")
          u shouldBe (usage + usage)
        case other => fail(s"expected Rejected, got $other")
      }
    }
  }

  "a model failure" should {
    "keep the last good render and not retry" in {
      val client = new FakeClient(Vector(Left(InsightModelFailure.Transport("down"))))
      render(client, lastGood = Some(previous)) shouldBe InsightRenderOutcome.Failed(InsightModelFailure.Transport("down"), InsightUsage.Zero, Some(0L), Some(previous))
      client.calls shouldBe 1
    }
    "report the Unavailable default" in {
      Await.result(new InsightRenderer(InsightModelClient.Unavailable).render(inputs, InsightPreset.Summary, InsightFixtures.spec, None), 5.seconds) shouldBe a[InsightRenderOutcome.Failed]
    }
  }

  "an irreducible pack" should {
    "make zero client calls and keep the last good render" in {
      val huge   = InsightFixtures.spec.copy(customPrompt = Some((1 to 12000).map(i => s"word$i").mkString(" ")))
      val client = new FakeClient(Vector(Right(good)))
      render(client, spec = huge, lastGood = Some(previous)) match {
        case InsightRenderOutcome.PackTooLarge(estimate, lastGood) =>
          estimate should be > 8000
          lastGood shouldBe Some(previous)
        case other => fail(s"expected PackTooLarge, got $other")
      }
      client.calls shouldBe 0
    }
  }
}
