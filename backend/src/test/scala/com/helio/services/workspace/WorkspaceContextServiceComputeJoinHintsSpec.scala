package com.helio.services.workspace

import com.helio.services.workspace.WorkspaceContextService
import com.helio.api.protocols.workspace.{WorkspaceContextColumn, WorkspaceContextColumnStats, WorkspaceContextOutput}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-374 tasks.md 5.2 — pure unit tests for
 *  `WorkspaceContextService.computeJoinHints` (design.md D2), mirroring
 *  `WorkspaceContextServiceComputeColumnStatsSpec`'s no-DB-fixture pattern.
 *  `computeJoinHints` is a pure function of `Vector[WorkspaceContextOutput]`
 *  and touches none of the service's four constructor dependencies — every
 *  fixture below is constructed directly, not fetched (carried finding #7:
 *  prefer pure-unit specs for constructed edge cases over DB-backed specs).
 *
 *  Owner-scoping (design.md D3) is NOT re-tested here with a DB fixture:
 *  `computeJoinHints` never touches the database, and `assemble` (tested via
 *  `WorkspaceContextServiceSpec`'s DB-backed owner-scoping cases) never holds
 *  more than one caller's `dataTypes` in scope for a single call — see design.md
 *  D3 for the full call-graph trace this rests on. */
class WorkspaceContextServiceComputeJoinHintsSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val service = new WorkspaceContextService(null, null, null, null)

  private def identifierColumn(
      name: String,
      declaredType: String,
      distinctCount: Int,
      exampleValues: Vector[JsValue],
      distinctCountCapped: Boolean = false
  ): (WorkspaceContextColumn, WorkspaceContextColumnStats) = {
    val column = WorkspaceContextColumn(name = name, dataType = declaredType, nullable = false, semanticRole = "identifier")
    val stats = WorkspaceContextColumnStats(
      nullRate            = 0.0,
      distinctCount        = distinctCount,
      distinctCountCapped  = distinctCountCapped,
      exampleValues        = exampleValues,
      min                  = None,
      max                  = None,
      mean                 = None
    )
    (column, stats)
  }

  private def nonIdentifierColumn(name: String, declaredType: String, semanticRole: String): (WorkspaceContextColumn, WorkspaceContextColumnStats) = {
    val column = WorkspaceContextColumn(name = name, dataType = declaredType, nullable = false, semanticRole = semanticRole)
    val stats = WorkspaceContextColumnStats(
      nullRate            = 0.0,
      distinctCount        = 20,
      distinctCountCapped  = false,
      exampleValues        = Vector(JsString("x")),
      min                  = None,
      max                  = None,
      mean                 = None
    )
    (column, stats)
  }

  /** Builds a `WorkspaceContextOutput` from (column, stats) pairs.
   *  `columnStatsLimit` simulates `computeColumnStats`'s own `SampleColumnLimit`
   *  (40) cap — only the first `columnStatsLimit` columns get a `columnStats`
   *  entry, mirroring the real shape a wide DataType produces, without
   *  depending on the DB-backed integration path. */
  private def dataTypeEntry(
      id: String,
      columns: Vector[(WorkspaceContextColumn, WorkspaceContextColumnStats)],
      columnStatsLimit: Int = Int.MaxValue,
      sourceId: Option[String] = None
  ): WorkspaceContextOutput =
    WorkspaceContextOutput(
      id              = id,
      name            = id,
      sourceId        = sourceId,
      pipelineOutput  = sourceId.isEmpty,
      columns         = columns.map(_._1),
      computedColumns = Vector.empty,
      version         = 1,
      tag             = None,
      sampleRows      = Vector.empty,
      columnStats     = columns.take(columnStatsLimit).map { case (c, s) => c.name -> s }.toMap
    )


  "computeJoinHints" should {
    "produce a hint with confidence > 0.5 for a matching identifier column pair with partial overlap" in {
      val a = dataTypeEntry("dt-a", Vector(identifierColumn("customer_id", "integer", distinctCount = 20,
        exampleValues = Vector(JsNumber(1), JsNumber(2), JsNumber(3)))))
      val b = dataTypeEntry("dt-b", Vector(identifierColumn("customer_id", "integer", distinctCount = 20,
        exampleValues = Vector(JsNumber(2), JsNumber(3), JsNumber(4)))))

      val hints = service.computeJoinHints(Vector(a, b))

      hints should have size 1
      hints.head.leftColumn shouldBe "customer_id"
      hints.head.rightColumn shouldBe "customer_id"
      hints.head.confidence should be > 0.5
    }

    "produce no hint for a matching non-identifier column pair (measure), even with identical values" in {
      val a = dataTypeEntry("dt-a", Vector(nonIdentifierColumn("amount", "float", "measure")))
      val b = dataTypeEntry("dt-b", Vector(nonIdentifierColumn("amount", "float", "measure")))

      service.computeJoinHints(Vector(a, b)) shouldBe empty
    }

    "never pair a column against itself within the same DataType" in {
      val a = dataTypeEntry("dt-a", Vector(
        identifierColumn("customer_id", "integer", distinctCount = 20, exampleValues = Vector(JsNumber(1))),
        identifierColumn("customer_id2", "integer", distinctCount = 20, exampleValues = Vector(JsNumber(1)))
      ))

      service.computeJoinHints(Vector(a)) shouldBe empty
    }

    "only compare columns whose declared-type buckets match (skip a string id vs. an integer id)" in {
      val a = dataTypeEntry("dt-a", Vector(identifierColumn("order_id", "string", distinctCount = 20, exampleValues = Vector(JsString("1")))))
      val b = dataTypeEntry("dt-b", Vector(identifierColumn("order_id", "integer", distinctCount = 20, exampleValues = Vector(JsNumber(1)))))

      service.computeJoinHints(Vector(a, b)) shouldBe empty
    }
  }


  "computeJoinHints (empty-vs-empty example values)" should {
    "yield confidence exactly 0.5, not a fabricated NaN, for two all-null identifier columns" in {
      val a = dataTypeEntry("dt-a", Vector(identifierColumn("user_id", "integer", distinctCount = 0, exampleValues = Vector.empty)))
      val b = dataTypeEntry("dt-b", Vector(identifierColumn("user_id", "integer", distinctCount = 0, exampleValues = Vector.empty)))

      val hints = service.computeJoinHints(Vector(a, b))

      hints should have size 1
      hints.head.confidence shouldBe 0.5
      hints.head.confidence.isNaN shouldBe false
    }
  }

  // ── confidence damping (post-design-gate human-review fix, design.md D2's
  //    evidenceWeight — REQUIRED per the ticket's addendum) ────────────────

  "computeJoinHints (confidence damping by cardinality evidence)" should {
    "NOT let two unrelated low-cardinality identifier columns sharing an identical small example-value " +
      "set read as near-certain" in {
      val sharedValues = Vector(JsString("1"), JsString("2"), JsString("3"), JsString("4"), JsString("5"))
      val a = dataTypeEntry("dt-low-a", Vector(identifierColumn("id", "string", distinctCount = 5, exampleValues = sharedValues)))
      val b = dataTypeEntry("dt-low-b", Vector(identifierColumn("id", "string", distinctCount = 5, exampleValues = sharedValues)))

      val hints = service.computeJoinHints(Vector(a, b))

      hints should have size 1
      hints.head.confidence should be <= 0.65
    }

    "allow a well-evidenced (distinctCount >= MinDistinctForFullConfidence) full-overlap pair to reach " +
      "a high confidence — proving the damping targets low cardinality specifically, not overlap itself" in {
      val sharedValues = Vector(JsString("1"), JsString("2"), JsString("3"), JsString("4"), JsString("5"))
      val a = dataTypeEntry("dt-high-a", Vector(identifierColumn("id", "string", distinctCount = 20, exampleValues = sharedValues)))
      val b = dataTypeEntry("dt-high-b", Vector(identifierColumn("id", "string", distinctCount = 20, exampleValues = sharedValues)))

      val hints = service.computeJoinHints(Vector(a, b))

      hints should have size 1
      hints.head.confidence shouldBe 1.0
    }
  }

  // ── design-gate round-1 finding: candidate gathering MUST be bounded via
  //    columnStats membership, not the unbounded columns list alone ────────

  "computeJoinHints (candidate-gathering bound, design-gate round-1 fix)" should {
    "draw at most SampleColumnLimit (40) identifier candidates from a DataType declaring more than that, " +
      "via the columnStats-membership restriction" in {
      val wideColumns = (0 until 45).map(i =>
        identifierColumn(s"id$i", "string", distinctCount = 20, exampleValues = Vector(JsString("x")))
      ).toVector
      val wide = dataTypeEntry("wide-dt", wideColumns, columnStatsLimit = 40)

      // Matches the 41st declared column (0-indexed 40) — present in `wide`'s
      // declared columns but excluded from its columnStats by the 40-cap, so
      // it must NOT produce a hint.
      val overflowMatch = dataTypeEntry("overflow-dt", Vector(identifierColumn("id40", "string", distinctCount = 20, exampleValues = Vector(JsString("x")))))

      // Matches a column WITHIN the retained first 40 — must still produce a hint.
      val withinCapMatch = dataTypeEntry("within-cap-dt", Vector(identifierColumn("id0", "string", distinctCount = 20, exampleValues = Vector(JsString("x")))))

      val hints = service.computeJoinHints(Vector(wide, overflowMatch, withinCapMatch))

      hints.exists(h => h.leftColumn == "id40" || h.rightColumn == "id40") shouldBe false
      hints.exists(h => h.leftColumn == "id0" || h.rightColumn == "id0") shouldBe true
    }

    "contribute zero candidates for a DataType whose columnStats is empty (source-companion case), " +
      "even though its columns array lists an identifier-role column" in {
      val companion = dataTypeEntry(
        "companion-dt",
        Vector(identifierColumn("customer_id", "integer", distinctCount = 20, exampleValues = Vector(JsNumber(1)))),
        columnStatsLimit = 0,
        sourceId         = Some("src-1")
      )
      val other = dataTypeEntry("other-dt", Vector(identifierColumn("customer_id", "integer", distinctCount = 20, exampleValues = Vector(JsNumber(1)))))

      service.computeJoinHints(Vector(companion, other)) shouldBe empty
    }
  }


  "computeJoinHints (bounded comparison work)" should {
    "cap a single name-bucket at MaxColumnsPerNameBucket (50) BEFORE pairwise comparison, so a " +
      "higher-confidence candidate past the cap never enters the comparison set" in {
      // 50 DataTypes with mutually non-overlapping identifier values (jaccard 0 pairwise -> confidence
      // floors at 0.5 for every pair among them).
      val lowConfidenceTypes = (0 until 50).map { i =>
        val id = f"dt-$i%02d"
        dataTypeEntry(id, Vector(identifierColumn("id", "string", distinctCount = 20, exampleValues = Vector(JsString(s"v$i")))))
      }
      // 5 more DataTypes, lexicographically AFTER all 50 above (stable-sort key is (dataTypeId, column)),
      // sharing an IDENTICAL example value with each other. If the per-bucket cap did not apply, these
      // would produce confidence-1.0 hints that would displace the 0.5-confidence ones in the final
      // sorted+truncated output.
      val highConfidenceTypesPastCap = (50 until 55).map { i =>
        val id = f"dt-$i%02d"
        dataTypeEntry(id, Vector(identifierColumn("id", "string", distinctCount = 20, exampleValues = Vector(JsString("shared")))))
      }

      val hints = service.computeJoinHints((lowConfidenceTypes ++ highConfidenceTypesPastCap).toVector)

      hints.foreach { h =>
        (h.leftDataTypeId < "dt-50") shouldBe true
        (h.rightDataTypeId < "dt-50") shouldBe true
      }
    }

    "truncate total output to MaxJoinHints (50) even when more qualifying pairs exist across many buckets" in {
      val types = (0 until 60).flatMap { i =>
        val name = s"key$i"
        Vector(
          dataTypeEntry(f"dt-$i%02d-a", Vector(identifierColumn(name, "string", distinctCount = 20, exampleValues = Vector(JsString("x"))))),
          dataTypeEntry(f"dt-$i%02d-b", Vector(identifierColumn(name, "string", distinctCount = 20, exampleValues = Vector(JsString("x")))))
        )
      }.toVector

      val hints = service.computeJoinHints(types)

      hints should have size 50
    }
  }


  "computeJoinHints (canonical left/right assignment)" should {
    "always assign the lexicographically smaller dataTypeId as left, regardless of input order" in {
      val a = dataTypeEntry("dt-z", Vector(identifierColumn("order_id", "integer", distinctCount = 20, exampleValues = Vector(JsNumber(1)))))
      val b = dataTypeEntry("dt-a", Vector(identifierColumn("order_id", "integer", distinctCount = 20, exampleValues = Vector(JsNumber(1)))))

      val hints = service.computeJoinHints(Vector(a, b))

      hints should have size 1
      hints.head.leftDataTypeId shouldBe "dt-a"
      hints.head.rightDataTypeId shouldBe "dt-z"
    }
  }
}
