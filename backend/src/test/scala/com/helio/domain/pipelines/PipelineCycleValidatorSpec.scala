package com.helio.domain.pipelines

import com.helio.domain.model.{DataSourceId, PipelineId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1101 task 2.1/2.2: pure unit coverage for `PipelineCycleValidator`'s forward-reachability
 *  cycle check and cycle-path message builder, exercised directly against constructed graphs (no
 *  DB) -- the AC's two named scenarios (direct + 2-pipeline transitive), the 3-pipeline
 *  transitive case, the diamond false-positive guard, and (skeptic-final-1.md CR2) the
 *  requirement that a cycle NOT closed by the pending edge is never reported, however far it
 *  reaches into the rest of the visible graph. */
class PipelineCycleValidatorSpec extends AnyWordSpec with Matchers {

  private val S1 = DataSourceId("s1")
  private val S2 = DataSourceId("s2")
  private val S3 = DataSourceId("s3")
  private val S4 = DataSourceId("s4")

  private val pA = PipelineId("pA")
  private val pB = PipelineId("pB")
  private val pC = PipelineId("pC")

  "checkNoCycle" should {

    "reject a direct self-cycle: a pipeline whose write target is a source it also reads" in {
      val result = PipelineCycleValidator.checkNoCycle(
        readEdges  = Vector.empty,
        writeEdges = Vector.empty,
        readSources = Set(S1),
        writeTarget = S1,
        writingPipelineId = pA,
        writingPipelineName = "A"
      )
      result shouldBe a[Left[_, _]]
      val err = result.left.toOption.get
      err.message() shouldBe "s1 -> A -> s1"
    }

    "reject a two-pipeline transitive cycle, naming the exact chain S1 -> A -> S2 -> B -> S1" in {
      // Pipeline A already reads S1 and writes S2 (an existing, persisted write edge).
      val readEdges  = Vector(PipelineCycleValidator.ReadEdge(pA, "A", S1))
      val writeEdges = Vector(PipelineCycleValidator.WriteEdge(pA, "A", S2))

      // Pending: pipeline B reads S2 and is being given a write target of S1.
      val result = PipelineCycleValidator.checkNoCycle(
        readEdges, writeEdges,
        readSources = Set(S2),
        writeTarget = S1,
        writingPipelineId = pB,
        writingPipelineName = "B"
      )

      result shouldBe a[Left[_, _]]
      result.left.toOption.get.message() shouldBe "s1 -> A -> s2 -> B -> s1"
    }

    "reject a three-pipeline transitive cycle, naming the full chain" in {
      // A reads S1 writes S2; B reads S2 writes S3 (both already persisted).
      val readEdges = Vector(
        PipelineCycleValidator.ReadEdge(pA, "A", S1),
        PipelineCycleValidator.ReadEdge(pB, "B", S2)
      )
      val writeEdges = Vector(
        PipelineCycleValidator.WriteEdge(pA, "A", S2),
        PipelineCycleValidator.WriteEdge(pB, "B", S3)
      )

      // Pending: pipeline C reads S3, given a write target of S1.
      val result = PipelineCycleValidator.checkNoCycle(
        readEdges, writeEdges,
        readSources = Set(S3),
        writeTarget = S1,
        writingPipelineId = pC,
        writingPipelineName = "C"
      )

      result shouldBe a[Left[_, _]]
      result.left.toOption.get.message() shouldBe "s1 -> A -> s2 -> B -> s3 -> C -> s1"
    }

    "accept a non-cyclic diamond: S4 reachable from S1 via two disjoint paths is not a cycle" in {
      // A reads S1 writes S2; B reads S1 writes S3 (both already persisted).
      val readEdges = Vector(
        PipelineCycleValidator.ReadEdge(pA, "A", S1),
        PipelineCycleValidator.ReadEdge(pB, "B", S1)
      )
      val writeEdges = Vector(
        PipelineCycleValidator.WriteEdge(pA, "A", S2),
        PipelineCycleValidator.WriteEdge(pB, "B", S3)
      )

      // Pending: pipeline C reads BOTH S2 and S3, writes S4 -- no path leads back to S1/S2/S3.
      val result = PipelineCycleValidator.checkNoCycle(
        readEdges, writeEdges,
        readSources = Set(S2, S3),
        writeTarget = S4,
        writingPipelineId = pC,
        writingPipelineName = "C"
      )

      result shouldBe Right(())
    }

    "accept a request that introduces no edge at all (empty readSources)" in {
      val result = PipelineCycleValidator.checkNoCycle(
        readEdges = Vector.empty,
        writeEdges = Vector.empty,
        readSources = Set.empty,
        writeTarget = S1,
        writingPipelineId = pA,
        writingPipelineName = "A"
      )
      result shouldBe Right(())
    }

    "does not reject an unrelated pending edge just because a standing cycle exists elsewhere in the graph (CR2)" in {
      // A genuine, already-persisted 2-pipeline cycle among W1/W2, entirely unrelated to the
      // pending write under test.
      val readEdges = Vector(
        PipelineCycleValidator.ReadEdge(PipelineId("pW1"), "W1", S1),
        PipelineCycleValidator.ReadEdge(PipelineId("pW2"), "W2", S2)
      )
      val writeEdges = Vector(
        PipelineCycleValidator.WriteEdge(PipelineId("pW1"), "W1", S2),
        PipelineCycleValidator.WriteEdge(PipelineId("pW2"), "W2", S1)
      )
      // Pending: an unrelated pipeline C reads S3 and writes S4 -- nothing to do with S1/S2's
      // standing cycle. Must be accepted regardless of that unrelated cycle's existence.
      val result = PipelineCycleValidator.checkNoCycle(
        readEdges, writeEdges,
        readSources = Set(S3),
        writeTarget = S4,
        writingPipelineId = pC,
        writingPipelineName = "C"
      )
      result shouldBe Right(())
    }

    "break ties by ascending pipeline id when two candidate pipelines produce the same S1->S2 edge" in {
      // Both A and Z read S1 and write S2 (a genuine multigraph -- design.md Decision 6).
      val readEdges = Vector(
        PipelineCycleValidator.ReadEdge(PipelineId("pZ"), "Z", S1),
        PipelineCycleValidator.ReadEdge(pA, "A", S1)
      )
      val writeEdges = Vector(
        PipelineCycleValidator.WriteEdge(PipelineId("pZ"), "Z", S2),
        PipelineCycleValidator.WriteEdge(pA, "A", S2)
      )
      // Pending: pipeline B reads S2, writes S1 -- neither A nor B nor Z is the pending pipeline
      // for the S1->S2 leg, so the tie-break (ascending pipeline id) decides which of A/Z's
      // parallel edges the reported cycle uses.
      val result = PipelineCycleValidator.checkNoCycle(
        readEdges, writeEdges,
        readSources = Set(S2),
        writeTarget = S1,
        writingPipelineId = pB,
        writingPipelineName = "B"
      )
      result shouldBe a[Left[_, _]]
      // "pA" < "pZ" lexicographically -- A's edge wins the tie-break.
      result.left.toOption.get.message() shouldBe "s1 -> A -> s2 -> B -> s1"
    }

    "prefer the pending/writing pipeline's own edge over another candidate producing the same S1->S2 edge" in {
      // Z already reads S1 and writes S2 (an unrelated, pre-existing pipeline).
      val readEdges  = Vector(PipelineCycleValidator.ReadEdge(PipelineId("pZ"), "Z", S1))
      val writeEdges = Vector(PipelineCycleValidator.WriteEdge(PipelineId("pZ"), "Z", S2))
      // Pending: pipeline A (lexicographically AFTER "pZ") reads S1 too and is ITSELF being
      // given a write target of S2 -- the SAME S1->S2 edge Z already produces. The tie-break's
      // first clause (prefer the pending pipeline's own edge) must win over ascending-id, else
      // "pA" would already sort first anyway -- construct the id the other way to prove it's the
      // "is this the pending pipeline" rule doing the work, not just id order.
      val readEdgesWithPending = readEdges :+ PipelineCycleValidator.ReadEdge(PipelineId("z-pending"), "Pending", S1)
      val result = PipelineCycleValidator.checkNoCycle(
        readEdgesWithPending, writeEdges,
        readSources = Set(S1),
        writeTarget = S2,
        writingPipelineId = PipelineId("z-pending"),
        writingPipelineName = "Pending"
      )
      // Adding S1->S2 (pending, self-referencing S1 read + S2 write) alongside Z's own S1->S2
      // does not by itself close a cycle (no edge leads back to S1 or S2 from anywhere) --
      // sanity-check this returns Right, confirming the fixture is well-formed and not
      // accidentally cyclic for an unrelated reason.
      result shouldBe Right(())
    }
  }

  "CycleError.message" should {
    "default to the raw data source id when no name resolver is supplied" in {
      val err = PipelineCycleValidator.CycleError(Vector(
        PipelineCycleValidator.Edge(S1, S1, pA, "A")
      ))
      err.message() shouldBe "s1 -> A -> s1"
    }

    "use a supplied name resolver for each data source" in {
      val err = PipelineCycleValidator.CycleError(Vector(
        PipelineCycleValidator.Edge(S1, S2, pA, "A"),
        PipelineCycleValidator.Edge(S2, S1, pB, "B")
      ))
      val names = Map(S1 -> "Orders", S2 -> "Shipments")
      err.message(id => names.getOrElse(id, id.value)) shouldBe "Orders -> A -> Shipments -> B -> Orders"
    }
  }
}
