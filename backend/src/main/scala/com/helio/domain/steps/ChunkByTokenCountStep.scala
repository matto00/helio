package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import com.knuddels.jtokkit.Encodings
import com.knuddels.jtokkit.api.{Encoding, EncodingType, IntArrayList}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `chunkbytokencount` step (HEL-221 — third and final of
 *  three planned "text ops"; mirrors `SplitTextConfig`/`ExtractHeadingsConfig`'s
 *  tolerant decode pattern, see design.md decision 2). `encoding` selects the
 *  `jtokkit` BPE encoding used to count/split tokens — `"o200k_base"`
 *  (GPT-4o family, default) or `"cl100k_base"` (GPT-3.5/4 family); any other
 *  value falls back to `"o200k_base"`, same tolerant-decode philosophy as
 *  every other config. */
final case class ChunkByTokenCountConfig(
    field: String,
    targetTokenCount: Int = 500,
    encoding: String = "o200k_base",
    indexField: String = "chunkIndex",
    tokenCountField: String = "tokenCount"
)

object ChunkByTokenCountConfig {
  implicit val format: RootJsonFormat[ChunkByTokenCountConfig] = jsonFormat5(ChunkByTokenCountConfig.apply)

  private val KnownEncodings = Set("o200k_base", "cl100k_base")

  def decode(raw: String): ChunkByTokenCountConfig = {
    val obj              = StepCodecUtil.asObject(raw)
    val field            = StepCodecUtil.stringOr(obj, "field", "")
    val targetTokenCount = StepCodecUtil.intOr(obj, "targetTokenCount", 500)
    val encodingRaw      = StepCodecUtil.stringOr(obj, "encoding", "o200k_base")
    val encoding         = if (KnownEncodings.contains(encodingRaw)) encodingRaw else "o200k_base"
    val indexField       = StepCodecUtil.stringOr(obj, "indexField", "chunkIndex")
    val tokenCountField  = StepCodecUtil.stringOr(obj, "tokenCountField", "tokenCount")
    ChunkByTokenCountConfig(field, targetTokenCount, encoding, indexField, tokenCountField)
  }
}

/** ChunkByTokenCount step — flatMap (many→more) transform: splits a
 *  `string-body` `field` into one output row per chunk of real BPE tokens.
 *
 *  For each input row: if `field` is `null` or absent, the row is dropped
 *  (zero output rows). Otherwise the field's string value is encoded into a
 *  BPE token-id sequence via the configured `jtokkit` encoding (see
 *  [[chunkTokens]]), split into consecutive chunks of at most
 *  `targetTokenCount` tokens (the final chunk holds the remainder;
 *  `targetTokenCount < 1` is clamped to `1` to avoid a degenerate/infinite
 *  split), and each chunk is decoded back to text. One output row is emitted
 *  per chunk: every other input field passes through unchanged, `field` is
 *  replaced by the decoded chunk text, `indexField` is set to the chunk's
 *  0-based position, and `tokenCountField` is set to that chunk's exact token
 *  count — both written last, so they win any name collision with `field` or
 *  another passthrough field (same "last write wins" rule
 *  `splittext`/`extractheadings` already use). An empty-string field value
 *  naturally yields zero tokens, hence zero chunks and zero output rows, with
 *  no special-casing needed beyond the null/missing check. */
final case class ChunkByTokenCountStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: ChunkByTokenCountConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = ChunkByTokenCountStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(ChunkByTokenCountStep.apply(rows, config))
}

object ChunkByTokenCountStep {
  val Kind: String = "chunkbytokencount"

  /** Shared registry — `jtokkit`'s default registry is stateless/thread-safe
   *  and expensive to rebuild per row, so it's resolved once per JVM. */
  private val registry = Encodings.newDefaultEncodingRegistry()

  private def encodingFor(name: String): Encoding = name match {
    case "cl100k_base" => registry.getEncoding(EncodingType.CL100K_BASE)
    case _              => registry.getEncoding(EncodingType.O200K_BASE)
  }

  def apply(rows: Seq[PipelineRowJson.Row], cfg: ChunkByTokenCountConfig): Seq[PipelineRowJson.Row] = {
    val field           = cfg.field
    val indexField      = cfg.indexField
    val tokenCountField = cfg.tokenCountField
    val encoding        = encodingFor(cfg.encoding)
    val chunkSize       = math.max(cfg.targetTokenCount, 1)

    rows.flatMap { row =>
      row.get(field) match {
        case None | Some(null) => Seq.empty
        case Some(value) =>
          chunkTokens(encoding, value.toString, chunkSize).zipWithIndex.map { case ((text, tokenCount), idx) =>
            row + (field -> text) + (indexField -> idx) + (tokenCountField -> tokenCount)
          }
      }
    }
  }

  /** Pure chunking function: encode `content` into a BPE token-id sequence via
   *  `encoding`, split it into consecutive groups of at most `chunkSize`
   *  tokens (the final group holds the remainder), and decode each group back
   *  to text. Returns `(chunkText, tokenCount)` pairs in document order; an
   *  empty/zero-token `content` yields an empty sequence. `jtokkit`'s
   *  `IntArrayList` has no slice/sublist method, so each chunk's token ids are
   *  copied into a freshly-sized `IntArrayList` before decoding — confirmed
   *  against the resolved `jtokkit:1.1.0` jar (see `ChunkByTokenCountStepSpec`
   *  for the encode→chunk→decode→re-encode round-trip that locks this in). */
  def chunkTokens(encoding: Encoding, content: String, chunkSize: Int): Seq[(String, Int)] = {
    val tokens = encoding.encode(content)
    val total  = tokens.size()
    if (total == 0) Seq.empty
    else
      (0 until total by chunkSize).map { start =>
        val end   = math.min(start + chunkSize, total)
        val chunk = new IntArrayList(end - start)
        var i     = start
        while (i < end) {
          chunk.add(tokens.get(i))
          i += 1
        }
        (encoding.decode(chunk), chunk.size())
      }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = ChunkByTokenCountConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[ChunkByTokenCountConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[ChunkByTokenCountConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[ChunkByTokenCountConfig].toJson
  }
}
