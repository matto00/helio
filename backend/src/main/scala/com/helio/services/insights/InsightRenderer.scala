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
 *  answer is retried once. No production caller wires this yet and it applies no quota gate; the leaf that wires it
 *  must wrap the client with the owner-keyed gate. Cost is recorded from usage, never enforced. */
final class InsightRenderer(
    client: InsightModelClient,
    limits: InsightLimits = InsightLimits(),
    priceTable: InsightPriceTable = InsightPriceTable.Default,
    estimator: Seq[String] => Int = InsightRenderer.claudeEstimator
)(implicit ec: ExecutionContext) {

  import InsightRenderOutcome._

  /** `Auto` is not inferred here (the caller has the node signals); it renders as `Summary`. */
  def render(inputs: InsightInputs, preset: InsightPreset, spec: InsightRenderSpec, lastGood: Option[InsightRender]): Future[InsightRenderOutcome] = {
    val effective = if (preset == InsightPreset.Auto) InsightPreset.Summary else preset
    InsightContextBuilder.build(inputs, effective, spec, limits, estimator) match {
      case Left(estimate) => Future.successful(PackTooLarge(estimate, lastGood))
      case Right(built)   => attempt(built, effective, spec, lastGood, retryNote = None, priorUsage = InsightUsage.Zero, priorCost = Some(0L))
    }
  }

  private def attempt(
      built: InsightBuiltPrompt,
      preset: InsightPreset,
      spec: InsightRenderSpec,
      lastGood: Option[InsightRender],
      retryNote: Option[String],
      priorUsage: InsightUsage,
      priorCost: Option[Long]
  ): Future[InsightRenderOutcome] = {
    val user = retryNote.map(n => withinBudget(built, preset, spec, n)).getOrElse(built.user)
    client.render(InsightModelRequest(built.system, user, limits.maxOutputTokens)).flatMap {
      case Left(failure) => Future.successful(Failed(failure, priorUsage, priorCost, lastGood))
      case Right(response) =>
        val usage   = priorUsage + response.usage
        val cost    = for (a <- priorCost; b <- priceTable.costMicros(response.model, response.usage)) yield a + b
        val reasons = InsightValidator.validate(response.text, built.pack, spec.maxSentences, spec.maxChars)
        if (reasons.isEmpty) {
          val text = response.text.trim
          Future.successful(Accepted(InsightRender(text, InsightValidator.citationsUsed(text, built.pack), preset, response.model), usage, cost))
        } else if (retryNote.isEmpty)
          attempt(built, preset, spec, lastGood, Some(noteFor(reasons)), usage, cost)
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
