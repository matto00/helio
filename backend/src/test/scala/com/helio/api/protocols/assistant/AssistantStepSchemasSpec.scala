package com.helio.api.protocols.assistant

import com.helio.domain.engine.ExpressionEvaluator
import com.helio.domain.model.PipelineStepKind
import com.helio.services.pipelines.ProposalStepRules
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol.StringJsonFormat

/** HEL-1639 D3 (task 3.4): the assistant's strict step schema cannot drift from the step registry or from the real
 *  validation. The enum is the registry's authorable set; each per-op example passes the validation that proposals run;
 *  each schema's `required` keys are exactly [[ProposalStepRules.RequiredKeys]] and removing any of them is reported; the
 *  per-op schemas are strict; and every compute-grammar example the description shows parses. */
class AssistantStepSchemasSpec extends AnyWordSpec with Matchers {

  private def fields(v: JsValue): Map[String, JsValue] = v.asJsObject.fields
  private def at(v: JsValue, path: String*): JsValue = path.foldLeft(v)((acc, k) => fields(acc)(k))
  private def strings(v: JsValue): Set[String] = v.asInstanceOf[JsArray].elements.map(_.convertTo[String](StringJsonFormat)).toSet

  private def toolSchema(name: String): JsValue = AssistantProtocol.assistantTools.find(_.name == name).getOrElse(fail(s"no tool $name")).inputSchema

  private val pipelineStepItem: JsValue = at(toolSchema("propose_pipeline"), "properties", "steps", "items")
  private val combinedStepItem: JsValue = at(toolSchema("propose_combined"), "properties", "pipeline", "properties", "steps", "items")

  "the step type enum" should {
    "equal the registry's authorable kinds, in propose_pipeline and in propose_combined" in {
      strings(at(pipelineStepItem, "properties", "type", "enum")) shouldBe PipelineStepKind.Authorable
      strings(at(combinedStepItem, "properties", "type", "enum")) shouldBe PipelineStepKind.Authorable
      PipelineStepKind.Authorable should not contain "groupby"
      PipelineStepKind.Authorable should not contain "passthrough"
    }

    "be covered exactly once by the oneOf variants, so every authorable op has a config shape" in {
      val variants = at(pipelineStepItem, "oneOf").asInstanceOf[JsArray].elements
      val perVariant = variants.map(v => strings(at(v, "properties", "type", "enum")))
      perVariant.flatten.toSet shouldBe PipelineStepKind.Authorable
      perVariant.flatten.size shouldBe PipelineStepKind.Authorable.size
    }
  }

  "each per-op config schema" should {
    "be strict, and require exactly the keys the proposal validation requires" in {
      AssistantStepSchemas.ConfigSchemas.foreach { case (op, schema) =>
        withClue(s"$op: ") {
          fields(schema)("additionalProperties") shouldBe JsFalse
          strings(fields(schema)("required")) shouldBe ProposalStepRules.RequiredKeys.getOrElse(op, Vector.empty).toSet
          // every required key is a declared property
          (strings(fields(schema)("required")) -- fields(fields(schema)("properties")).keySet) shouldBe empty
        }
      }
    }

    "have an example that passes the real validation and uses only declared properties" in {
      AssistantStepSchemas.Examples.keySet shouldBe AssistantStepSchemas.ConfigSchemas.keySet
      AssistantStepSchemas.Examples.foreach { case (op, example) =>
        withClue(s"$op example: ") {
          ProposalStepRules.problem(op, example.compactPrint) shouldBe None
          (fields(example).keySet -- fields(fields(AssistantStepSchemas.ConfigSchemas(op))("properties")).keySet) shouldBe empty
        }
      }
    }

    "make the validation fail, naming the key, when any required key is removed from the example" in {
      AssistantStepSchemas.ConfigSchemas.foreach { case (op, _) =>
        ProposalStepRules.RequiredKeys.getOrElse(op, Vector.empty).foreach { key =>
          val without = JsObject(fields(AssistantStepSchemas.Examples(op)) - key)
          withClue(s"$op without $key: ") {
            ProposalStepRules.problem(op, without.compactPrint) match {
              case Some(problem) => problem should include(s"'$key'")
              case None          => fail("expected a problem")
            }
          }
        }
      }
    }
  }

  "ProposalStepRules.RequiredKeys" should {
    "only name registered, authorable ops" in {
      (ProposalStepRules.RequiredKeys.keySet -- PipelineStepKind.Authorable) shouldBe empty
    }
  }

  "the compute expression grammar the schema documents" should {
    "show examples that all parse" in {
      val examples = Vector("$wins + $ties * 0.5", "round($settings.fpts + $settings.fpts_decimal / 100, 2)", "if($wins > 8, \"top\", \"rest\")")
      examples.foreach(e => withClue(e)(ExpressionEvaluator.parseProblem(e) shouldBe None))
      examples.foreach(e => AssistantStepSchemas.ComputeGrammar should include(e))
    }

    "reject the two inventions from the 2026-10-16 transcript" in {
      ExpressionEvaluator.parseProblem("record.settings.fpts_decimal") shouldBe defined
      ExpressionEvaluator.parseProblem("'settings.fpts_decimal'") shouldBe defined
    }
  }
}
