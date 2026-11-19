package com.helio.domain.insights

import java.nio.charset.StandardCharsets
import java.lang.{Double => JDouble}
import java.security.MessageDigest

/** HEL-1743 D3: the input digest is a function of the DATA a render would narrate, never of time. It covers the effective
 *  preset, the prompt, the sentence and character caps, the effective model, the head's columns and cell values, each
 *  compare's current value and delta (an absent baseline and a zero delta encode identically as `flat`), and each window's
 *  label and point values with consecutive repeats collapsed. It never hashes `InsightPack.serialized` (which carries
 *  timestamps) or any timestamp. */
object InsightDigest {

  def compute(preset: InsightPreset, spec: InsightRenderSpec, modelId: String, inputs: InsightInputs): String = {
    val parts = Vector.newBuilder[String]
    parts += s"preset=${preset.asString}"
    parts += s"prompt=${spec.customPrompt.getOrElse("")}"
    parts += s"sentences=${spec.maxSentences}"
    parts += s"chars=${spec.maxChars}"
    parts += s"model=$modelId"
    inputs.head.foreach { h =>
      parts += s"head.output=${h.outputId}"
      parts += s"head.columns=${h.columns.mkString("\u001f")}"
      h.rows.foreach(r => parts += "row=" + h.columns.map(c => r.fields.get(c).map(_.compactPrint).getOrElse("")).mkString("\u001f"))
    }
    inputs.compares.foreach { c =>
      parts += s"compare=${c.outputId}|${c.field}|${c.compare}|${num(c.current)}|${delta(c.delta)}"
    }
    inputs.windows.foreach { w =>
      val values = collapse(w.points.map(_._2))
      parts += s"window=${w.outputId}|${w.label}|${values.map(num(_)).mkString(",")}"
    }
    sha256Hex(parts.result().mkString("\n"))
  }

  /** A zero delta and an absent one are both "flat": the first run has no baseline, the second (identical data) has one
   *  and a delta of 0, and those two must not look different. */
  private def delta(d: Option[Double]): String = d.filter(_ != 0.0) match {
    case None    => "flat"
    case Some(v) => num(v)
  }

  private def num(v: Option[Double]): String = v.fold("none")(num)
  private def num(v: Double): String         = JDouble.toString(v)

  private def collapse(values: Vector[Double]): Vector[Double] =
    values.foldLeft(Vector.empty[Double])((acc, v) => if (acc.lastOption.contains(v)) acc else acc :+ v)

  private def sha256Hex(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)).map(b => f"${b & 0xff}%02x").mkString
}
