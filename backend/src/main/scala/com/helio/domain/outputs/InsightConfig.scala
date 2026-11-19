package com.helio.domain.outputs

import com.helio.domain.history.OutputCompare
import com.helio.domain.insights.InsightPreset
import com.helio.domain.model.OutputId
import spray.json.{JsArray, JsNull, JsNumber, JsObject, JsString, JsValue}

/** HEL-1740: an `insight` Output's effective config. Pure; no I/O. `parse` applies the defaults
 *  (never written back to stored config) and rejects any value outside the contract with a message
 *  naming the key. A key set to JSON `null` is cleared, i.e. treated as absent. HEL-1743 R1: `model` names
 *  a model the shared `ClaudeModelCatalog` currently lists as selectable (the predicate is injected so this
 *  domain type stays free of infrastructure); absent means the server default. */
final case class InsightReads(outputs: Option[Vector[OutputId]], windows: Vector[String])

final case class InsightConfig(
    preset:       InsightPreset,
    prompt:       Option[String],
    reads:        InsightReads,
    refresh:      InsightRefresh,
    maxSentences: Int,
    maxChars:     Int,
    model:        Option[String] = None
)

sealed trait InsightRefresh { def asString: String }
object InsightRefresh {
  case object OnRun  extends InsightRefresh { val asString = "on_run" }
  case object Daily  extends InsightRefresh { val asString = "daily" }
  case object Manual extends InsightRefresh { val asString = "manual" }
  val all: Vector[InsightRefresh] = Vector(OnRun, Daily, Manual)
  def fromString(s: String): Option[InsightRefresh] = all.find(_.asString == s)
}

object InsightConfig {
  val Keys: Set[String] = Set("fieldMapping", "preset", "prompt", "reads", "refresh", "maxSentences", "maxChars", "model")
  /** The keys an insight owns beyond `fieldMapping` (what `KnownKeys` adds and `KeysDoc` would document). */
  val OwnKeys: Set[String] = Keys - "fieldMapping"

  val DefaultMaxSentences = 2
  val DefaultMaxChars     = 400
  val MaxSentencesRange   = 1 to 6
  val MaxCharsRange       = 80 to 1200
  val MaxPromptChars      = 2000
  val MaxReadOutputs      = 8
  val MaxReadWindows      = 4

  private val ReadsKeys = Set("outputs", "windows")

  private def present(config: JsObject, key: String): Option[JsValue] =
    config.fields.get(key).filter(_ != JsNull)

  /** `isSelectableModel` is required (no default) so every caller must say which catalog judges `model`. */
  def parse(config: JsObject, isSelectableModel: String => Boolean): Either[String, InsightConfig] =
    for {
      preset <- parsePreset(config)
      prompt <- parsePrompt(config)
      reads  <- parseReads(config)
      refresh <- parseRefresh(config)
      sentences <- parseInt(config, "maxSentences", MaxSentencesRange, DefaultMaxSentences)
      chars  <- parseInt(config, "maxChars", MaxCharsRange, DefaultMaxChars)
      model  <- parseModel(config, isSelectableModel)
    } yield InsightConfig(preset, prompt, reads, refresh, sentences, chars, model)

  private def parseModel(config: JsObject, isSelectableModel: String => Boolean): Either[String, Option[String]] =
    present(config, "model") match {
      case None => Right(None)
      case Some(JsString(s)) if isSelectableModel(s) => Right(Some(s))
      case Some(_) => Left("model must be the id of a selectable model (see GET /api/assistant-models), or omitted for the server default")
    }

  private def parsePreset(config: JsObject): Either[String, InsightPreset] =
    present(config, "preset") match {
      case None => Right(InsightPreset.Auto)
      case Some(JsString(s)) =>
        InsightPreset.fromString(s).toRight(s"preset must be one of ${InsightPreset.all.map(_.asString).mkString(", ")}")
      case Some(_) => Left(s"preset must be one of ${InsightPreset.all.map(_.asString).mkString(", ")}")
    }

  private def parsePrompt(config: JsObject): Either[String, Option[String]] =
    present(config, "prompt") match {
      case None => Right(None)
      case Some(JsString(s)) if s.length <= MaxPromptChars => Right(Some(s))
      case Some(_) => Left(s"prompt must be a string of at most $MaxPromptChars characters")
    }

  private def parseRefresh(config: JsObject): Either[String, InsightRefresh] =
    present(config, "refresh") match {
      case None => Right(InsightRefresh.OnRun)
      case Some(JsString(s)) =>
        InsightRefresh.fromString(s).toRight(s"refresh must be one of ${InsightRefresh.all.map(_.asString).mkString(", ")}")
      case Some(_) => Left(s"refresh must be one of ${InsightRefresh.all.map(_.asString).mkString(", ")}")
    }

  private def parseInt(config: JsObject, key: String, range: Range, default: Int): Either[String, Int] =
    present(config, key) match {
      case None => Right(default)
      case Some(JsNumber(n)) if n.isWhole && n >= range.start && n <= range.end => Right(n.toInt)
      case Some(_) => Left(s"$key must be a whole number from ${range.start} to ${range.end}")
    }

  private def parseReads(config: JsObject): Either[String, InsightReads] =
    present(config, "reads") match {
      case None => Right(InsightReads(None, Vector.empty))
      case Some(o: JsObject) =>
        val unknown = o.fields.keySet -- ReadsKeys
        if (unknown.nonEmpty) Left(s"Unknown key ${unknown.toVector.sorted.map(k => s"`reads.$k`").mkString(", ")} (reads accepts only outputs and windows)")
        else
          for {
            outs <- parseReadOutputs(o)
            wins <- parseReadWindows(o)
          } yield InsightReads(outs, wins)
      case Some(_) => Left("reads must be an object { outputs, windows }")
    }

  private def parseReadOutputs(reads: JsObject): Either[String, Option[Vector[OutputId]]] =
    present(reads, "outputs") match {
      case None => Right(None)
      case Some(JsArray(items)) =>
        val ids = items.collect { case JsString(s) if s.trim.nonEmpty => s }
        if (ids.size != items.size) Left("reads.outputs must be an array of Output id strings")
        else if (ids.size > MaxReadOutputs) Left(s"reads.outputs may name at most $MaxReadOutputs Outputs")
        else if (ids.distinct.size != ids.size) Left("reads.outputs must not repeat an Output id")
        else Right(Some(ids.map(OutputId(_))))
      case Some(_) => Left("reads.outputs must be an array of Output id strings")
    }

  private def parseReadWindows(reads: JsObject): Either[String, Vector[String]] =
    present(reads, "windows") match {
      case None => Right(Vector.empty)
      case Some(JsArray(items)) =>
        val tokens = items.collect { case JsString(s) => s }
        if (tokens.size != items.size) Left("reads.windows must be an array of window strings (1d, 7d, 30d or custom:<ISO-8601 duration>)")
        else if (tokens.size > MaxReadWindows) Left(s"reads.windows may name at most $MaxReadWindows windows")
        else if (tokens.distinct.size != tokens.size) Left("reads.windows must not repeat a window")
        else
          tokens.map(t => if (t == "previous_run") Left("reads.windows cannot contain previous_run (it is not a window)") else OutputCompare.parse(t).left.map(_ => s"reads.windows entry '$t' is not a window (1d, 7d, 30d or custom:<ISO-8601 duration up to 365 days>)"))
            .collectFirst { case Left(m) => m }.toLeft(tokens)
      case Some(_) => Left("reads.windows must be an array of window strings (1d, 7d, 30d or custom:<ISO-8601 duration>)")
    }
}
