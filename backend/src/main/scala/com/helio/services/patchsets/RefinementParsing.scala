package com.helio.services.patchsets

import com.helio.services.proposals.DashboardAuthoringParsing
import com.helio.api.protocols.patchsets.{PatchSet, PatchSetProtocol}
import spray.json._

import scala.util.{Failure, Success, Try}

/** Defensive JSON extraction + parsing of a Claude text response into a `PatchSet` (design.md D2) —
 *  mirrors `DashboardAuthoringParsing` exactly, reusing its brace-depth/string-aware
 *  `extractJsonObject` scanner verbatim (both live in `com.helio.services`, so the `private[services]`
 *  visibility already permits this) rather than duplicating it. HEL-390 models Claude output as free
 *  text, not native tool-use, so the model's response may (despite the prompt's instruction) carry
 *  leading/trailing prose around the JSON object. */
object RefinementParsing extends PatchSetProtocol {

  /** `Left` carries a human-readable message suitable both as a rejection reason and as the error
   *  text fed back in the repair prompt (`RefinementPrompt.repairMessage`) — never a raw exception
   *  `toString`/stack trace. */
  def parsePatchSet(text: String): Either[String, PatchSet] =
    DashboardAuthoringParsing.extractJsonObject(text) match {
      case None => Left("Model response did not contain a JSON object")
      case Some(jsonText) =>
        Try(jsonText.parseJson.convertTo[PatchSet]) match {
          case Success(patchSet) => Right(patchSet)
          case Failure(ex)       => Left(s"Failed to parse model response as a patch set: ${describe(ex)}")
        }
    }

  private def describe(ex: Throwable): String = Option(ex.getMessage).getOrElse(ex.getClass.getName)
}
