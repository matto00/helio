package com.helio.services

import com.helio.services.workspace.WorkspaceContextService
import com.helio.api.protocols.workspace.WorkspaceContextColumnStats
import com.helio.domain.model.DataField
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-374 tasks.md 5.1 — pure unit tests for
 *  `WorkspaceContextService.classifySemanticRole`/`normalizedNameTokens`
 *  (design.md D1), mirroring `WorkspaceContextServiceComputeColumnStatsSpec`'s
 *  no-DB-fixture pattern — both are pure functions of their arguments and
 *  touch none of the service's four constructor dependencies. */
class WorkspaceContextServiceClassifySemanticRoleSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val service = new WorkspaceContextService(null, null, null, null)

  private def field(name: String, dataType: String): DataField =
    DataField(name = name, displayName = name, dataType = dataType, nullable = false)

  private def stats(
      distinctCount: Int,
      distinctCountCapped: Boolean = false,
      exampleValues: Vector[JsValue] = Vector.empty
  ): WorkspaceContextColumnStats =
    WorkspaceContextColumnStats(
      nullRate            = 0.0,
      distinctCount        = distinctCount,
      distinctCountCapped  = distinctCountCapped,
      exampleValues        = exampleValues,
      min                  = None,
      max                  = None,
      mean                 = None
    )

  // ── name-normalization helper (shared by steps 4/5, and reused by
  //    computeJoinHints' grouping key) ─────────────────────────────────────

  "normalizedNameTokens" should {
    "split snake_case names on underscore" in {
      service.normalizedNameTokens("user_id") shouldBe Vector("user", "id")
    }

    "insert a boundary before an uppercase letter following a lowercase/digit (camelCase)" in {
      service.normalizedNameTokens("userId") shouldBe Vector("user", "id")
      service.normalizedNameTokens("createdAt") shouldBe Vector("created", "at")
    }

    "collapse a run of uppercase letters preceded by lowercase into one boundary (UserID)" in {
      service.normalizedNameTokens("UserID") shouldBe Vector("user", "id")
    }

    "produce a single token for a name with no boundary" in {
      service.normalizedNameTokens("guidance") shouldBe Vector("guidance")
    }
  }

  // ── HEL-374 spec.md scenarios ("Deterministic column semantic role") ────

  "classifySemanticRole" should {
    "classify a declared boolean column as boolean" in {
      service.classifySemanticRole(field("is_active", "boolean"), None) shouldBe "boolean"
    }

    "classify a declared timestamp column as temporal" in {
      service.classifySemanticRole(field("created_at", "timestamp"), None) shouldBe "temporal"
    }

    "classify a string column with a date-like name as temporal" in {
      service.classifySemanticRole(field("signup_date", "string"), None) shouldBe "temporal"
    }

    "classify an id-named column as identifier regardless of declared type, even with " +
      "high-cardinality stats exceeding the distinct-count cap" in {
      val userIdStats = stats(distinctCount = 100, distinctCountCapped = true)
      service.classifySemanticRole(field("user_id", "integer"), Some(userIdStats)) shouldBe "identifier"
    }

    "classify a numeric non-id column as measure" in {
      service.classifySemanticRole(field("amount", "float"), None) shouldBe "measure"
    }

    "classify a low-cardinality string column as dimension" in {
      val statusStats = stats(distinctCount = 2, distinctCountCapped = false)
      service.classifySemanticRole(field("status", "string"), Some(statusStats)) shouldBe "dimension"
    }

    "classify a Content-category column as text without inspecting stats" in {
      service.classifySemanticRole(field("notes", "string-body"), None) shouldBe "text"
    }
  }

  // ── design-gate round-1 finding: token-exact, not substring, identifier/
  //    temporal matching (the fix this ticket's orchestrator brief mandates
  //    getting right on first implementation) ──────────────────────────────

  "classifySemanticRole (token-exact false-positive guards)" should {
    "not classify validated/paid/avoid as identifier (no _id/uuid/guid token)" in {
      service.classifySemanticRole(field("validated", "string"), None) should not be "identifier"
      service.classifySemanticRole(field("paid", "string"), None) should not be "identifier"
      service.classifySemanticRole(field("avoid", "string"), None) should not be "identifier"
    }

    "not classify estimated as temporal (no date/time/timestamp/dob token, no trailing _at)" in {
      service.classifySemanticRole(field("estimated", "string"), None) should not be "temporal"
    }

    "not classify guidance/guideline/misguided as identifier (guid is a substring, not a whole token)" in {
      service.classifySemanticRole(field("guidance", "string"), None) should not be "identifier"
      service.classifySemanticRole(field("guideline", "string"), None) should not be "identifier"
      service.classifySemanticRole(field("misguided", "string"), None) should not be "identifier"
    }

    "still classify a genuinely _guid-suffixed camelCase name as identifier" in {
      service.classifySemanticRole(field("extGuid", "string"), None) shouldBe "identifier"
    }

    "classify a bare id/uuid/guid-named column as identifier" in {
      service.classifySemanticRole(field("id", "string"), None) shouldBe "identifier"
      service.classifySemanticRole(field("external_uuid", "string"), None) shouldBe "identifier"
    }
  }

  // ── D1's remaining precedence branches ───────────────────────────────────

  "classifySemanticRole (remaining precedence branches)" should {
    "classify a string column with no columnStats entry as text, not dimension " +
      "(no stats — never confirmed low-cardinality)" in {
      service.classifySemanticRole(field("status", "string"), None) shouldBe "text"
    }

    "classify a string column with distinctCount 0 as text, not dimension " +
      "(the all-empty-snapshot case must not read as confirmed low cardinality)" in {
      service.classifySemanticRole(field("status", "string"), Some(stats(distinctCount = 0))) shouldBe "text"
    }

    "classify a string column with distinctCountCapped true as text even when distinctCount <= threshold" in {
      val capped = stats(distinctCount = 5, distinctCountCapped = true)
      service.classifySemanticRole(field("status", "string"), Some(capped)) shouldBe "text"
    }

    "classify a string column whose distinctCount exceeds the dimension threshold (50) as text" in {
      val highCard = stats(distinctCount = 51, distinctCountCapped = false)
      service.classifySemanticRole(field("status", "string"), Some(highCard)) shouldBe "text"
    }

    "classify an unparseable declared dataType as text" in {
      service.classifySemanticRole(field("mystery", "not-a-real-type"), None) shouldBe "text"
    }
  }
}
