package com.helio.domain.engine

import com.helio.domain.model.{PipelineStep, DataFieldType, DatasetFieldDeclaration, PipelineExecutionContext, PipelineId, PipelineStepId}
import com.helio.domain.history.OutputSummaryReducer
import com.helio.domain.model.OutputKind
import com.helio.domain.steps._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.testsupport.CsvLoadSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1408 design D7/D7b: one deliberate assertion of the NEW value per consumer whose result
 *  changed when a CSV blank became null. Every case is driven from a frame produced by the REAL CSV
 *  loader (`loadCsv`), so each is about a CSV blank, not a hand-built null row. The snapshot-read
 *  rows (distinct values, `eq ""`, server sort NULLS LAST, row count) are in
 *  `CsvBlankCellsNullSnapshotSpec`; `nullRate` is in `CsvBlankCellsNullWorkspaceSpec`. */
class CsvBlankCellsNullStepsSpec extends AnyWordSpec with Matchers with CsvLoadSupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val now = Instant.now()
  private val pid = PipelineId("p")

  // team: a, a, <blank>, b, <blank>; score: 3, <blank>, 5, <blank>, 7; when: 2026-01-01, <blank>, 2026-01-03, <blank>, <blank>
  private val csv =
    """team,score,when,tag
      |a,3,2026-01-01,x
      |a,,,y
      |,5,2026-01-03,z
      |b,,,w
      |,7,,v
      |""".stripMargin

  private def frame: Seq[Map[String, Any]] = loadCsv(csv)

  private def toRow(r: Map[String, Any], cols: Vector[String]): Vector[JsValue] =
    cols.map(c => PipelineRowJson.anyToJsValue(r.getOrElse(c, null)))

  private def runStep(step: PipelineStep, rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext): Seq[Map[String, Any]] =
    Await.result(step.evaluate(rows, ctx), 5.seconds)

  "aggregate / groupby / pivot over a CSV frame" should {

    "aggregate: blank group key is its own null group; sum/avg/min/max skip blanks; count excludes them" in {
      val out = AggregateStep.apply(
        frame,
        AggregateConfig(
          Vector(AggregateField("team", "string")),
          Vector(
            Aggregation("n", "count", "score"),
            Aggregation("s", "sum", "score"),
            Aggregation("a", "avg", "score"),
            Aggregation("lo", "min", "score"),
            Aggregation("hi", "max", "score")
          )
        )
      )
      val byTeam = out.map(r => r("team") -> r).toMap
      byTeam.keySet shouldBe Set("a", "b", null)          // not ""
      byTeam(null)("n") shouldBe 2L
      byTeam(null)("s") shouldBe 12.0
      byTeam("a")("n") shouldBe 1L                         // blank score excluded from count
      byTeam("a")("s") shouldBe 3.0
      byTeam("b")("n") shouldBe 0L
      (byTeam("b")("a") == null) shouldBe true
    }

    "groupby step (non-authorable) count excludes blanks" in {
      val out = GroupByStep.apply(frame, GroupByConfig(Vector("team"), "score", "count"))
      out.find(_("team") == "a").get.values.collect { case l: Long => l }.toSet shouldBe Set(1L)
      out.find(_("team") == "b").get.values.collect { case l: Long => l }.toSet shouldBe Set(0L)
    }

    "pivot: count excludes blanks and a blank pivot-column value gets no values_ column" in {
      val out = PivotStep.apply(frame, PivotConfig(Vector("team"), "tag", "score", "count"))
      out.flatMap(_.keySet).toSet should not contain "score_"
      val a = out.find(_("team") == "a").get
      a("score_x") shouldBe 1L
      a("score_y") shouldBe 0L                              // blank score not counted
      val pivotOnBlank = PivotStep.apply(frame, PivotConfig(Vector("tag"), "when", "score", "count"))
      pivotOnBlank.flatMap(_.keySet).toSet should not contain "score_"
      pivotOnBlank.flatMap(_.keySet).toSet.filter(_.startsWith("score_")) shouldBe Set("score_2026-01-01", "score_2026-01-03")
    }
  }

  "fillnull over a CSV frame" should {

    "constant fills blanks" in {
      FillNullStep.apply(frame, FillNullConfig(Vector("team"), "constant", Some("none"))).map(_("team")) shouldBe
        Seq("a", "a", "none", "b", "none")
    }

    "forwardFill carries the last non-blank value across a blank" in {
      FillNullStep.apply(frame, FillNullConfig(Vector("team"), "forwardFill", None)).map(_("team")) shouldBe
        Seq("a", "a", "a", "b", "b")
    }

    "mode ignores blanks (the blank no longer wins)" in {
      // two blank cells and one "x": before, "" was the most common value and won.
      val mode = FillNullStep.apply(loadCsv("v,k\n,1\n,2\nx,3\n"), FillNullConfig(Vector("v"), "mode", None))
      mode.map(_("v")) shouldBe Seq("x", "x", "x")
    }
  }

  "cast / compute / stringops over a CSV frame" should {

    "cast to string and to date leaves a blank null" in {
      val out = CastStep.apply(frame, CastConfig(Map("team" -> "string", "when" -> "date")))
      out.map(_("team")) shouldBe Seq("a", "a", null, "b", null)
      out.map(_("when")).count(_ == null) shouldBe 3
    }

    "compute concat / + / length / upper of a blank is null" in {
      def col(expr: String): Seq[Any] =
        ComputeStep.apply(frame, ComputeConfig("r", expr, None)).map(_("r"))
      (col("concat($team, \"-\")")(2) == null) shouldBe true
      (col("$team + \"-\"")(2) == null) shouldBe true
      (col("length($team)")(2) == null) shouldBe true
      (col("upper($team)")(2) == null) shouldBe true
      col("upper($team)").head shouldBe "A"
    }

    "stringops concat still treats a blank as empty (unchanged)" in {
      val out = StringOpsStep.apply(
        frame,
        StringOpsConfig("concat", "team", "joined", None, Some("-"), None, Some(Vector("team", "tag")))
      )
      out(2)("joined") shouldBe "-z"
    }
  }

  "ordering and keys over a CSV frame" should {

    "sort puts blanks last in BOTH directions" in {
      def order(dir: String) =
        SortStep.apply(frame, SortConfig(Vector(SortKey("team", dir)))).map(_("team"))
      order("asc") shouldBe Seq("a", "a", "b", null, null)
      order("desc") shouldBe Seq("b", "a", "a", null, null)
    }

    "window orderBy puts blanks last: row_number on a blank-ordered column" in {
      val out = WindowStep.apply(
        frame,
        WindowConfig(Vector.empty, Vector(SortKey("team", "asc")), "row_number", None, "rn", None)
      )
      val rn = out.map(r => r("tag") -> r("rn")).toMap
      Set(rn("z"), rn("v")) shouldBe Set(4L, 5L).map(identity[Any])
    }

    "dedupe: blank is a null key, so two blank rows collapse to one" in {
      DedupeStep.apply(frame, DedupeConfig(Vector("team"), "first")).map(_("team")) shouldBe
        Seq("a", null, "b")
    }
  }

  "join and lookup over CSV frames" should {

    "join: a null key still matches a null key on the other source" in {
      val left  = frame
      val right = loadCsv("team,label\n,BLANK\na,A\n")
      val step = JoinStep(PipelineStepId("j"), pid, 0, JoinConfig(SecondaryInput.Lane("r"), "team", "inner"), now, now)
      val ctx = PipelineExecutionContext(
        dataSourceRepo = new DataSourceRepository(null)(ec),
        loadSource     = _ => Future.failed(new IllegalStateException("unused")),
        resolveLane    = id => if (id == "r") Some(right) else None
      )
      val out = runStep(step, left, ctx)
      out.filter(_("team") == null).map(_("label")).toSet shouldBe Set("BLANK")
      out.count(_("team") == null) shouldBe 2
    }
    "lookup: a null source key still matches a null reference key" in {
      val ref = loadCsv("team,label\n,BLANK\na,A\n")
      val step = LookupStep(
        PipelineStepId("l"), pid, 0,
        LookupConfig(SecondaryInput.Lane("r"), "team", "team", Vector("label")), now, now
      )
      val ctx = PipelineExecutionContext(
        dataSourceRepo = new DataSourceRepository(null)(ec),
        loadSource     = _ => Future.failed(new IllegalStateException("unused")),
        resolveLane    = id => if (id == "r") Some(ref) else None
      )
      val out = runStep(step, frame, ctx)
      out.filter(_("team") == null).map(_("label")).toSet shouldBe Set("BLANK")
      out.filter(_("team") == "a").map(_("label")).toSet shouldBe Set("A")
    }
  }

  "assert over a CSV frame" should {

    def run(rules: Vector[AssertRule]) = AssertStep.evaluateRules(frame, rules)

    "notNull fails on a blank; unique ignores blanks" in {
      val r = run(Vector(
        AssertRule("notNull", Some("team"), JsObject.empty, "error"),
        AssertRule("unique", Some("score"), JsObject.empty, "error"),
        AssertRule("unique", Some("team"), JsObject.empty, "error")
      ))
      r(0).passed shouldBe false                       // 2 blanks
      r(1).passed shouldBe true                        // blanks no longer repeat
      r(2).passed shouldBe false                       // "a" really is repeated
    }

    "rowCountMin sees the row count without skipped blank lines" in {
      val rows = loadCsv("a\n1\n\n   \n2\n")
      val res = AssertStep.evaluateRules(
        rows,
        Vector(AssertRule("rowCountMin", None, JsObject("count" -> JsNumber(3)), "error"))
      )
      res.head.passed shouldBe false                   // 2 rows, not 4
    }

    "regex fails a blank even when the pattern would have matched the empty string" in {
      val res = AssertStep.evaluateRules(
        frame,
        Vector(AssertRule("regex", Some("score"), JsObject("pattern" -> JsString("^$|^\\d+$")), "error"))
      )
      res.head.passed shouldBe false
    }
  }

  "upsert validation over a CSV frame" should {
    "reject a blank in a required column as required" in {
      val decl = Vector(DatasetFieldDeclaration("team", DataFieldType.StringType, required = true, default = None))
      val res = DatasetRowValidator.validate(decl, frame.map(toRow(_, Vector("team"))).toVector)
      res.left.toOption.get shouldBe Vector("row 2: field 'team' is required", "row 4: field 'team' is required")
    }

    "fill a blank with the field's declared default" in {
      val decl = Vector(DatasetFieldDeclaration("team", DataFieldType.StringType, required = true, default = Some(JsString("n/a"))))
      val res = DatasetRowValidator.validate(decl, frame.map(toRow(_, Vector("team"))).toVector)
      res.toOption.get.map(_.head) shouldBe Vector(JsString("a"), JsString("a"), JsString("n/a"), JsString("b"), JsString("n/a"))
    }

    "accept a blank in an optional numeric column (previously a type rejection)" in {
      val decl = Vector(DatasetFieldDeclaration("n", DataFieldType.IntegerType, required = false, default = None))
      val blankOnly = loadCsv("id,n\n1,\n2,\n")
      val res = DatasetRowValidator.validate(decl, blankOnly.map(toRow(_, Vector("n"))).toVector)
      res shouldBe Right(Vector(Vector(JsNull), Vector(JsNull)))
    }
  }

  "output schema inference and the summary over a CSV frame" should {

    "infer a date column with blanks as timestamp (no blank string to widen it)" in {
      val objects = frame.map(r => JsObject(PipelineRowJson.rowToJsMap(r))).toVector
      val whenField = SchemaInferenceEngine.inferShallowFromJsObjects(objects).find(_.name == "when").get
      whenField.dataType shouldBe DataFieldType.TimestampType
    }

    "summary count excludes blanks; numeric stats are unchanged" in {
      val objects = frame.map(r => JsObject(PipelineRowJson.rowToJsMap(r))).toVector
      OutputSummaryReducer.computeAggregate(objects, "team", "count") shouldBe Some(3.0)
      OutputSummaryReducer.computeAggregate(objects, "score", "sum") shouldBe Some(15.0)
      OutputSummaryReducer.summarize(objects, OutputKind.Table, JsObject.empty).fields("rowCount") shouldBe JsNumber(5)
    }
  }
}
