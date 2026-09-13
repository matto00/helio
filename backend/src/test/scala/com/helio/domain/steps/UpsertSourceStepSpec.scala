package com.helio.domain.steps

import com.helio.domain.model.{AuthenticatedUser, DataSource, DataSourceId, PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId, PipelineStepKind, UserId, WriteBackSink}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1100 task 1.1: `UpsertSourceStep` registration + evaluate/config-problem unit coverage.
 *  Pure -- no database. */
class UpsertSourceStepSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  "PipelineStep.Registry" should {
    "include 'upsertsource'" in {
      PipelineStep.Registry.keySet should contain("upsertsource")
      PipelineStepKind.All should contain("upsertsource")
    }
  }

  "PipelineStep.companionFor(\"upsertsource\")" should {
    "round-trip a config through decode/encode" in {
      val companion = PipelineStep.companionFor("upsertsource").toOption.get
      val cfg        = UpsertSourceConfig(UpsertTarget.ExistingSource("ds-1"), "append")
      val raw        = companion.encodeConfig(cfg)
      companion.decodeConfig(raw) shouldBe cfg
    }

    "reject a config with an unrecognised mode via validateRawConfig" in {
      val companion = PipelineStep.companionFor("upsertsource").toOption.get
      val raw = """{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode":"upsert"}"""
      companion.validateRawConfig(raw) shouldBe defined
    }

    "report a required-config problem for a blank ExistingSource target" in {
      val companion = PipelineStep.companionFor("upsertsource").toOption.get
      val raw = """{"target":{"kind":"existingSource","dataSourceId":""},"mode":"append"}"""
      companion.requiredConfigProblems(raw) should not be empty
    }

    "report a required-config problem for a blank NewSource name" in {
      val companion = PipelineStep.companionFor("upsertsource").toOption.get
      val raw = """{"target":{"kind":"newSource","name":""},"mode":"append"}"""
      companion.requiredConfigProblems(raw) should not be empty
    }

    "report no required-config problem for a real ExistingSource target" in {
      val companion = PipelineStep.companionFor("upsertsource").toOption.get
      val raw = """{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode":"append"}"""
      companion.requiredConfigProblems(raw) shouldBe empty
    }
  }

  "UpsertSourceStep.evaluate" should {
    "record a PendingWrite into ctx.writeBackSink and return the input rows unchanged" in {
      val config = UpsertSourceConfig(UpsertTarget.ExistingSource("ds-1"), "append")
      val step = UpsertSourceStep(
        PipelineStepId("step-1"), PipelineId("pipe-1"), position = 0,
        config = config, createdAt = Instant.now(), updatedAt = Instant.now()
      )
      val rows: Seq[Map[String, Any]] = Seq(Map("a" -> 1L), Map("a" -> 2L))
      val sink = new WriteBackSink
      val ctx = PipelineExecutionContext(
        dataSourceRepo = null.asInstanceOf[DataSourceRepository],
        loadSource     = (_: DataSource) => Future.successful(Seq.empty),
        writeBackSink  = sink
      )

      val result = await(step.evaluate(rows, ctx))

      result shouldBe rows
      sink.writes should have size 1
      sink.writes.head.stepId shouldBe "step-1"
      sink.writes.head.config shouldBe config
      sink.writes.head.rows shouldBe rows
    }
  }
}
