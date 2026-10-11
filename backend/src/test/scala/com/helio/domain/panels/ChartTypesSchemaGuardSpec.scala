package com.helio.domain.panels

import com.helio.testsupport.JsonSchemaValidation
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.io.File
import scala.io.Source

/** GUARD (HEL-1311, labelled as such): it is green on a correct tree and only goes red by mutation (drop a
 *  value from [[ChartTypes.All]] or from one schema enum) -- the recorded mutation evidence lives in
 *  `.concertino/runs/HEL-1311/evidence/`. Walks every schema file, collects each `chartType`
 *  property's `enum` and pins it to [[ChartTypes.All]]. */
class ChartTypesSchemaGuardSpec extends AnyWordSpec with Matchers {

  private val ExpectedEnumCount = 6

  private def schemaFiles(dir: File): Vector[File] =
    Option(dir.listFiles()).toVector.flatten.flatMap { f =>
      if (f.isDirectory) schemaFiles(f) else if (f.getName.endsWith(".json")) Vector(f) else Vector.empty
    }

  /** (path, enum values minus null) for each `chartType` property carrying an `enum`. */
  private def chartTypeEnums(v: JsValue, path: String): Vector[(String, Set[String])] = v match {
    case JsObject(fields) =>
      val here = fields.get("chartType") match {
        case Some(JsObject(prop)) =>
          prop.get("enum").collect { case JsArray(es) => es.collect { case JsString(s) => s }.toSet }.map(e => path -> e).toVector
        case _ => Vector.empty
      }
      here ++ fields.toVector.flatMap { case (k, c) => chartTypeEnums(c, s"$path/$k") }
    case JsArray(items) => items.zipWithIndex.flatMap { case (c, i) => chartTypeEnums(c, s"$path[$i]") }
    case _              => Vector.empty
  }

  "schemas directory chartType enums" should {
    "be exactly six and each equal ChartTypes.All (null aside)" in {
      val root = JsonSchemaValidation.schemaFile("").getCanonicalFile
      val found = schemaFiles(root).flatMap { f =>
        val src = Source.fromFile(f, "UTF-8")
        try chartTypeEnums(src.mkString.parseJson, f.getName) finally src.close()
      }
      withClue(s"discovered: ${found.map(_._1)}: ") { found should have size ExpectedEnumCount.toLong }
      found.foreach { case (where, values) => withClue(s"$where: ") { values shouldBe ChartTypes.AllSet } }
    }
  }
}
