package com.helio.services.workspace

import com.helio.api.JsonProtocols
import com.helio.api.protocols.workspace.{WorkspaceContextDataType, WorkspaceContextResponse, WorkspaceContextTruncation}
import com.helio.domain.model.PagedResult
import spray.json._

/** Deterministic, pure budgeting pass over an already-assembled
 *  `WorkspaceContextResponse` (HEL-377 design.md D1-D9) — the LAST step of
 *  `WorkspaceContextService.assemble`, never a new query, never a re-fetch
 *  (design.md D2: every large input this ticket could touch — raw ≤500-row
 *  fetches — is already consumed and released before `assemble` finishes
 *  building `dataTypes`; this pass's own input is the final, already-bounded
 *  in-memory structure). A NEW file, not an addition to the already
 *  705-line `WorkspaceContextService.scala` (HEL-631, explicitly deferred —
 *  this ticket doesn't refactor that file, just doesn't grow it further).
 *
 *  **Shed order (design.md D3, applied only when over budget)**: tier 0
 *  (ids, `columns[]` including `semanticRole`, `columnStats[*]`'s scalar
 *  fields, pipeline `steps[]`, dashboards) is NEVER shrunk at any budget,
 *  including `budgetBytes = 0`. Cut 1st: `sampleRows` row count (a single
 *  global cap, uniform across every DataType). Cut 2nd, only once tier 1 is
 *  fully exhausted: `columnStats[*].exampleValues` length (a single global
 *  cap, uniform across every column). Cut 3rd/last, only once tiers 1 and 2
 *  are both fully exhausted: `joinHints` count (already sorted deterministically
 *  by confidence descending / id tie-break — HEL-374 design.md D2 — truncated
 *  to a shorter prefix).
 *
 *  **Exact decomposition, not a per-candidate full-response reserialization
 *  (design.md D4, closed round-1 design-gate finding)**: `sampleRows`/
 *  `exampleValues`/`joinHints` are each always-present, pairwise-disjoint JSON
 *  subtrees, so the whole response's serialized length equals a FIXED
 *  overhead (every byte outside these three kinds of arrays) plus the sum of
 *  each individually-measured subtree's own serialized length. Every
 *  candidate-cap measurement below therefore serializes only a SMALL,
 *  DataType-count-independent structure (one DataType's own ≤5-row array, one
 *  column's own ≤5-value array, or a short prefix of the ≤50-entry top-level
 *  `joinHints` array) — never the full multi-DataType tree — anchored to the
 *  real serializer for every individual measurement (never a hand-rolled
 *  JSON-length estimate, per the epic's carried finding #5).
 *
 *  **Determinism**: every candidate measurement below serializes a
 *  deterministic, order-preserving `Vector` (never a `Set`/unordered
 *  collection) already built by `assemble`'s own deterministic construction —
 *  trimming array/map CONTENTS never introduces new iteration-order
 *  dependence, so the same response + budget always yields byte-identical
 *  output. */
object WorkspaceContextBudget extends JsonProtocols {

  /** Env-var-overridable default budget (design.md D8), same convention as
   *  `DataSourceService`/`DataSourceRoutes`'s `TEXT_MAX_FILE_SIZE_BYTES`.
   *  `200000` (≈200K UTF-16 code units) is a self-approved tunable (design.md
   *  Planner Notes) — comfortably (≈5x) over a realistic small workspace's
   *  natural size, so `truncation.applied = false` for the common case
   *  (backward-compat acceptance criterion). */
  val DefaultBudgetBytes: Int =
    sys.env.get("WORKSPACE_CONTEXT_DEFAULT_BUDGET_BYTES").flatMap(_.toIntOption).getOrElse(200000)

  /** A discarded placeholder — `assemble` must supply SOME
   *  `WorkspaceContextTruncation` to satisfy `WorkspaceContextResponse`'s
   *  constructor before this pass has run; every field here is overwritten
   *  unconditionally by `apply` below (never read). Kept as a single named
   *  constant, not inlined at the call site, so the "this value is thrown
   *  away" intent is unambiguous wherever it's used. */
  val PlaceholderTruncation: WorkspaceContextTruncation =
    WorkspaceContextTruncation(
      applied = false,
      budgetBytes = 0,
      estimatedSizeBytes = 0,
      sampleRowsCap = 0,
      exampleValuesCap = 0,
      joinHintsKept = 0,
      joinHintsOmittedByBudget = 0,
      structuralFloorExceedsBudget = false,
      paginationTruncatedResources = Vector.empty
    )

  /** D-Pagination (the ticket's carried finding): which of
   *  `dataSources`/`dataTypes`/`dashboards` were truncated by `Page.Default`
   *  (200) — compares each already-fetched page's `items.size` against its
   *  `PagedResult.total` (data `assemble` already has). No new query; `[]`
   *  when none were truncated. `private[services]` so it can be unit-tested
   *  directly without a full budgeting pass (tasks.md 5.2). */
  private[services] def paginationTruncatedResources(
      sourcesPage: PagedResult[_],
      typesPage: PagedResult[_],
      dashboardsPage: PagedResult[_]
  ): Vector[String] =
    Vector(
      "dataSources" -> sourcesPage,
      "dataTypes"   -> typesPage,
      "dashboards"  -> dashboardsPage
    ).collect { case (name, page) if page.items.size < page.total => name }

  /** The CORE response's serialized size — every field of `response` EXCEPT
   *  `truncation` itself (see `WorkspaceContextTruncation`'s doc for why
   *  `truncation`'s own bytes are excluded from this measurement). `response`
   *  may carry any placeholder `truncation` value; it is stripped before
   *  measuring, so its content never affects the result. */
  private def coreSize(response: WorkspaceContextResponse): Int = {
    val full = response.toJson.asJsObject
    JsObject(full.fields - "truncation").compactPrint.length
  }

  private def sampleRowsLenAt(dataTypes: Vector[WorkspaceContextDataType], cap: Int): Int =
    dataTypes.map(dt => JsArray(dt.sampleRows.take(cap)).compactPrint.length).sum

  private def exampleValuesLenAt(dataTypes: Vector[WorkspaceContextDataType], cap: Int): Int =
    dataTypes.flatMap(_.columnStats.values).map(stats => JsArray(stats.exampleValues.take(cap)).compactPrint.length).sum

  private def joinHintsLenAt(response: WorkspaceContextResponse, cap: Int): Int =
    JsArray(response.joinHints.take(cap).map(_.toJson)).compactPrint.length

  private def trimSampleRows(dataTypes: Vector[WorkspaceContextDataType], cap: Int): Vector[WorkspaceContextDataType] =
    dataTypes.map(dt => dt.copy(sampleRows = dt.sampleRows.take(cap)))

  private def trimExampleValues(dataTypes: Vector[WorkspaceContextDataType], cap: Int): Vector[WorkspaceContextDataType] =
    dataTypes.map(dt =>
      dt.copy(columnStats = dt.columnStats.map { case (name, stats) => name -> stats.copy(exampleValues = stats.exampleValues.take(cap)) })
    )

  /** Searches `maxCap downTo 0` for the LARGEST cap whose predicted total
   *  response size fits `budget` (design.md D4 step 2/3/4's "table lookup").
   *  `predictedSize(c) = currentSize - (naturalTierLen - tierLenAtCap(c))` —
   *  an exact arithmetic identity (D4), never re-serializing the full
   *  response per candidate. `None` iff even `c = 0` doesn't fit (the tier is
   *  fully exhausted and still over budget — the caller proceeds to the next
   *  tier). */
  private def findLargestFittingCap(
      maxCap: Int,
      currentSize: Int,
      naturalTierLen: Int,
      tierLenAtCap: Int => Int,
      budget: Int
  ): Option[Int] =
    (maxCap to 0 by -1).find { c =>
      val predicted = currentSize - (naturalTierLen - tierLenAtCap(c))
      predicted <= budget
    }

  /** Applies the D3 tiered shed order to `response`, returning the
   *  (possibly-trimmed) response with its `truncation` field set to the real
   *  outcome. `response.truncation` on entry is discarded unconditionally
   *  (see `PlaceholderTruncation`) — every other field is read.
   *
   *  Pure: no DB access, no `Future`. `sourcesPage`/`typesPage`/
   *  `dashboardsPage` are the SAME `PagedResult`s `assemble` already fetched
   *  — used only for `paginationTruncatedResources`'s size comparison, never
   *  re-queried. */
  def apply(
      response: WorkspaceContextResponse,
      budgetBytes: Int,
      sourcesPage: PagedResult[_],
      typesPage: PagedResult[_],
      dashboardsPage: PagedResult[_]
  ): WorkspaceContextResponse = {
    val paginationTruncated = paginationTruncatedResources(sourcesPage, typesPage, dashboardsPage)

    // Natural (untouched) per-tier caps — derived from the actual data
    // rather than a hardcoded literal, so this stays correct even if
    // WorkspaceContextService's own SampleRowLimit/ExampleValueLimit
    // constants ever change (no duplicated magic number to drift).
    val naturalSampleRowsCap   = response.dataTypes.map(_.sampleRows.size).maxOption.getOrElse(0)
    val naturalExampleValuesCap = response.dataTypes.flatMap(_.columnStats.values.map(_.exampleValues.size)).maxOption.getOrElse(0)
    val naturalJoinHintsCount  = response.joinHints.size

    val naturalSize = coreSize(response)

    def truncationOf(
        applied: Boolean,
        estimatedSizeBytes: Int,
        sampleRowsCap: Int,
        exampleValuesCap: Int,
        joinHintsKept: Int,
        structuralFloorExceedsBudget: Boolean
    ): WorkspaceContextTruncation =
      WorkspaceContextTruncation(
        applied = applied,
        budgetBytes = budgetBytes,
        estimatedSizeBytes = estimatedSizeBytes,
        sampleRowsCap = sampleRowsCap,
        exampleValuesCap = exampleValuesCap,
        joinHintsKept = joinHintsKept,
        joinHintsOmittedByBudget = naturalJoinHintsCount - joinHintsKept,
        structuralFloorExceedsBudget = structuralFloorExceedsBudget,
        paginationTruncatedResources = paginationTruncated
      )

    // Fast path (design.md D4 step 1): one full serialization; if within
    // budget, return unchanged.
    if (naturalSize <= budgetBytes) {
      response.copy(
        truncation = truncationOf(
          applied = false,
          estimatedSizeBytes = naturalSize,
          sampleRowsCap = naturalSampleRowsCap,
          exampleValuesCap = naturalExampleValuesCap,
          joinHintsKept = naturalJoinHintsCount,
          structuralFloorExceedsBudget = false
        )
      )
    } else {
      // ── Tier 1: sampleRows (cut FIRST) ──────────────────────────────────
      val naturalTier1Len = sampleRowsLenAt(response.dataTypes, naturalSampleRowsCap)
      val c1Opt = findLargestFittingCap(naturalSampleRowsCap, naturalSize, naturalTier1Len, sampleRowsLenAt(response.dataTypes, _), budgetBytes)

      c1Opt match {
        case Some(c1) =>
          val estimatedSize = naturalSize - (naturalTier1Len - sampleRowsLenAt(response.dataTypes, c1))
          response.copy(
            dataTypes = trimSampleRows(response.dataTypes, c1),
            truncation = truncationOf(
              applied = true,
              estimatedSizeBytes = estimatedSize,
              sampleRowsCap = c1,
              exampleValuesCap = naturalExampleValuesCap,
              joinHintsKept = naturalJoinHintsCount,
              structuralFloorExceedsBudget = false
            )
          )

        case None =>
          // Tier 1 fully exhausted (sampleRows emptied everywhere) and still
          // over budget — proceed to tier 2.
          val sizeAfterTier1     = naturalSize - (naturalTier1Len - sampleRowsLenAt(response.dataTypes, 0))
          val tier1EmptiedTypes  = trimSampleRows(response.dataTypes, 0)

          // ── Tier 2: columnStats[*].exampleValues (cut 2nd) ──────────────
          val naturalTier2Len = exampleValuesLenAt(tier1EmptiedTypes, naturalExampleValuesCap)
          val c2Opt = findLargestFittingCap(
            naturalExampleValuesCap,
            sizeAfterTier1,
            naturalTier2Len,
            exampleValuesLenAt(tier1EmptiedTypes, _),
            budgetBytes
          )

          c2Opt match {
            case Some(c2) =>
              val estimatedSize = sizeAfterTier1 - (naturalTier2Len - exampleValuesLenAt(tier1EmptiedTypes, c2))
              response.copy(
                dataTypes = trimExampleValues(tier1EmptiedTypes, c2),
                truncation = truncationOf(
                  applied = true,
                  estimatedSizeBytes = estimatedSize,
                  sampleRowsCap = 0,
                  exampleValuesCap = c2,
                  joinHintsKept = naturalJoinHintsCount,
                  structuralFloorExceedsBudget = false
                )
              )

            case None =>
              // Tier 2 fully exhausted (exampleValues emptied everywhere)
              // and still over budget — proceed to tier 3.
              val sizeAfterTier2       = sizeAfterTier1 - (naturalTier2Len - exampleValuesLenAt(tier1EmptiedTypes, 0))
              val tiers12EmptiedTypes  = trimExampleValues(tier1EmptiedTypes, 0)

              // ── Tier 3: joinHints (cut LAST) ─────────────────────────────
              val naturalTier3Len = joinHintsLenAt(response, naturalJoinHintsCount)
              val c3Opt = findLargestFittingCap(
                naturalJoinHintsCount,
                sizeAfterTier2,
                naturalTier3Len,
                joinHintsLenAt(response, _),
                budgetBytes
              )

              c3Opt match {
                case Some(c3) =>
                  val estimatedSize = sizeAfterTier2 - (naturalTier3Len - joinHintsLenAt(response, c3))
                  response.copy(
                    dataTypes  = tiers12EmptiedTypes,
                    joinHints  = response.joinHints.take(c3),
                    truncation = truncationOf(
                      applied = true,
                      estimatedSizeBytes = estimatedSize,
                      sampleRowsCap = 0,
                      exampleValuesCap = 0,
                      joinHintsKept = c3,
                      structuralFloorExceedsBudget = false
                    )
                  )

                case None =>
                  // D5: structural floor — all three tiers exhausted and
                  // STILL over budget. Return as-is at this now-minimal size;
                  // resources are never dropped to chase the budget further.
                  val estimatedSize = sizeAfterTier2 - (naturalTier3Len - joinHintsLenAt(response, 0))
                  response.copy(
                    dataTypes  = tiers12EmptiedTypes,
                    joinHints  = Vector.empty,
                    truncation = truncationOf(
                      applied = true,
                      estimatedSizeBytes = estimatedSize,
                      sampleRowsCap = 0,
                      exampleValuesCap = 0,
                      joinHintsKept = 0,
                      structuralFloorExceedsBudget = true
                    )
                  )
              }
          }
      }
    }
  }
}
