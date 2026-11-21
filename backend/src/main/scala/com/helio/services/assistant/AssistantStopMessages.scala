package com.helio.services.assistant

import com.helio.infrastructure.ai.{ClaudeContentBlock, FailedToolCall, ToolFailureBudget}
import spray.json._

import scala.util.Try

/** HEL-1637 D2/D5: how the workspace assistant's tool loop classifies a failed call and what it tells the user when a
 *  budget ends the turn. The text is composed here, never by the web client, and only ever from the `FailedToolCall`
 *  messages `classify` produced (the same text the tool-call row already shows), never from raw tool-result JSON. */
private[assistant] object AssistantStopMessages {

  /** Failed tool calls a turn may spend before it stops. */
  val FailureBudget: Int = 3

  /** Hard cap on round trips that may execute tools: a cost and latency backstop (owner ruling, HEL-1637). */
  val HopCeiling: Int = 12

  private val SourceDidNotRespond = "the source did not respond"
  private val MaxErrorChars       = 200

  val failureBudget: ToolFailureBudget = ToolFailureBudget(FailureBudget, classify)

  /** `Some(plain message)` for a dispatched call that failed: an `isError` result, or a `test_connection` result
   *  whose JSON says `"ok": false` (an unreachable source is a successful tool call carrying a failed test). */
  def classify(toolUse: ClaudeContentBlock.ToolUse, result: ClaudeContentBlock.ToolResult): Option[String] =
    if (result.isError) Some(result.content)
    else if (toolUse.name == "test_connection") testConnectionFailure(result.content)
    else None

  private def testConnectionFailure(content: String): Option[String] =
    Try(content.parseJson).toOption.collect { case o: JsObject => o }.flatMap { o =>
      o.fields.get("ok") match {
        case Some(JsBoolean(false)) =>
          Some(o.fields.get("error").collect { case JsString(e) if e.trim.nonEmpty => e }.getOrElse(SourceDidNotRespond))
        case _ => None
      }
    }

  def failureBudgetMessage(failed: Seq[FailedToolCall], proposalCaptured: Boolean): String = {
    val n     = failed.size
    val names = failed.map(_.name).toSet
    val what =
      if (proposalCaptured) s"I put together a proposal, but then $n tool calls failed."
      else if (names == Set("test_connection")) s"I couldn't connect to the source after $n tries."
      else if (names.forall(_.startsWith("propose_"))) s"I couldn't put together a valid proposal after $n tries."
      else if (names.subsetOf(Set("find", "get_resource"))) s"I couldn't read what I needed from your workspace after $n tries."
      else s"I stopped after $n tool calls failed."
    val last = failed.lastOption.map(_.message.linesIterator.nextOption().getOrElse("").trim.take(MaxErrorChars)).filter(_.nonEmpty)
    val lastError = last.map(e => s" The last error was: ${e.stripSuffix(".")}.").getOrElse("")
    s"$what$lastError Tell me what to change, or ask me to try again."
  }

  val InputBudgetMessage: String =
    "This conversation got too long for me to keep working on it in one go. Start a new conversation, or ask about one thing at a time."

  val HopCeilingMessage: String =
    s"I stopped after $HopCeiling steps without finishing. Tell me which part to focus on, or ask me to continue."
}
