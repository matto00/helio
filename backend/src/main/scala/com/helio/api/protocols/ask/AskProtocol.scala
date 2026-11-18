package com.helio.api.protocols.ask

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** HEL-1745: wire shapes of `POST /api/dashboards/:id/ask` and `POST /api/outputs/:id/ask`. The response carries no
 *  model id, token count or cost, for any tier. */
final case class AskQuestionRequest(question: String)

/** One citation the answer uses; `date`/`capturedAt` are ISO-8601 instants. */
final case class AskCitation(
    id: String,
    outputId: String,
    field: String,
    number: Option[Double],
    date: Option[String],
    capturedAt: Option[String],
    isPct: Boolean
)

final case class AskCitedOutput(id: String, name: String)

/** The hand-off to create an insight Output from the answer: `request` is a `POST /api/pipelines/:pipelineId/outputs`
 *  body. It holds the question and the cited Output ids only, never answer text. */
final case class AskPin(pipelineId: String, request: JsObject)

final case class AskQuestionResponse(answer: String, citations: Vector[AskCitation], citedOutputs: Vector[AskCitedOutput], pin: Option[AskPin])

/** `422` body when the answer could not be grounded in the data the tools returned. */
final case class AskUngroundedResponse(message: String, code: String, reasons: Vector[String])

/** `422` body when a model hop ran out of output tokens before it finished. */
final case class AskTruncatedResponse(message: String, code: String)

trait AskProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val askQuestionRequestFormat: RootJsonFormat[AskQuestionRequest] = jsonFormat1(AskQuestionRequest.apply)
  implicit val askCitationFormat: RootJsonFormat[AskCitation]                = jsonFormat7(AskCitation.apply)
  implicit val askCitedOutputFormat: RootJsonFormat[AskCitedOutput]          = jsonFormat2(AskCitedOutput.apply)
  implicit val askPinFormat: RootJsonFormat[AskPin]                          = jsonFormat2(AskPin.apply)
  implicit val askUngroundedResponseFormat: RootJsonFormat[AskUngroundedResponse] = jsonFormat3(AskUngroundedResponse.apply)

  implicit val askTruncatedResponseFormat: RootJsonFormat[AskTruncatedResponse] = jsonFormat2(AskTruncatedResponse.apply)

  /** `pin` is written as an explicit `null` when absent (the contract says `null`, not a missing key). */
  implicit val askQuestionResponseFormat: RootJsonFormat[AskQuestionResponse] = new RootJsonFormat[AskQuestionResponse] {
    def write(r: AskQuestionResponse): JsValue =
      JsObject(
        "answer"       -> JsString(r.answer),
        "citations"    -> r.citations.toJson,
        "citedOutputs" -> r.citedOutputs.toJson,
        "pin"          -> r.pin.map(_.toJson).getOrElse(JsNull)
      )

    def read(json: JsValue): AskQuestionResponse = {
      val f = json.asJsObject.fields
      AskQuestionResponse(
        f("answer").convertTo[String],
        f("citations").convertTo[Vector[AskCitation]],
        f("citedOutputs").convertTo[Vector[AskCitedOutput]],
        f.get("pin").filter(_ != JsNull).map(_.convertTo[AskPin])
      )
    }
  }
}
