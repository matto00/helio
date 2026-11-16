package com.helio.eval

import spray.json._

import java.nio.file.{Files, Path}
import scala.jdk.CollectionConverters._
import scala.util.Try

/** What the transcript of one converse turn says (design.md D8). Counts come from the persisted transcript's
 *  `tool_use` / `tool_result.isError` blocks, never from a new counter. A zero-result `find` is NOT a failure; it is
 *  counted separately. */
final case class TranscriptStats(
    toolCalls: Int,
    failedCalls: Int,
    zeroResultFinds: Int,
    proposeCalls: Int,
    successfulProposes: Int,
    hops: Int,
    byTool: Map[String, Int],
    finalProposal: Option[ProposalCall],
    finalText: String
)

/** The last SUCCESSFUL propose call -- the one `AssistantToolExecutor.capturedProposal` holds when the turn ends. */
final case class ProposalCall(toolName: String, input: JsValue, resultContent: String)

object EvalTranscript {

  private val ProposeTools = Set("propose_dashboard", "propose_pipeline", "propose_combined", "propose_patch_set")

  /** `transcript` is the converse response's whole persisted transcript; only turns after the seeded user message
   *  matter, and a fresh conversation has only this turn's messages. */
  def stats(transcript: JsValue): TranscriptStats = {
    val turns = transcript match {
      case JsArray(xs) => xs
      case _           => Vector.empty
    }
    val blocks = turns.flatMap { turn =>
      val role = EvalJson.str(turn, "role").getOrElse("")
      EvalJson.arr(turn, "content").map(block => (role, block))
    }
    val uses    = blocks.collect { case (_, b) if EvalJson.str(b, "blockType").contains("tool_use") => b }
    val results = blocks.collect { case (_, b) if EvalJson.str(b, "blockType").contains("tool_result") => b }.flatMap { b =>
      EvalJson.str(b, "toolUseId").map(_ -> b)
    }.toMap
    def isError(useId: String): Boolean =
      results.get(useId).exists(r => EvalJson.at(r, "isError").contains(JsBoolean(true)))
    def content(useId: String): String = results.get(useId).flatMap(EvalJson.str(_, "content")).getOrElse("")

    val calls = uses.flatMap(u => EvalJson.str(u, "id").zip(EvalJson.str(u, "name")).map { case (id, name) => (id, name, u) })
    val successfulProposeCalls = calls.filter { case (id, name, _) => ProposeTools(name) && results.contains(id) && !isError(id) }
    val assistantTurns = turns.count(t => EvalJson.str(t, "role").exists(_.equalsIgnoreCase("assistant")))
    val lastText = turns.reverse
      .find(t => EvalJson.str(t, "role").exists(_.equalsIgnoreCase("assistant")))
      .map(t => EvalJson.arr(t, "content").flatMap(b => if (EvalJson.str(b, "blockType").contains("text")) EvalJson.str(b, "text") else None).mkString("\n"))
      .getOrElse("")

    TranscriptStats(
      toolCalls = calls.size,
      failedCalls = calls.count { case (id, _, _) => isError(id) },
      zeroResultFinds = calls.count { case (id, name, _) => name == "find" && !isError(id) && content(id).trim == "[]" },
      proposeCalls = calls.count { case (_, name, _) => ProposeTools(name) },
      successfulProposes = successfulProposeCalls.size,
      hops = assistantTurns,
      byTool = calls.groupBy(_._2).map { case (k, v) => k -> v.size },
      finalProposal = successfulProposeCalls.lastOption.map { case (id, name, use) =>
        ProposalCall(name, EvalJson.at(use, "input").getOrElse(JsNull), content(id))
      },
      finalText = lastText
    )
  }
}

/** One `assistant_tool_loop_outcome` telemetry line (design.md D8), read from the backend's JSON log. */
final case class Telemetry(
    conversationId: String,
    modelId: String,
    inputTokens: Long,
    outputTokens: Long,
    cacheReadTokens: Long,
    cacheCreationTokens: Long
) {
  /** Haiku 4.5 list prices per million tokens: $1 input, $5 output, $0.10 cache read, $1.25 cache write. */
  def costUsd: Double =
    (inputTokens * 1.0 + outputTokens * 5.0 + cacheReadTokens * 0.10 + cacheCreationTokens * 1.25) / 1000000.0
  def totalTokens: Long = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
}

object EvalTelemetry {

  /** Finds the outcome line of `conversationId`. sbt may relay the child's stdout with an `[info] ` prefix, so the JSON is parsed from the
   *  first `{` of any line that mentions `assistant_tool_loop_outcome` (skeptic-design-5 note 1). The line is written
   *  asynchronously after the response, so the caller polls. */
  def find(log: Path, conversationId: String): Option[Telemetry] =
    if (!Files.exists(log)) None
    else {
      val lines = Try(Files.readAllLines(log).asScala.toVector).getOrElse(Vector.empty)
      lines.iterator
        .filter(l => l.contains("assistant_tool_loop_outcome") && l.contains(conversationId))
        .flatMap(l => parseLine(l))
        .find(_.conversationId == conversationId)
    }

  def parseLine(line: String): Option[Telemetry] = {
    val start = line.indexOf('{')
    if (start < 0) None
    else
      Try(line.substring(start).parseJson).toOption.flatMap {
        case obj: JsObject =>
          def long(k: String): Long = obj.fields.get(k) match {
            case Some(JsNumber(n)) => n.toLong
            case Some(JsString(s)) => s.toLongOption.getOrElse(0L)
            case _                 => 0L
          }
          for {
            cid   <- EvalJson.str(obj, "conversationId")
            model <- EvalJson.str(obj, "modelId")
          } yield Telemetry(cid, model, long("inputTokens"), long("outputTokens"), long("cacheReadInputTokens"), long("cacheCreationInputTokens"))
        case _ => None
      }
    }

  def poll(log: Path, conversationId: String, attempts: Int = 40, sleepMillis: Long = 500): Option[Telemetry] = {
    var i = 0
    var found = find(log, conversationId)
    while (found.isEmpty && i < attempts) {
      Thread.sleep(sleepMillis)
      found = find(log, conversationId)
      i += 1
    }
    found
  }
}
