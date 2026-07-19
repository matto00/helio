package com.helio.services

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.helio.api.protocols.PanelBatchItem
import com.helio.domain._
import com.helio.domain.panels._
import com.helio.infrastructure.{DataTypeRepository, PanelRepository}
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-311: `PanelService.batchUpdate`'s DB-failure recovery arm must never
 *  echo a raw exception message to the client — it must log the full
 *  exception server-side and return a generic, curated client message.
 *
 *  Uses the same mocked-repository style as `PanelServiceCompanionBindingGuardSpec`
 *  so the DB-failure path is exercised without a real database. */
class PanelServiceBatchUpdateErrorSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now      = Instant.parse("2026-01-01T00:00:00Z")
  private val dashId   = DashboardId("d-1")
  private val meta     = ResourceMeta("u", now, now)
  private val ownerId  = UserId(UUID.randomUUID().toString)
  private val user     = AuthenticatedUser(ownerId)

  private val stubAccess: AccessChecker = new AccessChecker {
    def requireOwnerOnly(rt: String, rid: String, u: AuthenticatedUser, msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
    def requireAccess(rt: String, rid: String, uOpt: Option[AuthenticatedUser], msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
  }

  private def existingPanel(id: String): TextPanel =
    TextPanel(PanelId(id), dashId, "Text", meta, PanelAppearance.Default, ownerId, TextPanelConfig.Empty)

  "PanelService.batchUpdate" should {

    "return a generic client message (no raw exception text) and log the DB failure" in {
      val dtRepo    = mock(classOf[DataTypeRepository])
      val panelRepo = mock(classOf[PanelRepository])
      val item      = PanelBatchItem(id = "p-1", title = None, appearance = None, `type` = None, config = None)

      when(panelRepo.findByIdInternal(PanelId("p-1"))).thenReturn(Future.successful(Some(existingPanel("p-1"))))

      val secret = "leaky-internal-detail-should-not-surface-hel311"
      when(panelRepo.batchUpdate(any[Vector[PanelBatchItem]], any[Instant]))
        .thenReturn(Future.failed(new RuntimeException(secret)))

      val logbackLogger = LoggerFactory.getLogger(classOf[PanelService]).asInstanceOf[LogbackLogger]
      val appender       = new ListAppender[ILoggingEvent]()
      appender.start()
      logbackLogger.addAppender(appender)

      try {
        val result = await(new PanelService(panelRepo, dtRepo, stubAccess).batchUpdate(Vector(item), user))

        result.isLeft shouldBe true
        val message = result.swap.toOption.get.message
        message should not include secret
        message shouldBe "Batch update failed"

        import scala.jdk.CollectionConverters._
        val events = appender.list.asScala.toSeq
        val logged = events.find(e => Option(e.getThrowableProxy).exists(_.getMessage == secret))
        logged shouldBe defined
      } finally {
        logbackLogger.detachAppender(appender)
      }
    }
  }
}
