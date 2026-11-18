package com.helio.domain.model

import com.helio.domain.outputs.InsightConfig
import com.helio.domain.panels.OutputBindingSpec
import com.helio.services.panels.OutputPanelDefaultSize
import com.helio.services.pipelines.OutputConfigValidation
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.{Files, Paths}

/** GUARD (HEL-1740, labelled as such): green on a correct tree, red only by mutation (drop `insight` from one site; every
 *  mutation is recorded in openspec/changes/register-insight-output-kind/drift-mutations.md).
 *
 *  Canonical = `OutputKind.all`. Every hand-written Output-kind enumeration site must equal it, except the sites a later leaf
 *  owns, which are pinned as EXCLUSIONS: they must equal canonical minus `insight`, so the check also fails when an excluded
 *  site gains `insight` before its owner removes the exclusion. Text extraction is anchored and fails when it finds nothing. */
class OutputKindDriftSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private val canonical: Set[String]        = OutputKind.all.map(OutputKind.asString).toSet
  private val withoutInsight: Set[String]   = canonical - "insight"

  private def repoFile(rel: String): String = {
    val p = Paths.get("..").resolve(rel)
    withClue(s"$rel must exist")(Files.exists(p) shouldBe true)
    new String(Files.readAllBytes(p), "UTF-8")
  }

  private def nonEmpty[A](what: String, xs: Set[A]): Set[A] = { withClue(s"$what: extraction found nothing")(xs should not be empty); xs }

  /** Navigate by JSON path and read the `enum` array found there. */
  private def schemaKindEnum(file: String, path: String*): Set[String] = {
    val node = path.foldLeft[JsValue](repoFile(s"schemas/$file").parseJson)(_.asJsObject.fields.getOrElse(_, fail(s"$file: no $path")))
    nonEmpty(s"$file ${path.mkString(".")}", node.asJsObject.fields("enum").convertTo[Vector[String]].toSet)
  }

  /** The first quoted-string list inside `anchor ... ]` (anchored, narrow). */
  private def quotedList(text: String, anchor: String, close: Char = ']'): Set[String] = {
    val start = text.indexOf(anchor)
    withClue(s"anchor '$anchor' not found")(start should be >= 0)
    val end = text.indexOf(close, start)
    nonEmpty(s"list after '$anchor'", "\"([a-z_]+)\"".r.findAllMatchIn(text.substring(start, end)).map(_.group(1)).toSet)
  }

  "per-kind maps" should {
    "OutputConfigValidation.KnownKeys covers exactly the canonical kinds" in {
      OutputConfigValidation.KnownKeys.keySet.map(OutputKind.asString) shouldBe canonical
    }
    "OutputBindingSpec.All covers exactly the canonical kinds, once each" in {
      OutputBindingSpec.All.map(s => OutputKind.asString(s.outputKind)).sorted shouldBe canonical.toVector.sorted
    }
    "OutputPanelDefaultSize has a size for every canonical kind" in {
      OutputKind.all.foreach(k => withClue(OutputKind.asString(k))(OutputPanelDefaultSize.forKind(k).w should be > 0))
    }
    "fromString's error message lists exactly the canonical kinds" in {
      val msg = OutputKind.fromString("zzz").left.getOrElse(fail("expected Left"))
      val listed = msg.substring(msg.indexOf("Valid values: ") + "Valid values: ".length).split(",").map(_.trim).toSet
      listed shouldBe canonical
    }
    "asString/fromString round-trip every canonical kind" in {
      OutputKind.all.map(OutputKind.asString).map(OutputKind.fromString) shouldBe OutputKind.all.map(Right(_))
    }
  }

  "JSON schemas" should {
    "carry exactly the canonical kinds in every kind enum" in {
      val sites = Seq(
        "outputs/output.schema.json"                                          -> Seq("properties", "kind"),
        "outputs/create-output-request.schema.json"                           -> Seq("properties", "kind"),
        "pipelines/create-pipeline-transactional-output-request.schema.json"  -> Seq("properties", "kind"),
        "pipelines/draft-save-request.schema.json"                            -> Seq("$defs", "DraftOutput", "properties", "kind"),
        "pipelines/draft-save-response.schema.json"                           -> Seq("$defs", "SavedOutput", "properties", "kind")
      )
      sites.foreach { case (file, path) => withClue(file)(schemaKindEnum(file, path: _*) shouldBe canonical) }
    }
    "name every canonical kind in node-capabilities-response's description" in {
      val desc = repoFile("schemas/pipelines/node-capabilities-response.schema.json").parseJson.asJsObject
        .fields("properties").asJsObject.fields("capabilities").asJsObject.fields("description").convertTo[String]
      canonical.foreach(k => withClue(k)(desc should include(s"`$k`")))
    }
    "document every insight key on the create-output-request schema" in {
      val props = repoFile("schemas/outputs/create-output-request.schema.json").parseJson.asJsObject
        .fields("properties").asJsObject.fields("config").asJsObject.fields("properties").asJsObject.fields.keySet
      InsightConfig.Keys.foreach(k => withClue(k)(props should contain(k)))
    }
  }

  "the fixture the frontend reads" should {
    "list exactly the canonical kinds in the node-capabilities parity fixture" in {
      val fixture = repoFile("frontend/src/features/pipelines/state/__fixtures__/nodeCapabilitiesParity.json").parseJson.asJsObject
      val kinds = fixture.fields.values.flatMap(collectKinds).toSet
      withClue("capability keys found in the parity fixture")(kinds should not be empty)
      canonical.foreach(k => withClue(s"$k in fixture")(kinds should contain(k)))
    }
  }

  // Exclusions: surfaces a later leaf owns. They must keep the six pre-insight kinds until that leaf lands.
  "pinned exclusions (until their owning leaf)" should {
    "helio-mcp kind enums keep the six pre-insight kinds (HEL-1747 L8 owns them)" in {
      quotedListEq("helio-mcp/src/tools/outputs.ts", "const outputKindSchema = z.enum([")
      quotedListEq("helio-mcp/src/tools/pipelines.ts", ".enum([\"table\"")
      quotedListEq("helio-mcp/src/tools/pipelineProposal.ts", "kind: z.enum([\"table\"")
      val types = repoFile("helio-mcp/src/types.ts")
      val line  = types.linesIterator.find(_.trim.startsWith("kind: \"table\" | \"metric\"")).getOrElse(fail("helio-mcp types.ts Output kind union not found"))
      "\"([a-z_]+)\"".r.findAllMatchIn(line).map(_.group(1)).toSet shouldBe withoutInsight
    }
    "the assistant proposal tool schema keeps the six pre-insight kinds (HEL-1747 L8 owns it)" in {
      quotedListEq("backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala", "JsArray(Vector(\"table\"", ')')
    }
    "OutputConfigValidation.KeysDoc does not document insight keys (HEL-1747 L8 owns it)" in {
      val doc = OutputConfigValidation.KeysDoc
      doc should not include "insight:"
      doc should not include "maxSentences"
      // `reads` is left out of the key scan: it is an ordinary word in KeysDoc's duration prose.
      (InsightConfig.OwnKeys - "reads").foreach(k => withClue(k)(doc should not include k))
    }
    "the Output editor's create picker excludes insight (HEL-1744 L5 owns it; pinned in outputKindDrift.test.ts)" in {
      val text = repoFile("frontend/src/features/pipelines/ui/outputEditor/outputKinds.ts")
      val start = text.indexOf("CREATABLE_KIND_OPTIONS: SelectOption[] = [")
      withClue("picker list anchor")(start should be >= 0)
      val values = "value: \"([a-z_]+)\"".r.findAllMatchIn(text.substring(start, text.indexOf("];", start))).map(_.group(1)).toSet
      values shouldBe withoutInsight
    }
  }

  private def quotedListEq(file: String, anchor: String, close: Char = ']'): Unit =
    withClue(file)(quotedList(repoFile(file), anchor, close) shouldBe withoutInsight)

  private def collectKinds(v: JsValue): Set[String] = v match {
    case JsObject(fields) => fields.get("capabilities").map(_.asJsObject.fields.keySet).getOrElse(Set.empty[String]) ++ fields.values.flatMap(collectKinds)
    case JsArray(items)   => items.flatMap(collectKinds).toSet
    case _                => Set.empty
  }

  "the live outputs.kind CHECK constraint (after Flyway)" should {
    var pg: EmbeddedPostgres = null
    "list exactly the canonical kinds" in {
      pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder())
      try {
        Flyway.configure().dataSource(pg.getJdbcUrl("postgres", "postgres"), "postgres", "postgres").locations("classpath:db/migration").load().migrate()
        val conn = pg.getPostgresDatabase.getConnection
        try {
          val rs = conn.createStatement().executeQuery(
            "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'outputs'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%kind%'"
          )
          val defs = Iterator.continually(rs).takeWhile(_.next()).map(_.getString(1)).toVector
          withClue("kind CHECK constraints found")(defs should have size 1)
          nonEmpty("CHECK literals", "'([a-z_]+)'::text".r.findAllMatchIn(defs.head).map(_.group(1)).toSet) shouldBe canonical
        } finally conn.close()
      } finally pg.close()
    }
  }
}
