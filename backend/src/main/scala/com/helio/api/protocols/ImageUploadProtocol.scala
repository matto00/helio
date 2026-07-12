package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** Response shape for `POST /api/uploads/image` (HEL-246). `url` is always
 *  `/api/uploads/image/<id>` — a root-relative path so a plain `<img src>`
 *  can load it without carrying the Bearer token the rest of the API uses. */
final case class ImageUploadResponse(id: String, url: String)

trait ImageUploadProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val imageUploadResponseFormat: RootJsonFormat[ImageUploadResponse] = jsonFormat2(ImageUploadResponse.apply)
}
