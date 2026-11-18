package com.helio.services.ask

import com.helio.infrastructure.ai.{ClaudeMessage, ClaudeTokenEstimator}
import com.helio.domain.insights.{InsightCompare, InsightHead, InsightInputs, InsightWindow}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.concurrent.{CountDownLatch, Executors}
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1745 tasks 4.1c (ledger lock) and 4.11 (data budget; trial packs never enter the ledger). */
class AskCitationLedgerSpec extends AnyWordSpec with Matchers {

  private val t0 = Instant.parse("2026-11-01T00:00:00Z")

  private def window(outputId: String, n: Int): InsightInputs =
    InsightInputs(None, Vector.empty, Vector(InsightWindow(outputId, "recent", (0 until n).map(i => t0.plusSeconds(86400L * i) -> (100.0 + i)).toVector)))

  private def bigHead(outputId: String, rows: Int): InsightInputs =
    InsightInputs(
      Some(InsightHead(outputId, t0, Vector("a", "b", "c", "d", "e", "f"), (0 until rows).map(i => JsObject((Seq("a", "b", "c", "d", "e", "f")).map(k => k -> JsNumber(i * 1000 + k.head.toInt)).toMap)).toVector)),
      Vector.empty,
      Vector.empty
    )

  "packAndRecord under contention (4.1c)" should {
    "hand out disjoint, contiguous ids" in {
      val ledger  = new AskCitationLedger(AskCitationLedger.Budget(Int.MaxValue, Int.MaxValue))
      val threads = 8
      val pool    = Executors.newFixedThreadPool(threads)
      implicit val ec: ExecutionContext = ExecutionContext.fromExecutor(pool)
      try {
        val start = new CountDownLatch(1)
        val work = (0 until threads).map { t =>
          Future {
            start.await()
            (0 until 400).foreach(_ => ledger.packAndRecord(window(s"o$t", 3), 0))
          }
        }
        start.countDown()
        Await.result(Future.sequence(work), 60.seconds)
        val ids = ledger.all.map(_.id)
        ids.distinct.size shouldBe ids.size
        ids shouldBe (1 to ids.size).map(i => s"c$i")
      } finally pool.shutdown()
    }
  }

  "the shed step (4.11)" should {
    "record only the final pack's citations, never a trial pack" in {
      val ledger = new AskCitationLedger()
      val pack   = ledger.shedAndRecord(bigHead("o1", 50)).toOption.get
      ledger.all shouldBe pack.citations
      ledger.all.map(_.id) shouldBe (1 to ledger.all.size).map(i => s"c$i")
      ClaudeTokenEstimator.estimate(Seq(ClaudeMessage("user", pack.serialized))) should be <= 4200
    }

    "continue numbering after an earlier pack" in {
      val ledger = new AskCitationLedger()
      val first  = ledger.shedAndRecord(window("o1", 5)).toOption.get
      val second = ledger.shedAndRecord(window("o2", 5)).toOption.get
      second.citations.head.id shouldBe s"c${first.citations.size + 1}"
    }
  }

  "the data budget (4.11)" should {
    "refuse the 7th data call with the budget message" in {
      val ledger = new AskCitationLedger()
      val results = (1 to 7).map(_ => ledger.shedAndRecord(window("o1", 2)))
      results.take(6).foreach(_.isRight shouldBe true)
      results(6) shouldBe Left(AskCitationLedger.BudgetMessage)
    }

    "refuse a call that would pass 12k estimated tokens, recording nothing for it" in {
      val ledger  = new AskCitationLedger()
      val results = (1 to 6).map(_ => ledger.shedAndRecord(bigHead("o1", 50)))
      val ok      = results.count(_.isRight)
      ok should be < 6
      results.exists(_ == Left(AskCitationLedger.BudgetMessage)) shouldBe true
      ledger.all.size shouldBe results.collect { case Right(p) => p.citations.size }.sum
    }

    "count compares like any other data" in {
      val c = InsightCompare("o1", "Rev", "revenue", "7d", Some(1.0), Some(2.0), Some(-1.0), Some(-50.0), Some(t0), Some(t0))
      new AskCitationLedger().shedAndRecord(InsightInputs(None, Vector(c), Vector.empty)).isRight shouldBe true
    }
  }
}
