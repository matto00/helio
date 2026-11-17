package com.helio.domain.insights

import spray.json.JsObject

import java.time.Instant

/** HEL-1741 D2: everything a grounding pack may be built from. Deliberately holds no data source, source
 *  config or credential (type-level): a pack can only contain what these fields can carry. Independent of
 *  any insight Output kind. */
final case class InsightHead(outputId: String, capturedAt: Instant, columns: Vector[String], rows: Vector[JsObject])

final case class InsightCompare(
    outputId: String,
    outputName: String,
    field: String,
    compare: String,
    current: Option[Double],
    baseline: Option[Double],
    delta: Option[Double],
    pct: Option[Double],
    currentAt: Option[Instant],
    baselineAt: Option[Instant]
)

/** Summary points of one Output over a configured window, oldest first. */
final case class InsightWindow(outputId: String, label: String, points: Vector[(Instant, Double)])

final case class InsightInputs(head: Option[InsightHead], compares: Vector[InsightCompare], windows: Vector[InsightWindow])

/** Per-render caps (owner ruling D2): about 8k input and 400 output tokens. */
final case class InsightLimits(maxInputTokens: Int = 8000, maxOutputTokens: Int = 400, maxHeadRows: Int = 50, maxCellChars: Int = 200)

/** The caller-supplied shape of one render. `customPrompt` goes in the instruction part, never the data block. */
final case class InsightRenderSpec(maxSentences: Int, maxChars: Int, customPrompt: Option[String] = None)
