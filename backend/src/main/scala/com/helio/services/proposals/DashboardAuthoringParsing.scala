package com.helio.services.proposals

import com.helio.api.protocols.proposals.{DashboardProposal, DashboardProposalProtocol}
import spray.json._

import scala.util.{Failure, Success, Try}

/** Defensive JSON extraction + parsing of a Claude text response into a `DashboardProposal`
 *  (HEL-392 design.md D4) — HEL-390 models Claude output as free text, not native tool-use, so the
 *  model's response may (despite the prompt's instruction) carry leading/trailing prose around the
 *  JSON object. A first-`{`-to-matching-`}` scan (brace-depth + string-aware, so a literal `{`/`}`
 *  inside a quoted string never miscounts) extracts the object text before handing it to the
 *  existing spray-json `DashboardProposalProtocol` formatter — no bespoke parser, no new
 *  dependency. */
object DashboardAuthoringParsing extends DashboardProposalProtocol {

  /** `Left` carries a human-readable message suitable both as a rejection reason and as the error
   *  text fed back in the design.md D5 repair prompt — never a raw exception `toString`/stack
   *  trace. */
  def parseProposal(text: String): Either[String, DashboardProposal] =
    extractJsonObject(text) match {
      case None => Left("Model response did not contain a JSON object")
      case Some(jsonText) =>
        Try(jsonText.parseJson.convertTo[DashboardProposal]) match {
          case Success(proposal) => Right(proposal)
          case Failure(ex)       => Left(s"Failed to parse model response as a dashboard proposal: ${describe(ex)}")
        }
    }

  private def describe(ex: Throwable): String = Option(ex.getMessage).getOrElse(ex.getClass.getName)

  /** First `{` to its depth-matching `}`, ignoring brace characters inside a (possibly-escaped)
   *  JSON string literal. `None` when no `{` is found, or no matching close is ever reached (an
   *  unterminated/truncated response). `private[services]` so it can be unit-tested directly. */
  private[services] def extractJsonObject(text: String): Option[String] = {
    val start = text.indexOf('{')
    if (start < 0) None
    else {
      var depth    = 0
      var inString = false
      var escaped  = false
      var end      = -1
      var i        = start
      while (i < text.length && end == -1) {
        val c = text.charAt(i)
        if (inString) {
          if (escaped) escaped = false
          else if (c == '\\') escaped = true
          else if (c == '"') inString = false
        } else if (c == '"') {
          inString = true
        } else if (c == '{') {
          depth += 1
        } else if (c == '}') {
          depth -= 1
          if (depth == 0) end = i
        }
        i += 1
      }
      if (end == -1) None else Some(text.substring(start, end + 1))
    }
  }
}
