package com.helio.domain.steps

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.model.PipelineStep
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1476 D3: duplicate re-encodes a stored config from its typed form and runs the write-path
 *  check on it, so every config create accepts (frontend seeds and HEL-1416 drafts) must still pass
 *  `rawConfigProblem` after `encode(decode(draft))` -- otherwise that draft could be saved but never
 *  duplicated. GUARD: failable by mutation (e.g. reverting the convertformat writer fix). */
class DraftRoundTripWriteSafetySpec extends AnyWordSpec with Matchers {

  private val src = """{"kind":"source","dataSourceId":""}"""

  /** Create-accepted draft shapes per kind (frontend `defaultConfigFor` seeds + HEL-1416 drafts). */
  private val drafts: Map[String, Seq[String]] = Map(
    "select"        -> Seq("""{"fields":[]}"""),
    "rename"        -> Seq("""{"renames":{}}"""),
    "cast"          -> Seq("""{"casts":{}}"""),
    "filter"        -> Seq("""{"combinator":"AND","conditions":[]}"""),
    "compute"       -> Seq("""{"column":"","expression":"","type":"number"}"""),
    "aggregate"     -> Seq("""{"groupBy":[],"aggregations":[]}"""),
    "limit"         -> Seq("""{"count":100}"""),
    "sort"          -> Seq("""{"sortBy":[]}"""),
    "join"          -> Seq(s"""{"secondaryInput":$src,"joinKey":"","joinType":"inner"}"""),
    "groupby"       -> Seq("""{"groupBy":[],"aggColumn":"","aggFunction":"sum"}"""),
    "splittext"     -> Seq("""{"field":"","mode":"paragraph","headingLevel":1,"indexField":"segmentIndex"}"""),
    "extractheadings" -> Seq("""{"field":"","indexField":"headingIndex","levelField":"headingLevel"}"""),
    "chunkbytokencount" -> Seq("""{"field":"","targetTokenCount":500,"encoding":"o200k_base","indexField":"chunkIndex","tokenCountField":"tokenCount"}"""),
    "datebucket"    -> Seq("""{"field":"","granularity":"day"}"""),
    "pivot"         -> Seq("""{"index":[],"column":"","values":"","agg":"sum"}""", """{"index":[],"column":"","values":"","agg":""}"""),
    "window"        -> Seq("""{"partitionBy":[],"orderBy":[],"function":"row_number","outputColumn":""}""", """{"partitionBy":[],"orderBy":[],"function":"","outputColumn":""}"""),
    "unpivot"       -> Seq("""{"idVars":[],"valueVars":[],"varName":"variable","valueName":"value"}"""),
    "dedupe"        -> Seq("""{"keys":[],"keep":"first"}"""),
    "fillnull"      -> Seq("""{"columns":[],"strategy":"constant","value":null}""", """{"columns":[],"strategy":""}"""),
    "stringops"     -> Seq("""{"operation":"trim","field":"","outputColumn":"","pattern":null,"separator":null,"index":null,"fields":null}"""),
    "union"         -> Seq(s"""{"secondaryInput":$src,"mode":"byPosition"}"""),
    "lookup"        -> Seq(s"""{"secondaryInput":$src,"sourceKey":"","lookupKey":"","columns":[]}"""),
    "assert"        -> Seq("""{"rules":[]}"""),
    "upsertsource"  -> Seq("""{"mode":"append"}"""),
    "convertformat" -> Seq("""{"field":""}"""),
    // AI kinds defer create until the config is complete (`requiresCompleteConfigForCreate`), so the
    // only create-accepted shapes are complete ones.
    "analyzewithai" -> Seq("""{"inputField":"doc","instruction":"summarise","outputSchema":[{"name":"s","type":"string"}]}"""),
    "generatetext"  -> Seq("""{"inputField":"doc","instruction":"summarise","outputField":"out"}""")
  )

  "every registered step kind" should {
    "have a draft case in this table (a new kind must declare its drafts)" in {
      drafts.keySet shouldBe PipelineStep.Registry.keySet
    }

    for ((kind, shapes) <- drafts; raw <- shapes) {
      s"GUARD: accept its create-accepted draft after encode(decode(draft)): $kind $raw" in {
        PipelineStep.rawConfigProblem(kind, raw) shouldBe None // premise: create accepts it
        val typed     = PipelineStepConfigCodec.decode(kind, raw).get
        val reEncoded = PipelineStepConfigCodec.encodeConfig(typed)
        withClue(s"re-encoded: $reEncoded -> ") { PipelineStep.rawConfigProblem(kind, reEncoded) shouldBe None }
      }
    }
  }
}
