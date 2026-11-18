package com.helio.services.ask

import com.helio.domain.insights.{Citation, InsightContextBuilder, InsightInputs, InsightLimits, InsightPack}
import com.helio.infrastructure.ai.{ClaudeMessage, ClaudeRole, ClaudeTokenEstimator}

import scala.annotation.tailrec

/** HEL-1745 D5/D6: every citation sent to the model in one ask, with ids unique across the whole loop.
 *
 *  `ClaudeClient.sendWithTools` runs the tool uses of ONE response concurrently, so the ids are assigned inside one
 *  `synchronized` step that reads the next number, builds the (pure, cheap) pack and appends its citations. Trial
 *  packs used to measure and shed a result are built outside that step and never recorded, so the ledger holds only
 *  citations the model was actually shown. The same step enforces the loop-wide data budget, so parallel calls cannot
 *  push a hop past the input guardrail after the ask was charged. */
final class AskCitationLedger(budget: AskCitationLedger.Budget = AskCitationLedger.DefaultBudget) {

  import AskCitationLedger._

  private val lock                         = new Object
  private var recorded: Vector[Citation] = Vector.empty
  private var calls                        = 0
  private var tokens                       = 0

  def all: Vector[Citation] = lock.synchronized(recorded)

  /** Sheds `in` until its pack is within [[PackTokenTarget]] (trial packs, nothing recorded), then records the final one. */
  def shedAndRecord(in: InsightInputs): Either[String, InsightPack] = {
    val first = lock.synchronized(recorded.size + 1)

    @tailrec def loop(current: InsightInputs, keepRows: Int): (InsightInputs, Int) = {
      val trial = InsightContextBuilder.pack(current, keepRows, Limits, first)
      if (estimate(trial) <= PackTokenTarget) (current, keepRows)
      else
        shed(current, keepRows) match {
          case Some((next, keep)) => loop(next, keep)
          case None               => (current, keepRows)
        }
    }

    val (fitted, keep) = loop(in, math.min(Limits.maxHeadRows, in.head.map(_.rows.size).getOrElse(0)))
    packAndRecord(fitted, keep)
  }

  /** The atomic step: counts the call, builds the pack from the next free number and records it, or refuses past the budget. */
  def packAndRecord(in: InsightInputs, keepRows: Int): Either[String, InsightPack] = lock.synchronized {
    if (calls >= budget.maxCalls) Left(BudgetMessage)
    else {
      calls += 1
      val pack = InsightContextBuilder.pack(in, keepRows, Limits, recorded.size + 1)
      val cost = estimate(pack)
      if (tokens + cost > budget.maxTokens) Left(BudgetMessage)
      else {
        tokens += cost
        recorded = recorded ++ pack.citations
        Right(pack)
      }
    }
  }
}

object AskCitationLedger {

  /** At most `maxCalls` data tool calls and `maxTokens` estimated tokens of tool results in one ask. */
  final case class Budget(maxCalls: Int, maxTokens: Int)

  val DefaultBudget: Budget = Budget(maxCalls = 6, maxTokens = 12000)

  /** One tool result is shed down to about this many estimated tokens. */
  val PackTokenTarget: Int = 4000

  val BudgetMessage: String = "data budget reached; answer from what you have"

  val Limits: InsightLimits = InsightLimits(maxHeadRows = 50)

  private def estimate(pack: InsightPack): Int = ClaudeTokenEstimator.estimate(Seq(ClaudeMessage(ClaudeRole.User, pack.serialized)))

  /** Halve the head rows to none, then drop the oldest ~12% of window points, then whole windows, then compares. */
  private def shed(in: InsightInputs, keepRows: Int): Option[(InsightInputs, Int)] =
    if (keepRows > 0) Some((in, keepRows / 2))
    else if (in.windows.exists(_.points.nonEmpty)) Some((dropOldestPoints(in), keepRows))
    else if (in.windows.nonEmpty) Some((in.copy(windows = Vector.empty), keepRows))
    else if (in.compares.nonEmpty) Some((in.copy(compares = in.compares.init), keepRows))
    else None

  private def dropOldestPoints(in: InsightInputs): InsightInputs = {
    val all     = in.windows.flatMap(_.points.map(_._1)).sorted
    val cutoff  = all(math.max(1, all.size / 8) - 1)
    val windows = in.windows.map(w => w.copy(points = w.points.filter(_._1.isAfter(cutoff)))).filter(_.points.nonEmpty)
    in.copy(windows = windows)
  }
}
