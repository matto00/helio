package com.helio.services.insights

import com.helio.domain.insights._
import com.helio.infrastructure.ai.{ClaudeMessage, ClaudeRole, ClaudeTokenEstimator}

import scala.concurrent.{ExecutionContext, Future}

/** A render the validator accepted. `citationsUsed` are the pack citation ids the text marks. */
final case class InsightRender(text: String, citationsUsed: Vector[String], preset: InsightPreset, model: String)

/** HEL-1741 D8/D9. `Rejected`, `Failed` and `PackTooLarge` carry no new text: nothing a caller could store, and
 *  `lastGood` is the caller's previous render, returned unchanged. */
sealed trait InsightRenderOutcome

object InsightRenderOutcome {
  final case class Accepted(render: InsightRender, usage: InsightUsage, costMicros: Option[Long]) extends InsightRenderOutcome
  final case class Rejected(reasons: Vector[String], usage: InsightUsage, costMicros: Option[Long], lastGood: Option[InsightRender]) extends InsightRenderOutcome
  final case class Failed(failure: InsightModelFailure, usage: InsightUsage, costMicros: Option[Long], lastGood: Option[InsightRender]) extends InsightRenderOutcome
  final case class PackTooLarge(estimate: Int, lastGood: Option[InsightRender]) extends InsightRenderOutcome
}

/** Builds the grounding pack, calls the model through [[InsightModelClient]] and validates the answer. A rejected
 *  answer is retried once. It applies no quota gate: `InsightRenderService` charges the owner-keyed gate between
 *  [[prepare]] and [[send]]. Cost is recorded from usage, never enforced. */
final class InsightRenderer(
    client: InsightModelClient,
    limits: InsightLimits = InsightLimits(),
    priceTable: InsightPriceTable = InsightPriceTable.Default,
    estimator: Seq[String] => Int = InsightRenderer.claudeEstimator
)(implicit ec: ExecutionContext) {

  import InsightRenderOutcome._

  /** `Auto` is not inferred here (the caller has the node signals); it renders as `Summary`. */
  def render(
      inputs: InsightInputs, preset: InsightPreset, spec: InsightRenderSpec, lastGood: Option[InsightRender],
      model: Option[String] = None
  ): Future[InsightRenderOutcome] =
    prepare(inputs, preset, spec) match {
      case Left(estimate) => Future.successful(PackTooLarge(estimate, lastGood))
      case Right(built)   => send(built, effective(preset), spec, lastGood, model)
    }

  private def effective(preset: InsightPreset): InsightPreset = if (preset == InsightPreset.Auto) InsightPreset.Summary else preset

  /** HEL-1743 D2: the pack and prompt WITHOUT calling the model, so the render service can run its guards (digest, throttle,
   *  quota) between building and sending. `Left(estimate)` is the pack-too-large case. */
  def prepare(inputs: InsightInputs, preset: InsightPreset, spec: InsightRenderSpec): Either[Int, InsightBuiltPrompt] =
    InsightContextBuilder.build(inputs, effective(preset), spec, limits, estimator)

  /** Sends a prompt [[prepare]] built, validates, and retries once on a rejection. `model` is the resolved catalog id for
   *  the whole attempt (retry included), or `None` for the server default. */
  def send(
      built: InsightBuiltPrompt, preset: InsightPreset, spec: InsightRenderSpec, lastGood: Option[InsightRender],
      model: Option[String] = None
  ): Future[InsightRenderOutcome] =
    attempt(built, effective(preset), spec, lastGood, retryNote = None, priorUsage = InsightUsage.Zero, priorCost = Some(0L), model)

  private def attempt(
      built: InsightBuiltPrompt,
      preset: InsightPreset,
      spec: InsightRenderSpec,
      lastGood: Option[InsightRender],
      retryNote: Option[String],
      priorUsage: InsightUsage,
      priorCost: Option[Long],
      model: Option[String]
  ): Future[InsightRenderOutcome] = {
    val user = retryNote.map(n => withinBudget(built, preset, spec, n)).getOrElse(built.user)
    client.render(InsightModelRequest(built.system, user, limits.maxOutputTokens, model)).flatMap {
      case Left(failure) =>
        // A failure that reached the model still spent tokens: carry them so the row records usage and cost.
        val spent = failure match {
          case InsightModelFailure.NoAnswer(_, u, m) if u != InsightUsage.Zero =>
            val cost = for (a <- priorCost; model <- m; b <- priceTable.costMicros(model, u)) yield a + b
            Some((priorUsage + u, cost))
          case _ => None
        }
        Future.successful(Failed(failure, spent.map(_._1).getOrElse(priorUsage), spent.fold(priorCost)(_._2), lastGood))
      case Right(response) =>
        val usage   = priorUsage + response.usage
        val cost    = for (a <- priorCost; b <- priceTable.costMicros(response.model, response.usage)) yield a + b
        val reasons = InsightValidator.validate(response.text, built.pack, spec.maxSentences, spec.maxChars)
        if (reasons.isEmpty) {
          val text = response.text.trim
          Future.successful(Accepted(InsightRender(text, InsightValidator.citationsUsed(text, built.pack), preset, response.model), usage, cost))
        } else if (retryNote.isEmpty)
          attempt(built, preset, spec, lastGood, Some(noteFor(reasons)), usage, cost, model)
        else Future.successful(Rejected(reasons, usage, cost, lastGood))
    }
  }

  private def noteFor(reasons: Vector[String]): String =
    "Your previous answer was rejected: " + reasons.mkString("; ") + ". Write it again using only cited values."

  /** The retry user message with the note; without the note if adding it would exceed the input budget. */
  private def withinBudget(built: InsightBuiltPrompt, preset: InsightPreset, spec: InsightRenderSpec, note: String): String = {
    val withNote = InsightPrompts.user(preset, spec, built.pack.serialized, Some(note))
    if (estimator(Seq(built.system, withNote)) <= limits.maxInputTokens) withNote else built.user
  }
}

object InsightRenderer {

  val claudeEstimator: Seq[String] => Int =
    texts => ClaudeTokenEstimator.estimate(texts.map(t => ClaudeMessage(ClaudeRole.User, t)))
}
