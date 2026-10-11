package com.helio.services.patchsets

import com.helio.api.protocols.assistant.AssistantProtocol
import com.helio.api.protocols.patchsets.{Edit, PatchSetProtocol}
import com.helio.domain.patchsets.PatchSetTargetKinds
import com.helio.testsupport.JsonSchemaValidation
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.io.File
import java.util.regex.Pattern
import scala.io.Source

/** GUARD (HEL-1459, HEL-1311 pattern, labelled as such): green on a correct tree and only goes red by
 *  mutation (drop a kind from [[PatchSetTargetKinds.All]], from one schema enum, or from the tool
 *  description / prompt skeleton) -- the recorded mutation evidence lives in
 *  `.concertino/runs/HEL-1459/evidence/`. Walks every `schemas/patch-sets/` file, collects each
 *  `kind` property's `enum` (and every `kind.const`), and pins the backend list, the decoder, the
 *  assistant tool schema + description and the refinement prompt skeleton to it. Failure messages name
 *  the diverging surface. */
class PatchSetTargetKindsSchemaGuardSpec extends AnyWordSpec with Matchers with PatchSetProtocol {

  private val ExpectedEnumCount = 2

  private def schemaFiles(dir: File): Vector[File] =
    Option(dir.listFiles()).toVector.flatten.flatMap { f =>
      if (f.isDirectory) schemaFiles(f) else if (f.getName.endsWith(".json")) Vector(f) else Vector.empty
    }

  /** (path, values) for each `kind` property carrying an `enum` (`useConst = false`) or a `const`. */
  private def kindValues(v: JsValue, path: String, useConst: Boolean): Vector[(String, Set[String])] = v match {
    case JsObject(fields) =>
      val here = fields.get("kind") match {
        case Some(JsObject(prop)) if !useConst =>
          prop.get("enum").collect { case JsArray(es) => es.collect { case JsString(s) => s }.toSet }.map(e => path -> e).toVector
        case Some(JsObject(prop)) =>
          prop.get("const").collect { case JsString(s) => path -> Set(s) }.toVector
        case _ => Vector.empty
      }
      here ++ fields.toVector.flatMap { case (k, c) => kindValues(c, s"$path/$k", useConst) }
    case JsArray(items) => items.zipWithIndex.flatMap { case (c, i) => kindValues(c, s"$path[$i]", useConst) }
    case _              => Vector.empty
  }

  private def readJson(f: File): JsValue = {
    val src = Source.fromFile(f, "UTF-8")
    try src.mkString.parseJson finally src.close()
  }

  private def patchSetSchemaKinds(useConst: Boolean): Vector[(String, Set[String])] = {
    val root = JsonSchemaValidation.schemaFile("patch-sets").getCanonicalFile
    schemaFiles(root).flatMap(f => kindValues(readJson(f), s"schemas/patch-sets/${f.getName}", useConst))
  }

  private def wholeWord(text: String, word: String): Boolean =
    s"(?<![A-Za-z0-9_])${Pattern.quote(word)}(?![A-Za-z0-9_])".r.findFirstIn(text).isDefined

  "schemas/patch-sets kind enums" should {
    "be exactly two and each equal PatchSetTargetKinds.All" in {
      val found = patchSetSchemaKinds(useConst = false)
      withClue(s"discovered: ${found.map(_._1)}: ") { found should have size ExpectedEnumCount.toLong }
      found.foreach { case (where, values) =>
        withClue(s"$where diverges from PatchSetTargetKinds.All (backend domain/patchsets/PatchSetTargetKinds.scala): ") {
          values shouldBe PatchSetTargetKinds.AllSet
        }
      }
    }

    "only use kind constants that are members of PatchSetTargetKinds.All" in {
      patchSetSchemaKinds(useConst = true).foreach { case (where, values) =>
        withClue(s"$where names a kind outside PatchSetTargetKinds.All: ") {
          values.subsetOf(PatchSetTargetKinds.AllSet) shouldBe true
        }
      }
    }
  }

  "the assistant propose_patch_set tool" should {
    val tool = AssistantProtocol.assistantTools.find(_.name == "propose_patch_set").getOrElse(fail("no propose_patch_set tool"))

    "have an input-schema kind enum equal to PatchSetTargetKinds.All" in {
      val found = kindValues(tool.inputSchema, "propose_patch_set.inputSchema", useConst = false)
      withClue(s"discovered: ${found.map(_._1)}: ") { found should have size 1L }
      withClue("AssistantProposalToolSchemas.scala propose_patch_set inputSchema kind enum diverges: ") {
        found.head._2 shouldBe PatchSetTargetKinds.AllSet
      }
    }

    "name every target kind as a whole word in its description" in {
      PatchSetTargetKinds.All.foreach { k =>
        withClue(s"AssistantProposalToolSchemas.scala propose_patch_set description does not name '$k': ") {
          wholeWord(tool.description, k) shouldBe true
        }
      }
    }
  }

  "the refinement prompt skeleton" should {
    "name every target kind as a whole word" in {
      PatchSetTargetKinds.All.foreach { k =>
        withClue(s"RefinementEditShape.scala Skeleton does not name '$k': ") {
          wholeWord(RefinementEditShape.Skeleton, k) shouldBe true
        }
      }
    }
  }

  "the PatchSetProtocol decoder" should {
    def deleteEdit(kind: String): JsValue =
      JsObject("target" -> JsObject("kind" -> JsString(kind), "id" -> JsString("x")), "op" -> JsString("delete"))

    "accept every kind in PatchSetTargetKinds.All" in {
      PatchSetTargetKinds.All.foreach { k =>
        withClue(s"PatchSetProtocol.scala decoder rejects '$k': ") { deleteEdit(k).convertTo[Edit].target.kind shouldBe k }
      }
    }

    "reject the removed dataType kind" in {
      an[DeserializationException] should be thrownBy deleteEdit("dataType").convertTo[Edit]
    }
  }
}
