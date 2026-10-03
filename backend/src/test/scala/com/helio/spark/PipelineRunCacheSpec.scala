package com.helio.spark

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class PipelineRunCacheSpec extends AnyWordSpec with Matchers {

  "PipelineRunCache" should {

    "put creates an entry with the given status" in {
      val cache = new PipelineRunCache()
      cache.put("run-1", "pipe-1", RunStatus.Queued)
      val entry = cache.get("run-1")
      entry shouldBe defined
      entry.get.runId  shouldBe "run-1"
      entry.get.pipelineId shouldBe "pipe-1"
      entry.get.status shouldBe RunStatus.Queued
      entry.get.rows   shouldBe None
      entry.get.error  shouldBe None
    }

    "get returns None for an unknown runId" in {
      val cache = new PipelineRunCache()
      cache.get("nonexistent") shouldBe None
    }

    "update replaces status" in {
      val cache = new PipelineRunCache()
      cache.put("run-2", "pipe-1", RunStatus.Queued)
      cache.update("run-2", RunStatus.Running)
      cache.get("run-2").get.status shouldBe RunStatus.Running
      cache.get("run-2").get.rows   shouldBe None
      cache.get("run-2").get.error  shouldBe None
    }

    "update stores rows on success" in {
      val cache = new PipelineRunCache()
      cache.put("run-3", "pipe-1", RunStatus.Queued)
      val rows = Seq(Map[String, Any]("name" -> "Alice", "age" -> 30))
      cache.update("run-3", RunStatus.Succeeded, rows = Some(rows))
      val entry = cache.get("run-3").get
      entry.status  shouldBe RunStatus.Succeeded
      entry.rows    shouldBe defined
      entry.rows.get should have size 1
      entry.rows.get.head("name") shouldBe "Alice"
    }

    "update stores error on failure" in {
      val cache = new PipelineRunCache()
      cache.put("run-4", "pipe-1", RunStatus.Queued)
      cache.update("run-4", RunStatus.Failed, error = Some("something went wrong"))
      val entry = cache.get("run-4").get
      entry.status shouldBe RunStatus.Failed
      entry.error  shouldBe Some("something went wrong")
      entry.rows   shouldBe None
    }

    "update preserves the pipelineId bound at put" in {
      val cache = new PipelineRunCache()
      cache.put("run-5", "pipe-A", RunStatus.Queued)
      cache.update("run-5", RunStatus.Running)
      cache.get("run-5").get.pipelineId shouldBe "pipe-A"
    }

    "update on an unknown runId does not fabricate an unscoped entry" in {
      val cache = new PipelineRunCache()
      cache.update("ghost", RunStatus.Succeeded, rows = Some(Seq(Map("x" -> 1))))
      cache.get("ghost") shouldBe None
    }

    "supports concurrent writes without deadlock" in {
      val cache = new PipelineRunCache()
      val n = 200
      val threads = (1 to n).map { i =>
        new Thread(() => {
          cache.put(s"run-$i", "pipe-1", RunStatus.Queued)
          cache.update(s"run-$i", RunStatus.Succeeded, rows = Some(Seq(Map("i" -> i))))
        })
      }
      threads.foreach(_.start())
      threads.foreach(_.join())
      (1 to n).foreach { i =>
        cache.get(s"run-$i") shouldBe defined
      }
    }
  }
}
