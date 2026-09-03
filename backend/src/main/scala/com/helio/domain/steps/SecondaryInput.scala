package com.helio.domain.steps

import spray.json._

/** HEL-911 (design.md Decisions 1/1a/1b): the discriminated secondary input shared by
 *  `join` / `union` / `lookup`. Replaces each op's flat `rightDataSourceId` /
 *  `otherDataSourceId` / `referenceDataSourceId` field with one of:
 *
 *    - `Source(dataSourceId)` -- resolves a caller-owned `DataSource`, exactly today's
 *      behaviour (an empty `dataSourceId` is a legal incomplete draft, HEL-950).
 *    - `Lane(stepId)` -- resolves another node's already-evaluated frame within the SAME
 *      pipeline (design.md Engine contract items 6/6a), never a `DataSource` lookup.
 *
 *  There is deliberately no third, legacy-flat-field case: Decision 1a makes that shape a
 *  hard, named decode error (see [[decodeStrict]]), not a silently-tolerated one. */
sealed trait SecondaryInput

object SecondaryInput {
  final case class Source(dataSourceId: String) extends SecondaryInput
  final case class Lane(stepId: String) extends SecondaryInput

  /** Decision 1b: the tolerant default for an ABSENT `secondaryInput` key -- an
   *  unconfigured second input, the same incomplete-draft state HEL-950 already blesses
   *  for an empty `dataSourceId`. */
  val Default: SecondaryInput = Source("")

  implicit val format: RootJsonFormat[SecondaryInput] = new RootJsonFormat[SecondaryInput] {
    def write(si: SecondaryInput): JsValue = si match {
      case Source(id) => JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(id))
      case Lane(id)   => JsObject("kind" -> JsString("lane"), "stepId" -> JsString(id))
    }

    def read(json: JsValue): SecondaryInput = json match {
      case obj: JsObject =>
        obj.fields.get("kind") match {
          case Some(JsString("source")) =>
            obj.fields.get("dataSourceId") match {
              case Some(JsString(id)) => Source(id)
              case _ =>
                throw new StepConfigTypeMismatch(
                  "'secondaryInput' with kind 'source' requires a string 'dataSourceId'."
                )
            }
          case Some(JsString("lane")) =>
            obj.fields.get("stepId") match {
              case Some(JsString(id)) => Lane(id)
              case _ =>
                throw new StepConfigTypeMismatch(
                  "'secondaryInput' with kind 'lane' requires a string 'stepId'."
                )
            }
          case Some(JsString(other)) =>
            throw new StepConfigTypeMismatch(
              s"'secondaryInput.kind' must be 'source' or 'lane', got '$other'."
            )
          case _ =>
            throw new StepConfigTypeMismatch(
              "'secondaryInput' requires a string 'kind' of 'source' or 'lane'."
            )
        }
      case other =>
        throw new StepConfigTypeMismatch(
          s"'secondaryInput' must be an object, got ${other.getClass.getSimpleName}."
        )
    }
  }

  /** Strict decode of a step's `secondaryInput` config key from its already-parsed raw
   *  `JsObject`, per Decisions 1a/1b:
   *
   *    - the LEGACY FLAT field (`legacyFieldName`, e.g. `"otherDataSourceId"`) being
   *      PRESENT at all is a hard, named error -- independent of whether
   *      `secondaryInput` is also present. This is what "no legacy read path" means.
   *    - `secondaryInput` ABSENT (or explicitly `null`) decodes to [[Default]] -- the
   *      tolerant incomplete-draft default `pipeline-step-config-read-strictness`
   *      requires (Decision 1b).
   *    - `secondaryInput` PRESENT but malformed (unrecognised `kind`, `kind` paired
   *      with the wrong field, wrong JSON type) raises via [[format]]'s reader. */
  def decodeStrict(obj: JsObject, legacyFieldName: String): SecondaryInput = {
    if (obj.fields.contains(legacyFieldName))
      throw new StepConfigTypeMismatch(
        s"'$legacyFieldName' is no longer a valid config field. Use 'secondaryInput': " +
          "{\"kind\":\"source\",\"dataSourceId\":<id>} or {\"kind\":\"lane\",\"stepId\":<id>}."
      )
    obj.fields.get("secondaryInput") match {
      case None | Some(JsNull) => Default
      case Some(v)             => format.read(v)
    }
  }
}
