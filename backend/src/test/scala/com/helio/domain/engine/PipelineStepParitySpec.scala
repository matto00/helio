package com.helio.domain.engine

import com.helio.domain.model.PipelineStep
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.JsNull

import java.nio.file.Files
import scala.collection.mutable

import ParityCorpus.Row

/** HEL-1581: the Scala half of the client-evaluator parity corpus (`shared-test-fixtures/pipeline-step-parity/`).
 *
 *  Every vector runs through `InProcessPipelineEngine.executeTree`, the engine's own run path, and the expectation
 *  stored in the file must equal what the engine produced; the Jest runner (`pipelineStepParity.test.ts`) holds the
 *  TypeScript evaluator to the same file. Expectations are never hand-written: a vector without one is filled in from
 *  this spec's run with `PARITY_REGEN=1` (it only ever fills a missing expectation, never overwrites one).
 *
 *  Checks here: (1) the manifest classifies exactly `PipelineStep.Registry.keySet`; (2) the test-local step builder
 *  has an arm for every registered kind; (3) every step vector; (4) every walk vector, including the re-runs without
 *  a failing, violating or AI step; (5) the client block of a walk vector only claims rows the engine produced. */
class PipelineStepParitySpec extends AnyWordSpec with Matchers {

  private val regen = sys.env.get("PARITY_REGEN").contains("1")

  private val manifest = ParityCorpus.read("manifest.json").asInstanceOf[OJ.Obj]
  private val kinds: Map[String, OJ.Obj] =
    manifest("kinds").asInstanceOf[OJ.Obj].fields.map { case (k, v) => k -> v.asInstanceOf[OJ.Obj] }.toMap

  private def string(v: OJ): String = v match { case OJ.Str(s) => s; case other => fail(s"expected a string, got $other") }
  private def obj(v: OJ): OJ.Obj    = v match { case o: OJ.Obj => o; case other => fail(s"expected an object, got $other") }
  private def arr(v: OJ): Vector[OJ] = v match { case OJ.Arr(i) => i; case other => fail(s"expected an array, got $other") }

  // Regenerated files are collected here and written by the last test.
  private val regenerated = mutable.LinkedHashMap.empty[String, OJ]

  private def nonServer = kinds.filter(_._2("class") != OJ.Str("server")).keys.toVector.sorted

  "the parity manifest" should {
    "classify exactly the kinds PipelineStep.Registry registers (check 1)" in {
      kinds.keySet shouldBe PipelineStep.Registry.keySet
    }

    "use only known classes, with a vector file for every non-server kind and none for a server kind" in {
      kinds.values.map(k => string(k("class"))).toSet should contain only ("client", "client*", "identity", "server")
      nonServer.foreach(k => withClue(k)(Files.exists(ParityCorpus.Dir.resolve(s"$k.json")) shouldBe true))
      kinds.filter(_._2("class") == OJ.Str("server")).keys.foreach(k => Files.exists(ParityCorpus.Dir.resolve(s"$k.json")) shouldBe false)
    }

    "be matched by an arm in the test-local step builder for every registered kind" in {
      PipelineStep.Registry.keys.foreach { k =>
        withClue(k)(ParityStepBuilder.build(k, "probe", 0, None, enabled = true, "{}").kind shouldBe k)
      }
    }
  }

  "the engine's JSON output rules the corpus relies on" should {
    "turn a non-finite double into null and keep integrals as numbers" in {
      PipelineRowJson.anyToJsValue(Double.NaN) shouldBe JsNull
      PipelineRowJson.anyToJsValue(Double.PositiveInfinity) shouldBe JsNull
      PipelineRowJson.anyToJsValue(3).toString shouldBe "3"
      PipelineRowJson.anyToJsValue(3L).toString shouldBe "3"
    }
  }

  // ── step vectors ──────────────────────────────────────────────────────────────────────────────────────────────

  private def stepOutcome(kind: String, vec: OJ.Obj): Either[String, Seq[Row]] =
    ParityRunner.runStepVector(kind, vec) match {
      case ParityOutcome.Frames(by)             => Right(by("under-test"))
      case ParityOutcome.StepFailed("under-test") => Left("step failed")
      case ParityOutcome.ConfigUndecodable(_, why) => Left(s"config undecodable: $why")
      case other                                 => fail(s"unexpected outcome $other")
    }

  private def checkStepVector(kind: String, vec: OJ.Obj): OJ.Obj = {
    val actual = stepOutcome(kind, vec)
    def rowsOf(r: Either[String, Seq[Row]]): (String, OJ) = r match {
      case Right(rows) => "rows" -> ParityCorpus.encodeRows(rows)
      case Left(_)     => "error" -> OJ.Bool(true)
    }
    def assertRows(expected: OJ): Unit = actual match {
      case Right(rows) => ParityCorpus.diff(rows, ParityCorpus.decodeRows(expected)) shouldBe None
      case Left(why)   => fail(s"expected rows but the engine run failed ($why)")
    }
    def assertError(): Unit = actual.isLeft shouldBe true
    vec.get("expect") match {
      case None =>
        if (!regen) fail("no expectation: fill it from the oracle with PARITY_REGEN=1")
        val (key, value) = rowsOf(actual)
        vec.updated("expect", OJ.Obj(Vector(key -> value)))
      case Some(e: OJ.Obj) if e.contains("rows") =>
        assertRows(e("rows")); vec
      case Some(e: OJ.Obj) if e.contains("error") =>
        assertError(); vec
      case Some(e: OJ.Obj) if e.contains("clientDeclines") =>
        (e.get("scalaRows"), e.get("scalaError")) match {
          case (Some(rows), _)  => assertRows(rows); vec
          case (_, Some(_))     => assertError(); vec
          case _ =>
            if (!regen) fail("a clientDeclines vector needs scalaRows or scalaError: fill it with PARITY_REGEN=1")
            val (key, value) = rowsOf(actual)
            vec.updated("expect", e.updated(if (key == "rows") "scalaRows" else "scalaError", value))
        }
      case Some(other) => fail(s"unrecognised expect: $other")
    }
  }

  nonServer.foreach { kind =>
    val file     = ParityCorpus.read(s"$kind.json").asInstanceOf[OJ.Obj]
    val vectors  = arr(file("vectors")).map(obj)
    val updated  = mutable.ArrayBuffer.empty[OJ.Obj]
    s"the $kind step vectors" should {
      "carry at least the manifest's minimum number of vectors" in {
        vectors.size should be >= (kinds(kind)("minVectors") match { case OJ.Num(n) => n.toInt; case other => fail(s"minVectors: $other") })
      }
      vectors.foreach { vec =>
        s"match the engine: ${string(vec("name"))}" in {
          updated += checkStepVector(kind, vec)
        }
      }
      "flush any regenerated expectations" in {
        if (regen && updated.size == vectors.size && updated != vectors) regenerated(s"$kind.json") = file.updated("vectors", OJ.Arr(updated.toVector))
      }
    }
  }

  // ── walk vectors ──────────────────────────────────────────────────────────────────────────────────────────────

  private def frameMap(rootFramesJson: OJ): Vector[(String, Seq[Row])] =
    arr(rootFramesJson).map(f => string(obj(f)("rootId")) -> ParityCorpus.decodeRows(obj(f)("rows")))

  private def framesOf(by: Map[String, Seq[Row]], order: Vector[String]): OJ =
    OJ.Obj(order.filter(by.contains).map(id => id -> ParityCorpus.encodeRows(by(id))))

  private def assertFrames(actual: Map[String, Seq[Row]], expected: OJ): Unit = {
    val exp = obj(expected).fields.map { case (id, rows) => id -> ParityCorpus.decodeRows(rows) }.toMap
    actual.keySet shouldBe exp.keySet
    actual.foreach { case (id, rows) => withClue(s"frame of $id: ")(ParityCorpus.diff(rows, exp(id)) shouldBe None) }
  }

  private def checkWalkVector(vec: OJ.Obj): OJ.Obj = {
    val defs        = arr(vec("steps")).map(ParityRunner.stepDefOf)
    val order       = defs.map(_.id)
    val rootFrames  = frameMap(vec("rootFrames"))
    var scalaBlock  = obj(vec("scala"))
    var withoutRows = Map.empty[String, Seq[Row]]
    var withRows    = Map.empty[String, Seq[Row]]

    def removedIds: Set[String] = scalaBlock.get("failsAt").map(s => Set(string(s))).getOrElse(
      (scalaBlock.get("removed").orElse(scalaBlock.get("notRun"))).map(a => arr(a).map(string).toSet).getOrElse(Set.empty)
    )

    def fillOrCheck(key: String, actual: Map[String, Seq[Row]]): Unit =
      scalaBlock.get(key) match {
        case Some(expected) => assertFrames(actual, expected)
        case None =>
          if (!regen) fail(s"scala.$key is missing: fill it with PARITY_REGEN=1")
          scalaBlock = scalaBlock.updated(key, framesOf(actual, order))
      }

    if (scalaBlock.contains("notRun")) {
      // An AI step is never run by the oracle: the tree minus the step and its dependents is.
      removedIds.foreach { id =>
        val d = defs.find(_.id == id).getOrElse(fail(s"notRun names unknown step $id"))
        withClue(s"notRun step $id must be an enabled AI step: ")((d.enabled && Set("analyzewithai", "generatetext").contains(d.kind)) shouldBe true)
      }
    } else {
      ParityRunner.run(rootFrames, defs) match {
        case ParityOutcome.Frames(by) if scalaBlock.contains("failsAt") || scalaBlock.contains("laneError") =>
          fail(s"the walk was expected to fail but produced frames for ${by.keys.mkString(", ")}")
        case ParityOutcome.Frames(by) => withRows = by; fillOrCheck("frames", by)
        case ParityOutcome.StepFailed(id) =>
          withClue("the walk failed at a different step: ")(scalaBlock.get("failsAt").map(string) shouldBe Some(id))
        case ParityOutcome.LaneViolation(message) =>
          withClue("an unexpected lane violation: ")(scalaBlock.contains("laneError") shouldBe true)
          withClue(s"'removed' must name a step the violation message names ($message): ")(removedIds.exists(message.contains) shouldBe true)
        case ParityOutcome.ConfigUndecodable(kind, why) => fail(s"a walk vector step has an undecodable $kind config: $why")
      }
    }
    if (removedIds.nonEmpty) {
      val dropped = ParityRunner.closure(removedIds, defs)
      ParityRunner.run(rootFrames, defs.filterNot(d => dropped.contains(d.id))) match {
        case ParityOutcome.Frames(by) => withoutRows = by; fillOrCheck("framesWithout", by)
        case other                    => fail(s"the re-run without ${removedIds.mkString(", ")} did not succeed: $other")
      }
    }

    obj(vec("client")).fields.foreach { case (id, entry) =>
      val e = obj(entry)
      val frame = withRows.get(id).orElse(withoutRows.get(id))
      e.get("rows") match {
        case Some(OJ.Str("scala")) if regen => frame.getOrElse(fail(s"client.$id has no Scala-verified frame"))
        case Some(OJ.Str("scala"))          => fail(s"client.$id still holds the 'scala' placeholder: fill it with PARITY_REGEN=1")
        case Some(rows) =>
          withClue(s"client.$id rows must equal a Scala-verified frame: ")(
            ParityCorpus.diff(ParityCorpus.decodeRows(rows), frame.getOrElse(fail("there is none"))) shouldBe None
          )
        case None =>
          Set("ok", "disabled").contains(string(e("status"))) shouldBe false
      }
    }
    val client = OJ.Obj(obj(vec("client")).fields.map {
      case (id, entry) =>
        val e = obj(entry)
        e.get("rows") match {
          case Some(OJ.Str("scala")) =>
            val frame = withRows.get(id).orElse(withoutRows.get(id)).get
            id -> e.updated("rows", ParityCorpus.encodeRows(frame))
          case _ => id -> entry
        }
    })
    vec.updated("scala", scalaBlock).updated("client", client)
  }

  {
    val file    = ParityCorpus.read("pipelines.json").asInstanceOf[OJ.Obj]
    val vectors = arr(file("vectors")).map(obj)
    val updated = mutable.ArrayBuffer.empty[OJ.Obj]
    "the walk vectors" should {
      vectors.foreach { vec =>
        s"match the engine: ${string(vec("name"))}" in {
          updated += checkWalkVector(vec)
        }
      }
      "flush any regenerated expectations" in {
        if (regen && updated.size == vectors.size && updated != vectors) regenerated("pipelines.json") = file.updated("vectors", OJ.Arr(updated.toVector))
      }
    }
  }

  "the regeneration mode" should {
    "write the corpus files whose expectations it filled in" in {
      regenerated.foreach { case (name, json) => ParityCorpus.write(name, json) }
    }
  }
}
