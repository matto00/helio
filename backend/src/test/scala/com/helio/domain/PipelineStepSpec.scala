package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** ADT-shape tests for the CS2c-3a PipelineStep sealed trait. Per-step
 *  behavior is exercised by [[InProcessPipelineEngineSpec]]; this spec
 *  focuses on the shape itself: `kind` correctness, the sealed-trait /
 *  `PipelineStepKind.All` parity, and pattern-match exhaustiveness. */
class PipelineStepSpec extends AnyWordSpec with Matchers {

  private val id    = PipelineStepId("step-1")
  private val pid   = PipelineId("pipe-1")
  private val now   = Instant.now()

  private val rename    = RenameStep(id, pid, 0, RenameConfig(Map.empty), now, now)
  private val filter    = FilterStep(id, pid, 0, FilterConfig("AND", Vector.empty), now, now)
  private val join      = JoinStep(id, pid, 0, JoinConfig("ds-1", "k", "inner"), now, now)
  private val compute   = ComputeStep(id, pid, 0, ComputeConfig("c", "1+1", None), now, now)
  private val groupBy   = GroupByStep(id, pid, 0, GroupByConfig(Vector("g"), "x", "sum"), now, now)
  private val cast      = CastStep(id, pid, 0, CastConfig(Map.empty), now, now)
  private val select    = SelectStep(id, pid, 0, SelectConfig(Vector.empty), now, now)
  private val limit     = LimitStep(id, pid, 0, LimitConfig(10), now, now)
  private val sort      = SortStep(id, pid, 0, SortConfig(Vector.empty), now, now)
  private val aggregate = AggregateStep(id, pid, 0, AggregateConfig(Vector.empty, Vector.empty), now, now)
  private val splitText = SplitTextStep(id, pid, 0, SplitTextConfig("content", "paragraph"), now, now)
  private val extractHeadings = ExtractHeadingsStep(id, pid, 0, ExtractHeadingsConfig("content"), now, now)

  private val allSubtypes: Seq[PipelineStep] =
    Seq(rename, filter, join, compute, groupBy, cast, select, limit, sort, aggregate, splitText, extractHeadings)

  "PipelineStepKind" should {
    "define a constant for every subtype" in {
      PipelineStepKind.All shouldBe Set(
        "rename", "filter", "join", "compute", "groupby",
        "cast", "select", "limit", "sort", "aggregate", "splittext", "extractheadings"
      )
    }

    "parseKind accepts every known kind" in {
      PipelineStepKind.All.foreach { k =>
        PipelineStepKind.parseKind(k) shouldBe Right(k)
      }
    }

    "parseKind rejects unknown kinds with a descriptive message" in {
      PipelineStepKind.parseKind("bogus") match {
        case Left(msg) => msg should include ("Unknown step op")
        case Right(_)  => fail("expected Left")
      }
    }
  }

  "PipelineStep subtypes" should {
    "expose the correct kind string for each subtype" in {
      rename.kind    shouldBe PipelineStepKind.Rename
      filter.kind    shouldBe PipelineStepKind.Filter
      join.kind      shouldBe PipelineStepKind.Join
      compute.kind   shouldBe PipelineStepKind.Compute
      groupBy.kind   shouldBe PipelineStepKind.GroupBy
      cast.kind      shouldBe PipelineStepKind.Cast
      select.kind    shouldBe PipelineStepKind.Select
      limit.kind     shouldBe PipelineStepKind.Limit
      sort.kind      shouldBe PipelineStepKind.Sort
      aggregate.kind shouldBe PipelineStepKind.Aggregate
      splitText.kind shouldBe PipelineStepKind.SplitText
      extractHeadings.kind shouldBe PipelineStepKind.ExtractHeadings
    }

    "every subtype carries the common base fields" in {
      allSubtypes.foreach { s =>
        s.id          shouldBe id
        s.pipelineId  shouldBe pid
        s.position    shouldBe 0
        s.createdAt   shouldBe now
        s.updatedAt   shouldBe now
      }
    }

    "every subtype's kind matches PipelineStepKind.All" in {
      val kinds = allSubtypes.map(_.kind).toSet
      kinds shouldBe PipelineStepKind.All
    }

    "pattern-match coverage — sealed-trait dispatch is exhaustive" in {
      // The body itself is the test — adding an 11th subtype without
      // updating this match fails compilation (sealed-trait exhaustiveness).
      allSubtypes.foreach { s =>
        val tag: String = s match {
          case _: RenameStep    => PipelineStepKind.Rename
          case _: FilterStep    => PipelineStepKind.Filter
          case _: JoinStep      => PipelineStepKind.Join
          case _: ComputeStep   => PipelineStepKind.Compute
          case _: GroupByStep   => PipelineStepKind.GroupBy
          case _: CastStep      => PipelineStepKind.Cast
          case _: SelectStep    => PipelineStepKind.Select
          case _: LimitStep     => PipelineStepKind.Limit
          case _: SortStep      => PipelineStepKind.Sort
          case _: AggregateStep => PipelineStepKind.Aggregate
          case _: SplitTextStep => PipelineStepKind.SplitText
          case _: ExtractHeadingsStep => PipelineStepKind.ExtractHeadings
        }
        tag shouldBe s.kind
      }
    }
  }
}
