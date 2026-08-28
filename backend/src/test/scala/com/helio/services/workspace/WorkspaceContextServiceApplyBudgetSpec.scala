package com.helio.services.workspace

import com.helio.api.protocols.sources.ConnectorSummary
import com.helio.api.protocols.workspace.{WorkspaceContextAgentSection, WorkspaceContextColumn, WorkspaceContextColumnStats, WorkspaceContextComputedColumn, WorkspaceContextCounts, WorkspaceContextPipelineStep}
import com.helio.api.protocols.workspace.{WorkspaceContextDashboard, WorkspaceContextDataType, WorkspaceContextJoinHint, WorkspaceContextPipeline, WorkspaceContextProtocol, WorkspaceContextResponse}
import com.helio.services.workspace.WorkspaceContextBudget
import com.helio.domain.model.PagedResult
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-377 tasks.md 5.1/5.2 — pure unit tests for `WorkspaceContextBudget`
 *  (design.md D1-D9), mirroring `WorkspaceContextServiceComputeJoinHintsSpec`'s
 *  no-DB-fixture pattern (carried finding #7/#9: pure-unit specs, not
 *  DB-backed, for constructed edge cases — avoids HEL-630's extreme-numeric
 *  DB-read bug entirely since nothing here is ever written to Postgres).
 *
 *  `WorkspaceContextBudget.apply`/`paginationTruncatedResources` are pure
 *  functions of already-in-memory structures — every fixture below is
 *  constructed directly. */
class WorkspaceContextServiceApplyBudgetSpec extends AnyWordSpec with Matchers with WorkspaceContextProtocol {


  private val NaturalSampleRowCount    = 5
  private val NaturalExampleValueCount = 5

  /** Deliberately large per-row/per-example-value payloads so a single unit
   *  cut (one row, one example value) always recovers far more than the
   *  1-byte margin the "-1" budgets below rely on — makes every threshold
   *  test robust to exact JSON-overhead arithmetic (quotes/braces/commas)
   *  without hand-computing it. */
  private def paddedValue(prefix: String, i: Int): String = prefix + ("x" * 300) + i

  private def dataTypeFixture(id: String): WorkspaceContextDataType =
    WorkspaceContextDataType(
      id = id,
      name = s"dt-$id",
      sourceId = None,
      pipelineOutput = true,
      columns = Vector(WorkspaceContextColumn("value", "string", nullable = true, semanticRole = "text")),
      computedColumns = Vector.empty,
      version = 1,
      tag = None,
      sampleRows = (1 to NaturalSampleRowCount).map(i => JsObject("value" -> JsString(paddedValue("row-", i)))).toVector,
      columnStats = Map(
        "value" -> WorkspaceContextColumnStats(
          nullRate = 0.0,
          distinctCount = NaturalExampleValueCount,
          distinctCountCapped = false,
          exampleValues = (1 to NaturalExampleValueCount).map(i => JsString(paddedValue("ex-", i))).toVector,
          min = None,
          max = None,
          mean = None
        )
      )
    )

  private def joinHintFixture(i: Int): WorkspaceContextJoinHint =
    WorkspaceContextJoinHint(
      leftDataTypeId = s"left-$i",
      leftColumn = "value",
      rightDataTypeId = s"right-$i",
      rightColumn = "value",
      confidence = 0.9 - (i * 0.001)
    )

  private val NaturalJoinHintCount = 3

  private val connectorFixture: Vector[ConnectorSummary] =
    Vector(ConnectorSummary(id = "conn-1", name = "My API", kind = "rest_api", host = "https://api.example.com"))

  private def baseResponse(
      dataTypes: Vector[WorkspaceContextDataType],
      joinHints: Vector[WorkspaceContextJoinHint] = (1 to NaturalJoinHintCount).map(joinHintFixture).toVector,
      connectors: Vector[ConnectorSummary] = connectorFixture
  ): WorkspaceContextResponse =
    WorkspaceContextResponse(
      generatedAt = "2024-01-01T00:00:00Z",
      counts = WorkspaceContextCounts(dataSources = 0, dataTypes = dataTypes.size, pipelines = 0, dashboards = 0),
      dataSources = Vector.empty,
      dataTypes = dataTypes,
      pipelines = Vector.empty,
      dashboards = Vector.empty,
      joinHints = joinHints,
      truncation = WorkspaceContextBudget.PlaceholderTruncation,
      agentContext = WorkspaceContextAgentSection.empty,
      connectors = connectors
    )

  private val threeDataTypes: Vector[WorkspaceContextDataType] =
    Vector("a", "b", "c").map(dataTypeFixture)

  private val emptyPage: PagedResult[Unit] = PagedResult(Vector.empty, 0, 0, 200)

  private def naturalSizeOf(response: WorkspaceContextResponse): Int =
    WorkspaceContextBudget.apply(response, Int.MaxValue, emptyPage, emptyPage, emptyPage).truncation.estimatedSizeBytes

  /** The response's real, independently-measured CORE (every field except
   *  `truncation`) serialized length — computed via the SAME public
   *  formatter production code uses, but NOT by calling any of
   *  `WorkspaceContextBudget`'s own private helpers, so this is an honest
   *  cross-check of `estimatedSizeBytes`'s arithmetic, not a tautology. */
  private def realCoreSize(response: WorkspaceContextResponse): Int = {
    val full = workspaceContextResponseFormat.write(response).asJsObject
    JsObject(full.fields - "truncation").compactPrint.length
  }


  "apply (within budget)" should {
    "leave the response entirely unchanged and report applied = false" in {
      val response   = baseResponse(threeDataTypes)
      val naturalSize = naturalSizeOf(response)

      val result = WorkspaceContextBudget.apply(response, naturalSize, emptyPage, emptyPage, emptyPage)

      result.dataTypes shouldBe threeDataTypes
      result.joinHints shouldBe response.joinHints
      result.truncation.applied shouldBe false
      result.truncation.estimatedSizeBytes shouldBe naturalSize
      result.truncation.sampleRowsCap shouldBe NaturalSampleRowCount
      result.truncation.exampleValuesCap shouldBe NaturalExampleValueCount
      result.truncation.joinHintsKept shouldBe NaturalJoinHintCount
      result.truncation.joinHintsOmittedByBudget shouldBe 0
      result.truncation.structuralFloorExceedsBudget shouldBe false
    }

    "also leave the response unchanged for a budget well above natural size" in {
      val response = baseResponse(threeDataTypes)
      val result    = WorkspaceContextBudget.apply(response, Int.MaxValue, emptyPage, emptyPage, emptyPage)
      result.truncation.applied shouldBe false
      result.dataTypes shouldBe threeDataTypes
    }
  }

  // ── 5.1 tier-1-only (pins D3's "cut first" claim) ────────────────────────

  "apply (tier 1 only)" should {
    "shrink only sampleRows, leaving exampleValues and joinHints at their natural size" in {
      val response    = baseResponse(threeDataTypes)
      val naturalSize  = naturalSizeOf(response)

      // naturalSize doesn't fit by exactly 1 byte — cutting a single row
      // (a large, padded value) recovers far more than 1 byte, so this
      // resolves to a tier-1-only partial cut, never touching tier 2/3.
      val result = WorkspaceContextBudget.apply(response, naturalSize - 1, emptyPage, emptyPage, emptyPage)

      result.truncation.applied shouldBe true
      result.truncation.sampleRowsCap should be < NaturalSampleRowCount
      result.truncation.sampleRowsCap should be >= 0
      result.truncation.exampleValuesCap shouldBe NaturalExampleValueCount
      result.truncation.joinHintsKept shouldBe NaturalJoinHintCount
      result.truncation.structuralFloorExceedsBudget shouldBe false

      // The pinned assertion: every DataType's exampleValues and every
      // joinHint are BYTE-IDENTICAL to their natural value — not merely
      // "still present."
      result.dataTypes.zip(threeDataTypes).foreach { case (trimmed, natural) =>
        trimmed.columnStats shouldBe natural.columnStats
      }
      result.joinHints shouldBe response.joinHints

      // sampleRows itself DID shrink for every DataType (uniform global cap,
      // not per-DataType-selective — design.md D3).
      result.dataTypes.foreach(_.sampleRows.size shouldBe result.truncation.sampleRowsCap)
    }
  }


  "apply (tier 1 exhausted, tier 2 partial)" should {
    "empty sampleRows everywhere and partially shrink exampleValues, leaving joinHints natural" in {
      val response = baseResponse(threeDataTypes)

      val zeroRowsDataTypes = threeDataTypes.map(dt => dt.copy(sampleRows = Vector.empty))
      val sizeAfterTier1     = naturalSizeOf(baseResponse(zeroRowsDataTypes))

      val result = WorkspaceContextBudget.apply(response, sizeAfterTier1 - 1, emptyPage, emptyPage, emptyPage)

      result.truncation.applied shouldBe true
      result.truncation.sampleRowsCap shouldBe 0
      result.truncation.exampleValuesCap should be < NaturalExampleValueCount
      result.truncation.exampleValuesCap should be >= 0
      result.truncation.joinHintsKept shouldBe NaturalJoinHintCount
      result.truncation.structuralFloorExceedsBudget shouldBe false

      result.dataTypes.foreach(_.sampleRows shouldBe Vector.empty)
      result.dataTypes.foreach { dt =>
        dt.columnStats.values.foreach(_.exampleValues.size shouldBe result.truncation.exampleValuesCap)
      }
      result.joinHints shouldBe response.joinHints
    }
  }

  // ── 5.1 tier-1+2+3 (all three tiers, structural floor NOT yet exceeded) ──

  "apply (tiers 1 and 2 exhausted, tier 3 partial)" should {
    "empty sampleRows and exampleValues everywhere and partially shrink joinHints" in {
      val response = baseResponse(threeDataTypes)

      val zeroRowsAndExamplesDataTypes = threeDataTypes.map(dt =>
        dt.copy(sampleRows = Vector.empty, columnStats = dt.columnStats.map { case (k, v) => k -> v.copy(exampleValues = Vector.empty) })
      )
      val sizeAfterTier2 = naturalSizeOf(baseResponse(zeroRowsAndExamplesDataTypes))

      val result = WorkspaceContextBudget.apply(response, sizeAfterTier2 - 1, emptyPage, emptyPage, emptyPage)

      result.truncation.applied shouldBe true
      result.truncation.sampleRowsCap shouldBe 0
      result.truncation.exampleValuesCap shouldBe 0
      result.truncation.joinHintsKept should be < NaturalJoinHintCount
      result.truncation.joinHintsKept should be >= 0
      result.truncation.joinHintsOmittedByBudget shouldBe (NaturalJoinHintCount - result.truncation.joinHintsKept)
      result.truncation.structuralFloorExceedsBudget shouldBe false

      result.dataTypes.foreach(_.sampleRows shouldBe Vector.empty)
      result.dataTypes.foreach(_.columnStats.values.foreach(_.exampleValues shouldBe Vector.empty))
      // The already-sorted (confidence descending) PREFIX is kept.
      result.joinHints shouldBe response.joinHints.take(result.truncation.joinHintsKept)
    }
  }


  "apply (structural floor exceeded)" should {
    "empty sampleRows/exampleValues/joinHints entirely and flag structuralFloorExceedsBudget" in {
      val response = baseResponse(threeDataTypes)

      val result = WorkspaceContextBudget.apply(response, 0, emptyPage, emptyPage, emptyPage)

      result.truncation.applied shouldBe true
      result.truncation.sampleRowsCap shouldBe 0
      result.truncation.exampleValuesCap shouldBe 0
      result.truncation.joinHintsKept shouldBe 0
      result.truncation.joinHintsOmittedByBudget shouldBe NaturalJoinHintCount
      result.truncation.structuralFloorExceedsBudget shouldBe true

      result.dataTypes.foreach(_.sampleRows shouldBe Vector.empty)
      result.dataTypes.foreach(_.columnStats.values.foreach(_.exampleValues shouldBe Vector.empty))
      result.joinHints shouldBe Vector.empty

      // Resources themselves are NEVER dropped, even at the tightest budget —
      // the acceptance criterion this case exists to prove.
      result.dataTypes.map(_.id) shouldBe threeDataTypes.map(_.id)
    }

    // HEL-828 design.md Decision 5 / spec "Connectors are a structural field, never shrunk by
    // budget trimming" — mirrors the dataTypes-survive assertion immediately above.
    "never shrink or omit connectors, even at the tightest budget" in {
      val response = baseResponse(threeDataTypes)

      val result = WorkspaceContextBudget.apply(response, 0, emptyPage, emptyPage, emptyPage)

      result.connectors shouldBe connectorFixture
    }
  }


  "apply (budgetBytes = 0)" should {
    "never alter any tier-0 (structural) field" in {
      val richDataTypes = Vector(
        WorkspaceContextDataType(
          id = "dt-1",
          name = "orders",
          sourceId = None,
          pipelineOutput = true,
          columns = Vector(
            WorkspaceContextColumn("id", "string", nullable = false, semanticRole = "identifier"),
            WorkspaceContextColumn("amount", "float", nullable = true, semanticRole = "measure")
          ),
          computedColumns = Vector(WorkspaceContextComputedColumn("doubled", "float", "amount * 2")),
          version = 3,
          tag = Some("finance"),
          sampleRows = Vector(JsObject("amount" -> JsNumber(12.5))),
          columnStats = Map(
            "amount" -> WorkspaceContextColumnStats(
              nullRate = 0.1,
              distinctCount = 42,
              distinctCountCapped = false,
              exampleValues = Vector(JsNumber(1), JsNumber(2)),
              min = Some(1.0),
              max = Some(99.0),
              mean = Some(50.25)
            )
          )
        )
      )
      val pipelines = Vector(
        WorkspaceContextPipeline(
          id = "p1",
          name = "orders-pipeline",
          sourceDataSourceId = "src-1",
          sourceDataSourceName = "source-1",
          outputDataTypeId = "dt-1",
          outputDataTypeName = "orders",
          lastRunStatus = Some("success"),
          lastRunAt = Some("2024-01-01T00:00:00Z"),
          lastRunRowCount = Some(100L),
          tag = None,
          steps = Vector(WorkspaceContextPipelineStep(0, "cast", Vector("amount"), None)),
          stepsError = None
        )
      )
      val dashboards = Vector(WorkspaceContextDashboard("dash-1", "Overview", panelCount = 4))

      val response = baseResponse(richDataTypes).copy(
        counts = WorkspaceContextCounts(dataSources = 1, dataTypes = 1, pipelines = 1, dashboards = 1),
        pipelines = pipelines,
        dashboards = dashboards
      )

      val result = WorkspaceContextBudget.apply(response, 0, emptyPage, emptyPage, emptyPage)

      result.counts shouldBe response.counts
      result.pipelines shouldBe response.pipelines
      result.dashboards shouldBe response.dashboards

      result.dataTypes.zip(richDataTypes).foreach { case (trimmed, natural) =>
        trimmed.id shouldBe natural.id
        trimmed.name shouldBe natural.name
        trimmed.sourceId shouldBe natural.sourceId
        trimmed.pipelineOutput shouldBe natural.pipelineOutput
        trimmed.columns shouldBe natural.columns
        trimmed.computedColumns shouldBe natural.computedColumns
        trimmed.version shouldBe natural.version
        trimmed.tag shouldBe natural.tag

        trimmed.columnStats.keySet shouldBe natural.columnStats.keySet
        trimmed.columnStats.foreach { case (name, trimmedStats) =>
          val naturalStats = natural.columnStats(name)
          trimmedStats.nullRate shouldBe naturalStats.nullRate
          trimmedStats.distinctCount shouldBe naturalStats.distinctCount
          trimmedStats.distinctCountCapped shouldBe naturalStats.distinctCountCapped
          trimmedStats.min shouldBe naturalStats.min
          trimmedStats.max shouldBe naturalStats.max
          trimmedStats.mean shouldBe naturalStats.mean
          // Only the value-level enrichment tier is shed.
          trimmedStats.exampleValues shouldBe Vector.empty
        }
      }
    }
  }


  "apply (determinism)" should {
    "produce byte-identical output for the same input and budget across repeated calls" in {
      val response    = baseResponse(threeDataTypes)
      val naturalSize  = naturalSizeOf(response)
      val budget       = naturalSize / 2

      val first  = WorkspaceContextBudget.apply(response, budget, emptyPage, emptyPage, emptyPage)
      val second = WorkspaceContextBudget.apply(response, budget, emptyPage, emptyPage, emptyPage)

      workspaceContextResponseFormat.write(first).compactPrint shouldBe workspaceContextResponseFormat.write(second).compactPrint
    }
  }

  // ── 5.1 arithmetic-exactness (pins D4's decomposition identity) ─────────

  "apply (arithmetic exactness)" should {
    "report an estimatedSizeBytes that exactly equals the actual returned response's real core size" in {
      val response    = baseResponse(threeDataTypes)
      val naturalSize  = naturalSizeOf(response)

      Seq(naturalSize - 1, naturalSize / 2, 0).foreach { budget =>
        val result = WorkspaceContextBudget.apply(response, budget, emptyPage, emptyPage, emptyPage)
        realCoreSize(result) shouldBe result.truncation.estimatedSizeBytes
      }
    }
  }

  // ── Non-blocking suggestion (evaluation-1.md cycle 1): heterogeneous natural
  // sizes — pins that the derived natural cap is a MAX reduction (not e.g. a
  // MIN, and not an assumption every DataType/column shares the same natural
  // size), and that `Vector.take(cap)` gracefully saturates (a no-op) for a
  // DataType/column whose own natural size is already below the derived cap.
  // Every other fixture in this file uses UNIFORM per-DataType/per-column
  // natural sizes, so this specific behavior wasn't directly pinned before.

  "apply (heterogeneous natural sizes — sampleRows)" should {
    "derive sampleRowsCap as the MAX across DataTypes, and leave a DataType with fewer natural rows untouched by take() saturation" in {
      val smallDataType = dataTypeFixture("small").copy(sampleRows = dataTypeFixture("small").sampleRows.take(2))
      val dataTypes      = Vector(smallDataType, dataTypeFixture("full-b"), dataTypeFixture("full-c"))
      val response       = baseResponse(dataTypes)
      val naturalSize    = naturalSizeOf(response)

      // Within budget: sampleRowsCap reports the MAX (5) even though "small"
      // naturally has only 2 — not a MIN, not "every DataType matches."
      val withinBudget = WorkspaceContextBudget.apply(response, naturalSize, emptyPage, emptyPage, emptyPage)
      withinBudget.truncation.sampleRowsCap shouldBe NaturalSampleRowCount
      withinBudget.dataTypes.find(_.id == "small").get.sampleRows.size shouldBe 2

      // Force a partial tier-1 cut to naturalCap - 1 (4) — ABOVE "small"'s own
      // natural size (2), so "small" must be left untouched by take()
      // saturation while "full-b"/"full-c" (natural 5) shrink to exactly 4.
      val result = WorkspaceContextBudget.apply(response, naturalSize - 1, emptyPage, emptyPage, emptyPage)
      result.truncation.sampleRowsCap shouldBe (NaturalSampleRowCount - 1)
      result.dataTypes.find(_.id == "small").get.sampleRows.size shouldBe 2
      result.dataTypes.filterNot(_.id == "small").foreach(_.sampleRows.size shouldBe result.truncation.sampleRowsCap)
    }
  }

  "apply (heterogeneous natural sizes — exampleValues)" should {
    "derive exampleValuesCap as the MAX across columns, and leave a column with fewer natural example values untouched by take() saturation" in {
      val small = dataTypeFixture("small")
      val smallDataType = small.copy(
        columnStats = Map("value" -> small.columnStats("value").copy(exampleValues = small.columnStats("value").exampleValues.take(2)))
      )
      // sampleRows already emptied on every DataType, so this response's own
      // naturalSizeOf IS "sizeAfterTier1" — isolates the assertion to tier 2.
      val dataTypes   = Vector(smallDataType, dataTypeFixture("full-b"), dataTypeFixture("full-c")).map(dt => dt.copy(sampleRows = Vector.empty))
      val response    = baseResponse(dataTypes)
      val sizeAfterTier1 = naturalSizeOf(response)

      val withinBudget = WorkspaceContextBudget.apply(response, sizeAfterTier1, emptyPage, emptyPage, emptyPage)
      withinBudget.truncation.exampleValuesCap shouldBe NaturalExampleValueCount
      withinBudget.dataTypes.find(_.id == "small").get.columnStats("value").exampleValues.size shouldBe 2

      val result = WorkspaceContextBudget.apply(response, sizeAfterTier1 - 1, emptyPage, emptyPage, emptyPage)
      result.truncation.exampleValuesCap shouldBe (NaturalExampleValueCount - 1)
      result.dataTypes.find(_.id == "small").get.columnStats("value").exampleValues.size shouldBe 2
      result.dataTypes.filterNot(_.id == "small").foreach(_.columnStats("value").exampleValues.size shouldBe result.truncation.exampleValuesCap)
    }
  }


  "paginationTruncatedResources" should {
    "report [] when no page was truncated" in {
      val full = PagedResult(Vector.fill(3)(()), 3, 0, 200)
      WorkspaceContextBudget.paginationTruncatedResources(full, full, full) shouldBe Vector.empty
    }

    "report exactly the truncated resource kind(s), preserving dataSources/dataTypes/dashboards order" in {
      val truncatedSources    = PagedResult(Vector.fill(200)(()), 250, 0, 200)
      val untruncatedTypes    = PagedResult(Vector.fill(5)(()), 5, 0, 200)
      val truncatedDashboards = PagedResult(Vector.fill(200)(()), 201, 0, 200)

      WorkspaceContextBudget.paginationTruncatedResources(truncatedSources, untruncatedTypes, truncatedDashboards) shouldBe
        Vector("dataSources", "dashboards")
    }

    "report all three when all three are truncated" in {
      val truncated = PagedResult(Vector.fill(200)(()), 500, 0, 200)
      WorkspaceContextBudget.paginationTruncatedResources(truncated, truncated, truncated) shouldBe
        Vector("dataSources", "dataTypes", "dashboards")
    }
  }
}
