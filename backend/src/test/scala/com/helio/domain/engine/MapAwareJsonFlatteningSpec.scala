package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import com.helio.domain.model.DataFieldType
import spray.json._

import scala.io.Source

/** HEL-1015 — bounded, map-aware JSON flattening.
 *
 *  Every fixture in the "real data" sections below is loaded verbatim from a genuine Sleeper
 *  API response staged in `backend/src/test/resources/hel1015/` (copied from
 *  `.hel1015-realdata/` at the repo root per tasks.md 5.3 — committed as the fixtures' real-data
 *  source rather than inlined, since design.md D2's table cites these exact files by name and
 *  every number in it is reproducible from them). A hand-built fixture is exactly the shape that
 *  would not contain a map with data-dependent keys, because whoever writes it already knows the
 *  keys (the HEL-904 lesson) — so the map/struct boundary itself is asserted against real
 *  payloads, not synthesized ones.
 */
class MapAwareJsonFlatteningSpec extends AnyWordSpec with Matchers {

  private def loadRows(resource: String): Vector[JsObject] =
    Source.fromResource(s"hel1015/$resource").mkString.parseJson
      .asInstanceOf[JsArray].elements.collect { case o: JsObject => o }

  private val matchupsRows: Vector[JsObject] = loadRows("matchups.json")
  private val txRows: Vector[JsObject]       = loadRows("tx.json")
  private val projRows: Vector[JsObject]     = loadRows("projections-sample-200.json")

  // ── 1. Red baseline (before any fix) — reachability proof ──────────────────────────────────
  //
  // `leavesUnclassified` (mapPaths = Set.empty) reproduces exactly what production `leaves`
  // does when no path is ever classified MAP — i.e. today's pre-fix behaviour for any batch.
  // Unioning it across every row is the pre-fix column set: this is the RED arm, and it must be
  // reachable BEFORE the fix is trusted at all (systematic-debugging.md).

  "1.1 red baseline: unclassified flattening of the real matchups.json payload" should {
    "explode players_points into 170+ per-row-union columns (the defect this ticket fixes)" in {
      val unclassifiedColumns = matchupsRows.flatMap(JsonFlattener.leavesUnclassified(_).map(_._1)).toSet
      val playerPointsColumns = unclassifiedColumns.filter(_.startsWith("players_points."))
      // Observed: 173 distinct players_points.<id> columns (matches design.md D2's measured
      // table: union keys = 173 for players_points).
      playerPointsColumns.size should be >= 170
      withClue(s"observed players_points.* column count: ${playerPointsColumns.size}\n") {
        playerPointsColumns.size shouldBe 173
      }
    }
  }

  "1.2 red baseline: unclassified flattening of the real tx.json payload" should {
    "yield BOTH a scalar 'drops' column (from the null rows) AND drops.<id> columns (from the object rows)" in {
      val unclassifiedColumns = txRows.flatMap(JsonFlattener.leavesUnclassified(_).map(_._1)).toSet
      // The null rows contribute a bare "drops" leaf; the object rows independently contribute
      // "drops.<id>" leaves. Both survive pre-fix — the scalar-and-prefix collision on real data.
      unclassifiedColumns should contain("drops")
      val dropsPrefixColumns = unclassifiedColumns.filter(p => p.startsWith("drops.") )
      dropsPrefixColumns should not be empty
      withClue(s"observed drops.<id> column count: ${dropsPrefixColumns.size}\n") {
        dropsPrefixColumns.size shouldBe 16
      }
    }
  }

  // 1.3 (sbt test full-suite baseline / pass-fail counts) is captured in files-modified.md, not
  // as a test here — it is a whole-suite run, not a single assertion.

  // ── 2/3. Post-fix: the classifier + the three wired consumers ──────────────────────────────

  "2.1/3.1 post-fix: SchemaInferenceEngine over the real matchups.json payload" should {
    "infer exactly ONE bounded players_points column, not one per key" in {
      val schema = SchemaInferenceEngine.fromJson(JsArray(matchupsRows))
      val playersPointsFields = schema.fields.filter(_.name.startsWith("players_points"))
      playersPointsFields.map(_.name) shouldBe Seq("players_points")
      playersPointsFields.head.dataType shouldBe DataFieldType.StringType
    }
  }

  "2.1/3.1 post-fix: SchemaInferenceEngine over the real tx.json payload" should {
    "infer exactly one nullable 'drops' column and ZERO drops.<id> columns" in {
      val schema = SchemaInferenceEngine.fromJson(JsArray(txRows))
      val dropsFields = schema.fields.filter(f => f.name == "drops" || f.name.startsWith("drops."))
      dropsFields.map(_.name) shouldBe Seq("drops")
      dropsFields.head.dataType shouldBe DataFieldType.StringType
      dropsFields.head.nullable shouldBe true
    }

    "infer exactly one bounded 'adds' column" in {
      val schema = SchemaInferenceEngine.fromJson(JsArray(txRows))
      val addsFields = schema.fields.filter(f => f.name == "adds" || f.name.startsWith("adds."))
      addsFields.map(_.name) shouldBe Seq("adds")
    }
  }

  // ── 4. Acceptance criteria ───────────────────────────────────────────────────────────────

  "4.1 AC1: post-fix column list for matchups.json" should {
    "match the full expected field-name set exactly, not just a count" in {
      val schema = SchemaInferenceEngine.fromJson(JsArray(matchupsRows))
      val expectedNonMapFields =
        Set("points", "players", "roster_id", "custom_points", "matchup_id", "starters", "starters_points")
      schema.fields.map(_.name).toSet shouldBe (expectedNonMapFields + "players_points")
    }
  }

  "4.2 AC2: drops resolves to exactly one nullable string column with zero drops.<id> columns" in {
    val schema = SchemaInferenceEngine.fromJson(JsArray(txRows))
    val drops = schema.fields.find(_.name == "drops").getOrElse(fail("drops field missing"))
    drops.dataType shouldBe DataFieldType.StringType
    drops.nullable shouldBe true
    schema.fields.exists(_.name.startsWith("drops.")) shouldBe false
  }

  "4.3 AC3: struct flattening is preserved on the real near-miss and real struct payloads" should {
    "still flatten stats.* and player.* from the real projections-sample-200.json payload" in {
      val schema = SchemaInferenceEngine.fromJson(JsArray(projRows))
      schema.fields.exists(_.name.startsWith("stats.")) shouldBe true
      schema.fields.exists(_.name.startsWith("player.")) shouldBe true
      // Load-bearing near-miss: coverage 0.580, intersection 16 (measured, design.md D2) — must
      // NOT collapse to one 'stats' column.
      schema.fields.exists(_.name == "stats") shouldBe false
      schema.fields.exists(_.name == "player") shouldBe false
    }

    "still flatten settings.* and metadata.* from the real tx.json payload" in {
      val schema = SchemaInferenceEngine.fromJson(JsArray(txRows))
      schema.fields.exists(_.name.startsWith("settings.")) shouldBe true
      schema.fields.exists(_.name.startsWith("metadata.")) shouldBe true
      // `settings` and `metadata` are both `null` in 14 of 36 rows and a (struct-classified)
      // object in the other 22 -- a bare "settings"/"metadata" field legitimately coexists with
      // their dotted children here, contributed by the null rows.
      schema.fields.exists(_.name == "settings") shouldBe true
      // `metadata` is `null` in 14 of 36 rows and a (struct-classified) object in the other 22 --
      // a bare "metadata" field legitimately coexists with "metadata.*" here, contributed by the
      // null rows (unrelated to this ticket's map-vs-struct fix: `metadata` is correctly
      // classified STRUCT, high coverage/intersection, so its object rows still flatten normally;
      // this is the ordinary nullable-struct-field union, not the scalar-and-prefix MAP collision
      // D5 resolves).
      schema.fields.exists(_.name == "metadata") shouldBe true
    }
  }

  "4.4 AC5: the D2 table pinned on real staged data, both conjuncts explicit" should {
    "classify players_points (matchups.json) as MAP: coverage 0.083, intersection 0" in {
      val mapPaths = JsonFlattener.detectMapPaths(matchupsRows)
      mapPaths should contain("players_points")
      val objs = matchupsRows.flatMap(_.fields.get("players_points").collect { case o: JsObject => o })
      val union = objs.flatMap(_.fields.keySet).toSet
      val coverage = objs.map(o => o.fields.keySet.size.toDouble / union.size).sum / objs.size
      val intersection = objs.map(_.fields.keySet).reduce(_ intersect _)
      coverage should be < 0.25
      intersection shouldBe empty
    }

    "classify drops and adds (tx.json) as MAP: intersection 0 in both cases" in {
      val mapPaths = JsonFlattener.detectMapPaths(txRows)
      mapPaths should contain("drops")
      mapPaths should contain("adds")
    }

    // evaluation-1.md Change Request 1: this test previously only asserted `should not contain`
    // for each field, which every struct in the suite satisfies via its non-empty intersection
    // ALONE -- the coverage conjunct was never measured, so it proved nothing about the 0.25
    // threshold. Now pins BOTH conjuncts per field, with the real numbers computed from the
    // committed fixtures (matching design.md D2's table to three decimals), not inequalities.
    "classify settings/metadata (tx.json) and stats/player (projections) as STRUCT: pin coverage AND intersection per field" in {
      def coverageAndIntersection(objs: Vector[JsObject]): (Double, Int) = {
        val union = objs.flatMap(_.fields.keySet).toSet
        val coverage = objs.map(o => o.fields.keySet.size.toDouble / union.size).sum / objs.size
        val intersection = objs.map(_.fields.keySet).reduce(_ intersect _)
        (coverage, intersection.size)
      }
      def objectsAt(rows: Vector[JsObject], key: String): Vector[JsObject] =
        rows.flatMap(_.fields.get(key).collect { case o: JsObject => o })

      val settingsStats = coverageAndIntersection(objectsAt(txRows, "settings"))
      withClue(s"measured settings coverage/intersection = $settingsStats\n") {
        settingsStats._1 shouldBe 0.682 +- 0.001
        settingsStats._2 shouldBe 1
      }
      val metadataStats = coverageAndIntersection(objectsAt(txRows, "metadata"))
      withClue(s"measured metadata coverage/intersection = $metadataStats\n") {
        metadataStats._1 shouldBe 1.000 +- 0.001
        metadataStats._2 shouldBe 1
      }
      val statsStats = coverageAndIntersection(objectsAt(projRows, "stats"))
      withClue(s"measured stats coverage/intersection = $statsStats\n") {
        statsStats._1 shouldBe 0.580 +- 0.001
        statsStats._2 shouldBe 16
      }
      val playerStats = coverageAndIntersection(objectsAt(projRows, "player"))
      withClue(s"measured player coverage/intersection = $playerStats\n") {
        playerStats._1 shouldBe 1.000 +- 0.001
        playerStats._2 shouldBe 14
      }

      JsonFlattener.detectMapPaths(txRows) should not contain "settings"
      JsonFlattener.detectMapPaths(txRows) should not contain "metadata"
      JsonFlattener.detectMapPaths(projRows) should not contain "stats"
      JsonFlattener.detectMapPaths(projRows) should not contain "player"
    }

    "boundary case: 5 rows each with one distinct key out of a 5-key union classifies MAP (coverage 0.2, empty intersection)" in {
      // Exercises a coverage comfortably under the 0.25 threshold with an empty intersection --
      // the ordinary MAP case, distinct from the variant-payload near-miss covered by 4.4a/4.4c.
      val rows = (0 until 5).map { i =>
        JsObject("m" -> JsObject(s"key$i" -> JsNumber(i)))
      }.toVector
      val mapPaths = JsonFlattener.detectMapPaths(rows)
      mapPaths should contain("m")
    }

    // evaluation-1.md Change Request 1(b): every struct-side case above (settings/metadata/
    // stats/player) has a NON-EMPTY intersection, so raising the threshold above 1.0 could never
    // flip them -- the coverage conjunct itself is untested in the direction that matters (too
    // high a threshold silently collapsing real columns). This SYNTHETIC fixture (no real staged
    // payload has this exact shape) isolates the coverage conjunct: intersection is EMPTY (no key
    // recurs across every row), so only coverage can decide STRUCT vs MAP. 4 rows of size 3 from
    // a 6-key union, each row overlapping its neighbours but with no key common to ALL four:
    // row0={a,b,c}, row1={b,c,d}, row2={c,d,e}, row3={d,e,f}. Measured: union=6, coverage=
    // mean(3/6)=0.5 (comfortably above 0.25 -> STRUCT), intersection=0 (no key in all four rows).
    "boundary case: coverage ALONE decides STRUCT when intersection is empty (synthetic, isolates the coverage conjunct)" in {
      val rows = Vector(
        JsObject("m" -> JsObject("a" -> JsNumber(0), "b" -> JsNumber(0), "c" -> JsNumber(0))),
        JsObject("m" -> JsObject("b" -> JsNumber(1), "c" -> JsNumber(1), "d" -> JsNumber(1))),
        JsObject("m" -> JsObject("c" -> JsNumber(2), "d" -> JsNumber(2), "e" -> JsNumber(2))),
        JsObject("m" -> JsObject("d" -> JsNumber(3), "e" -> JsNumber(3), "f" -> JsNumber(3)))
      )
      val objs = rows.flatMap(_.fields.get("m").collect { case o: JsObject => o })
      val union = objs.flatMap(_.fields.keySet).toSet
      val coverage = objs.map(o => o.fields.keySet.size.toDouble / union.size).sum / objs.size
      val intersection = objs.map(_.fields.keySet).reduce(_ intersect _)
      withClue(s"measured coverage=$coverage intersection=${intersection.size}\n") {
        coverage shouldBe 0.5 +- 0.001
        intersection shouldBe empty
      }
      JsonFlattener.detectMapPaths(rows) should not contain "m"
    }
  }

  "4.4a variant-payload counterexample (CR4): coverage alone would misclassify, intersection rejects it" in {
    // Exactly the case named in design.md D2: ~10 variants of ~4 fields sharing one 'type'
    // discriminator. Coverage below threshold (measured ~0.122) but a non-empty intersection
    // (the shared discriminator) MUST classify STRUCT.
    val rows = (0 until 10).map { i =>
      val variantFields = (0 until 4).map(j => s"v${i}_$j" -> JsNumber(j)).toMap
      JsObject((variantFields + ("type" -> JsString("kind"))))
    }.toVector
    val wrapped = rows.map(r => JsObject("payload" -> r))
    val mapPaths = JsonFlattener.detectMapPaths(wrapped)

    val payloadObjs = wrapped.flatMap(_.fields.get("payload").collect { case o: JsObject => o })
    val union = payloadObjs.flatMap(_.fields.keySet).toSet
    val coverage = payloadObjs.map(o => o.fields.keySet.size.toDouble / union.size).sum / payloadObjs.size
    val intersection = payloadObjs.map(_.fields.keySet).reduce(_ intersect _)

    withClue(s"measured coverage=$coverage intersection=${intersection.size}\n") {
      coverage should be < 0.25
      intersection should not be empty
    }
    mapPaths should not contain "payload"
  }

  "4.4b a MAP whose values are OBJECTS: outermost-wins, no paths emitted beneath it" in {
    val rows = (0 until 5).map { i =>
      JsObject("m" -> JsObject(s"key$i" -> JsObject("nested" -> JsNumber(i), "other" -> JsString("x"))))
    }.toVector
    val mapPaths = JsonFlattener.detectMapPaths(rows)
    mapPaths should contain("m")
    // Nothing beneath "m" is classified or emitted: leaves() treats "m" as a single leaf
    // carrying the whole nested object, never recursing into "m.key0.nested" etc.
    rows.foreach { row =>
      val leaves = JsonFlattener.leaves(row, mapPaths)
      leaves.map(_._1) shouldBe Seq("m")
      leaves.head._2 shouldBe a[JsObject]
    }
  }

  "4.4c struct-side residual (r2 CR3): deleting the discriminator from ONE row flips STRUCT -> MAP" in {
    val rows = (0 until 10).map { i =>
      val variantFields = (0 until 4).map(j => s"v${i}_$j" -> JsNumber(j)).toMap
      JsObject(variantFields + ("type" -> JsString("kind")))
    }.toVector
    val wrapped = rows.map(r => JsObject("payload" -> r))

    // Pre-deletion: classifies STRUCT (4.4a).
    JsonFlattener.detectMapPaths(wrapped) should not contain "payload"

    // Delete "type" from exactly one row's payload -> intersection flips from 1 to 0.
    val mutatedFirst = JsObject((rows.head.fields - "type"))
    val mutatedRows = mutatedFirst +: rows.tail
    val mutatedWrapped = mutatedRows.map(r => JsObject("payload" -> r))

    val payloadObjs = mutatedWrapped.flatMap(_.fields.get("payload").collect { case o: JsObject => o })
    val union = payloadObjs.flatMap(_.fields.keySet).toSet
    val coverage = payloadObjs.map(o => o.fields.keySet.size.toDouble / union.size).sum / payloadObjs.size
    val intersection = payloadObjs.map(_.fields.keySet).reduce(_ intersect _)

    withClue(s"measured post-mutation coverage=$coverage intersection=${intersection.size}\n") {
      intersection shouldBe empty
    }

    // Accepted, deliberate limitation (design.md Risks): a single row missing the shared
    // discriminator flips the classification, silently collapsing columns. Asserted here so it
    // is deliberate and visible, not incidental.
    JsonFlattener.detectMapPaths(mutatedWrapped) should contain("payload")
  }

  // evaluation-1.md non-blocking suggestion: this test guards DIVERGENCE (do the three
  // flatteners agree given the SAME mapPaths?), not CLASSIFICATION (did detectMapPaths pick the
  // right threshold?) -- it passes under both the 0.0 and 0.99 threshold mutations above, and
  // that is correct: classifier-threshold coverage lives in 4.4's boundary fixtures, and D6's
  // real ordering seam (does previewRest DERIVE its own mapPaths correctly?) lives in
  // SourceServiceSpec's dedicated test, not here.
  "4.5 schema/row/preview agreement — the binding HEL-599 invariant, over the real map fixture" should {
    "the inferred schema's field-name set equals BOTH the materialised row's key set AND the preview's key set" in {
      val objects  = matchupsRows
      val mapPaths = JsonFlattener.detectMapPaths(objects)

      val schemaNames = SchemaInferenceEngine.fromJson(JsArray(objects)).fields.map(_.name).toSet
      // "Rows" side: PipelineRowJson.jsRowToRow, called with the SAME batch-computed mapPaths
      // (InProcessPipelineEngine's own call pattern).
      val rowKeySets = objects.map(o => PipelineRowJson.jsRowToRow(o, mapPaths).keySet)
      // "Preview" side: JsonFlattener.flattenJsObject, called with the SAME batch-computed
      // mapPaths (SourceService.previewRest's own call pattern).
      val previewKeySets = objects.map(o => JsonFlattener.flattenJsObject(o, mapPaths).fields.keySet)

      val rowUnion     = rowKeySets.foldLeft(Set.empty[String])(_ ++ _)
      val previewUnion = previewKeySets.foldLeft(Set.empty[String])(_ ++ _)

      // Note (task 4.5): VALUE rendering legitimately differs between rows (compact JSON text,
      // the JsArray precedent) and preview (a nested JsObject) — this asserts KEY SETS only.
      schemaNames shouldBe rowUnion
      schemaNames shouldBe previewUnion
    }
  }

  // 4.6 (mutation proof) is executed manually — flip the 0.25 threshold, confirm 4.1/4.2 go RED,
  // restore, both transcripts pasted in files-modified.md as a guard (not run automatically here,
  // since the mutation is applied to production source, not test-local).
}
