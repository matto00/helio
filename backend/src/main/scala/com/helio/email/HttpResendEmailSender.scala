package com.helio.email

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.http.scaladsl.settings.{ClientConnectionSettings, ConnectionPoolSettings}
import org.apache.pekko.stream.Materializer
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

/** Production [[EmailSender]] (design.md D6) -- mirrors `com.helio.ai.HttpClaudeTransport`'s
 *  `Http(system).singleRequest` + `ConnectionPoolSettings`-with-timeouts shape.
 *
 *  Never logs `config.apiKey`: it is placed only on the outbound `Authorization` header and is
 *  never interpolated into a log statement, request-object `toString`, or thrown exception
 *  message anywhere in this class (owner-notification-email spec's "API key never appears in
 *  logs" requirement). */
class HttpResendEmailSender(config: EmailConfig)(implicit system: ActorSystem[_]) extends EmailSender {
  import HttpResendEmailSender._

  private val log = LoggerFactory.getLogger(getClass)

  private implicit val ec: ExecutionContext = system.executionContext
  private implicit val mat: Materializer    = Materializer(system)

  private val poolSettings: ConnectionPoolSettings =
    ConnectionPoolSettings(system.classicSystem)
      .withConnectionSettings(
        ClientConnectionSettings(system.classicSystem)
          .withConnectingTimeout(10.seconds)
          .withIdleTimeout(60.seconds)
      )

  /** `private[email]`, not `private` -- mirrors `HttpClaudeTransport.buildHttpRequest`'s exact
   *  reasoning: `HttpResendEmailSenderSpec` asserts on the serialized request shape (URL, bearer
   *  header, JSON body) directly, without ever making a real HTTP call. */
  private[email] def buildHttpRequest(to: Seq[String], subject: String, text: String): HttpRequest =
    HttpRequest(
      method = HttpMethods.POST,
      uri = EmailsUri,
      headers = List(RawHeader("Authorization", s"Bearer ${config.apiKey}")),
      entity = HttpEntity(
        ContentTypes.`application/json`,
        JsObject(
          "from"    -> JsString(config.from),
          "to"      -> JsArray(to.map(JsString(_)).toVector),
          "subject" -> JsString(subject),
          "text"    -> JsString(text)
        ).compactPrint
      )
    )

  override def send(to: Seq[String], subject: String, text: String): Future[Either[String, Unit]] =
    Http(system.classicSystem)
      .singleRequest(buildHttpRequest(to, subject, text), settings = poolSettings)
      .flatMap { response =>
        response.entity.toStrict(ResponseReadTimeout).map { _ =>
          if (response.status.isSuccess()) {
            Right(())
          } else {
            log.warn("Resend API rejected email send: status={}", response.status.intValue())
            Left(s"Email provider rejected the request (status ${response.status.intValue()})")
          }
        }
      }
      .recover { case e =>
        log.error("Resend API send failed", e)
        Left("Email provider request failed")
      }
}

object HttpResendEmailSender {
  private val EmailsUri: Uri      = Uri("https://api.resend.com/emails")
  private val ResponseReadTimeout = 30.seconds
}
