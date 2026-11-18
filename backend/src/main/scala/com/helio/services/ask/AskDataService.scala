package com.helio.services.ask

import com.helio.api.protocols.ask.{AskCitation, AskCitedOutput, AskQuestionResponse}
import com.helio.domain.insights.{Citation, InsightPack, InsightValidator}
import com.helio.domain.model.AuthenticatedUser
import com.helio.infrastructure.ai._
import com.helio.services.ServiceError
import com.helio.services.assistant.AssistantModelPolicy
import org.slf4j.LoggerFactory
import spray.json.JsObject

import scala.concurrent.{ExecutionContext, Future}

/** Why an ask produced no answer. */
sealed trait AskError

object AskError {

  /** `422 ASK_UNGROUNDED`: the answer failed validation twice (or the loop ran out of hops); carries no answer text. */
  final case class Ungrounded(reasons: Vector[String]) extends AskError

  /** The model call failed (`413` guardrail, `502` upstream). */
  final case class Failed(error: ServiceError) extends AskError
}

/** HEL-1745 D3/D7: one ask. Runs `ClaudeClient.sendWithTools` with the four read tools, no web search and no sampling
 *  parameters, validates the answer against every citation issued in the loop, retries once on a rejection, and builds the
 *  response. Never persists the question or the answer and never logs the answer text. Not `AssistantService.converse`,
 *  which always enables web search and offers the propose tools. */
class AskDataService(
    claudeClient: ClaudeClient,
    policy: AssistantModelPolicy,
    access: AskAccess,
    reads: AskReads
)(implicit ec: ExecutionContext) {

  private val log        = LoggerFactory.getLogger(getClass)
  private val pins       = new AskPinBuilder(access.accessChecker)
  private val MaxHops    = 4
  private val MaxAnswerTokens = 1024

  def ask(scope: AskScope, question: String, user: AuthenticatedUser): Future[Either[AskError, AskQuestionResponse]] = {
    val trimmed  = question.trim
    val ledger   = new AskCitationLedger()
    val executor = new AskToolExecutor(user, scope, access, reads, ledger)
    executor.offersHistoryRows.flatMap { offerRows =>
      val tools   = AskTools.definitions(offerRows)
      val first   = request(Seq(ClaudeToolMessage.text(ClaudeRole.User, AskPrompts.question(trimmed))), tools, MaxHops)
      claudeClient.sendWithTools(first, executor).flatMap {
        case ClaudeToolOutcome.Failed(err) => Future.successful(Left(failure(err)))
        case _: ClaudeToolOutcome.HopBudgetExhausted =>
          Future.successful(Left(AskError.Ungrounded(Vector("the tool-call budget was reached before an answer"))))
        case ClaudeToolOutcome.FinalResponse(text, history, _) =>
          validate(text, ledger) match {
            case reasons if reasons.isEmpty => finish(text, ledger, executor, trimmed, user)
            case reasons =>
              log.info(s"Ask answer rejected (${reasons.size} reasons); one corrective turn")
              val retry = request(history :+ ClaudeToolMessage.text(ClaudeRole.User, AskPrompts.correction(reasons)), tools, 1)
              claudeClient.sendWithTools(retry, executor).flatMap {
                case ClaudeToolOutcome.Failed(err) => Future.successful(Left(failure(err)))
                case _: ClaudeToolOutcome.HopBudgetExhausted =>
                  Future.successful(Left(AskError.Ungrounded(reasons)))
                case ClaudeToolOutcome.FinalResponse(second, _, _) =>
                  val again = validate(second, ledger)
                  if (again.isEmpty) finish(second, ledger, executor, trimmed, user) else Future.successful(Left(AskError.Ungrounded(again)))
              }
          }
      }
    }
  }

  private def request(history: Seq[ClaudeToolMessage], tools: Seq[ClaudeTool], maxHops: Int): ClaudeToolRequest =
    ClaudeToolRequest(
      history = history,
      tools = tools,
      maxHops = maxHops,
      maxTokens = Some(MaxAnswerTokens),
      webSearch = false,
      system = Some(AskPrompts.system),
      model = policy.specFor(policy.serverDefault)
    )

  private def validate(text: String, ledger: AskCitationLedger): Vector[String] =
    InsightValidator.validate(text, InsightPack(JsObject.empty, ledger.all, ""), AskPrompts.MaxSentences, AskPrompts.MaxChars)

  private def failure(err: ClaudeError): AskError = err match {
    case ClaudeError.GuardrailExceeded(_) => AskError.Failed(ServiceError.PayloadTooLarge("This question needs more data than one answer can read; ask something narrower"))
    case ClaudeError.NoAnswer(reason, category) => AskError.Failed(ServiceError.BadGateway(ClaudeErrorMessages.noAnswerMessage(reason, category)))
    case _ => AskError.Failed(ServiceError.BadGateway("The model could not answer right now"))
  }

  private def finish(text: String, ledger: AskCitationLedger, executor: AskToolExecutor, question: String, user: AuthenticatedUser): Future[Either[AskError, AskQuestionResponse]] = {
    val pack      = InsightPack(JsObject.empty, ledger.all, "")
    val usedIds   = InsightValidator.citationsUsed(text, pack)
    val byId      = pack.citationById
    val used      = usedIds.flatMap(byId.get)
    val served    = executor.servedOutputs
    val cited     = used.map(_.outputId).distinct.flatMap(served.get)
    pins.build(question, cited, user).map { pin =>
      Right(AskQuestionResponse(text.trim, used.map(citationOf), cited.map(o => AskCitedOutput(o.id.value, o.name)), pin))
    }
  }

  private def citationOf(c: Citation): AskCitation =
    AskCitation(c.id, c.outputId, c.field, c.number, c.date.map(_.toString), c.capturedAt.map(_.toString), c.isPct)
}
