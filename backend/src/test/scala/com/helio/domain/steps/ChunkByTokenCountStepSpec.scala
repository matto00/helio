package com.helio.domain.steps

import com.knuddels.jtokkit.Encodings
import com.knuddels.jtokkit.api.EncodingType
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Standalone unit-test spec for the `chunkbytokencount` op's chunking logic
 *  (HEL-221 — third per-step spec file, mirrors `ExtractHeadingsStepSpec`'s
 *  standalone structure; see design.md decision 10). Full-engine round-trip
 *  coverage lives alongside the other kinds in `InProcessPipelineEngineSpec`.
 *
 *  Also locks in the `jtokkit:1.1.0` API surface (decision 4): `Encoding.encode`
 *  returns an `IntArrayList` with no slice/sublist method, so chunking copies
 *  token ids into freshly-sized `IntArrayList`s before `decode`. */
class ChunkByTokenCountStepSpec extends AnyWordSpec with Matchers {

  private val registry   = Encodings.newDefaultEncodingRegistry()
  private val o200k      = registry.getEncoding(EncodingType.O200K_BASE)
  private val cl100k     = registry.getEncoding(EncodingType.CL100K_BASE)

  "ChunkByTokenCountStep.chunkTokens" should {
    "round-trip encode -> chunk -> decode -> re-encode to the same token counts (o200k_base)" in {
      val content = "The quick brown fox jumps over the lazy dog. " * 50
      val chunks  = ChunkByTokenCountStep.chunkTokens(o200k, content, chunkSize = 20)

      chunks should not be empty
      chunks.foreach { case (text, tokenCount) =>
        o200k.encode(text).size() shouldBe tokenCount
      }
    }

    "round-trip encode -> chunk -> decode -> re-encode to the same token counts (cl100k_base)" in {
      val content = "The quick brown fox jumps over the lazy dog. " * 50
      val chunks  = ChunkByTokenCountStep.chunkTokens(cl100k, content, chunkSize = 20)

      chunks should not be empty
      chunks.foreach { case (text, tokenCount) =>
        cl100k.encode(text).size() shouldBe tokenCount
      }
    }

    "splits an exact multiple of chunkSize into equal-sized chunks with no remainder" in {
      val content     = "word " * 40 // simple repeated-token content
      val totalTokens = o200k.encode(content).size()
      totalTokens should be > 0
      // chunkSize=1 always evenly divides any positive totalTokens, giving a
      // deterministic "exact multiple" boundary case regardless of the exact
      // BPE tokenization of `content`.
      val chunks = ChunkByTokenCountStep.chunkTokens(o200k, content, chunkSize = 1)
      chunks should have size totalTokens
      chunks.foreach(_._2 shouldBe 1)
      chunks.map(_._2).sum shouldBe totalTokens
    }

    "final chunk holds the remainder when total tokens isn't an exact multiple of chunkSize" in {
      val content     = "one two three four five six seven"
      val totalTokens = o200k.encode(content).size()
      totalTokens should be > 1

      val chunkSize = totalTokens - 1
      val chunks    = ChunkByTokenCountStep.chunkTokens(o200k, content, chunkSize)
      chunks should have size 2
      chunks(0)._2 shouldBe chunkSize
      chunks(1)._2 shouldBe (totalTokens - chunkSize)
    }

    "empty content yields zero chunks" in {
      ChunkByTokenCountStep.chunkTokens(o200k, "", chunkSize = 10) shouldBe empty
    }
  }

  "ChunkByTokenCountStep.apply (row-level flatMap semantics)" should {
    "emits one row per chunk with passthrough fields, index, and token count" in {
      val content = "one two three four five six seven eight nine ten"
      val rows    = Seq(Map[String, Any]("content" -> content, "filename" -> "doc.txt"))
      val cfg     = ChunkByTokenCountConfig(field = "content", targetTokenCount = 3)
      val result  = ChunkByTokenCountStep.apply(rows, cfg)

      val totalTokens = o200k.encode(content).size()
      val expectedChunkCount = math.ceil(totalTokens.toDouble / 3).toInt
      result should have size expectedChunkCount

      result.zipWithIndex.foreach { case (row, idx) =>
        row("filename") shouldBe "doc.txt"
        row("chunkIndex") shouldBe idx
        row("content") shouldBe a[String]
        row("tokenCount") shouldBe a[java.lang.Integer]
      }
    }

    "drops the row when the field value is null" in {
      val rows = Seq(Map[String, Any]("content" -> null, "filename" -> "doc.txt"))
      val cfg  = ChunkByTokenCountConfig(field = "content")
      ChunkByTokenCountStep.apply(rows, cfg) shouldBe empty
    }

    "drops the row when the field is absent entirely" in {
      val rows = Seq(Map[String, Any]("filename" -> "doc.txt"))
      val cfg  = ChunkByTokenCountConfig(field = "content")
      ChunkByTokenCountStep.apply(rows, cfg) shouldBe empty
    }

    "drops the row when the field value is an empty string (zero tokens)" in {
      val rows = Seq(Map[String, Any]("content" -> ""))
      val cfg  = ChunkByTokenCountConfig(field = "content")
      ChunkByTokenCountStep.apply(rows, cfg) shouldBe empty
    }

    "uses custom indexField and tokenCountField names" in {
      val rows = Seq(Map[String, Any]("content" -> "one two three four five six"))
      val cfg  = ChunkByTokenCountConfig(
        field = "content",
        targetTokenCount = 3,
        indexField = "idx",
        tokenCountField = "count"
      )
      val result = ChunkByTokenCountStep.apply(rows, cfg)
      result.foreach { row =>
        row.contains("idx") shouldBe true
        row.contains("count") shouldBe true
      }
    }

    "indexField/tokenCountField collision with existing passthrough fields: metadata wins (last write wins)" in {
      val rows = Seq(
        Map[String, Any]("content" -> "one two three", "chunkIndex" -> "preexisting", "tokenCount" -> "preexisting")
      )
      val cfg    = ChunkByTokenCountConfig(field = "content", targetTokenCount = 100)
      val result = ChunkByTokenCountStep.apply(rows, cfg)
      result(0)("chunkIndex") shouldBe 0
      result(0)("tokenCount") shouldBe a[java.lang.Integer]
    }

    "clamps a non-positive targetTokenCount to 1 rather than looping infinitely" in {
      val rows   = Seq(Map[String, Any]("content" -> "one two three"))
      val cfg    = ChunkByTokenCountConfig(field = "content", targetTokenCount = 0)
      val result = ChunkByTokenCountStep.apply(rows, cfg)
      val totalTokens = o200k.encode("one two three").size()
      result should have size totalTokens
    }
  }

  "ChunkByTokenCountConfig.decode" should {
    "falls back to o200k_base for an unrecognized encoding value" in {
      val cfg = ChunkByTokenCountConfig.decode("""{"field":"content","encoding":"unknown-encoding"}""")
      cfg.encoding shouldBe "o200k_base"
    }

    "accepts cl100k_base as a valid encoding value" in {
      val cfg = ChunkByTokenCountConfig.decode("""{"field":"content","encoding":"cl100k_base"}""")
      cfg.encoding shouldBe "cl100k_base"
    }

    "applies typed defaults for a partial config" in {
      val cfg = ChunkByTokenCountConfig.decode("""{"field":"content"}""")
      cfg.targetTokenCount shouldBe 500
      cfg.encoding shouldBe "o200k_base"
      cfg.indexField shouldBe "chunkIndex"
      cfg.tokenCountField shouldBe "tokenCount"
    }
  }
}
