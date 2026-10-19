package com.helio.testsupport

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.engine.{InProcessPipelineEngine, NodeKey, TreeWalkResult}
import com.helio.domain.model.{AuthenticatedUser, AssertionSink, PipelineExecutionContext, PipelineId, PipelineRootId, PipelineStep, PipelineStepId, TruncationSink, WriteBackSink}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.draftpreview.{DraftPreviewConfig, DraftPreviewService}
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader, `Retry-After`}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, HttpRequest, HttpResponse, StatusCodes}
import org.apache.pekko.stream.scaladsl.{Framing, Sink}
import org.apache.pekko.util.ByteString
import org.slf4j.{LoggerFactory, Logger => Slf4jLogger}
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import java.util.concurrent.atomic.{AtomicInteger, AtomicReference}
import java.util.concurrent.{CountDownLatch, TimeUnit}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1630: shared plumbing for the specs that need a REAL connection (the route testkit cannot abort or trickle a body): a bound
 *  server, a step-evaluation spy around every step the engine runs, a hold hook after node 1, and the service's own log lines.
 *  Subclasses pick the [[draftPreviewConfig]] they are testing. */
abstract class DraftPreviewBoundFixture extends DraftPreviewApiFixture {

  protected val evaluated = new AtomicInteger(0)

  /** Makes the second node evaluated take this long (a node that is mid-flight when the client goes). */
  @volatile protected var nodeDelayMs: Long = 0L

  /** `Some(latch)`: hold after node 1 until the latch opens. `None` with `holdUntilCancelled`: hold until the stream is cancelled. */
  @volatile protected var holdLatch: Option[CountDownLatch] = None
  @volatile protected var holdUntilCancelled                = false
  @volatile protected var heldByCancel                      = false
  protected val holding                                     = new AtomicReference[CountDownLatch](new CountDownLatch(1))

  override protected def draftPreviewAfterNode: DraftPreviewService.NodeHook = (n, cancelled) =>
    if (n == 1) {
      holding.get.countDown()
      holdLatch.foreach(_.await(10, TimeUnit.SECONDS))
      if (holdUntilCancelled) {
        val deadline = System.nanoTime() + 5.seconds.toNanos
        while (!cancelled() && System.nanoTime() < deadline) Thread.sleep(5)
        heldByCancel = cancelled()
      }
    }

  /** `Some(latch)`: every draft-preview access check waits for the latch before answering, so `service.start` stays pending for as
   *  long as the test wants (a deterministic window for a client reset, instead of a sleep). */
  @volatile protected var accessCheckHold: Option[CountDownLatch] = None

  override protected def pipelineRepoFor(ctx: DbContext, dataSourceRepo: DataSourceRepository)(implicit ec: ExecutionContext): PipelineRepository =
    new PipelineRepository(ctx, dataSourceRepo)(ec) {
      override def checkPreviewAccessInternal(id: PipelineId, user: AuthenticatedUser, requireEditor: Boolean) =
        accessCheckHold match {
          case Some(latch) => Future(latch.await(10, TimeUnit.SECONDS))(ec).flatMap(_ => super.checkPreviewAccessInternal(id, user, requireEditor))(ec)
          case None        => super.checkPreviewAccessInternal(id, user, requireEditor)
        }
    }

  private final class CountingStep(inner: PipelineStep) extends PipelineStep {
    def id: PipelineStepId                 = inner.id
    def pipelineId: PipelineId             = inner.pipelineId
    def position: Int                      = inner.position
    def kind: String                       = inner.kind
    def createdAt: Instant                 = inner.createdAt
    def updatedAt: Instant                 = inner.updatedAt
    def enabled: Boolean                   = inner.enabled
    def parentStepId: Option[PipelineStepId] = inner.parentStepId
    def configValue: Any                   = inner.configValue
    def evaluate(rows: Seq[Row], ctx: PipelineExecutionContext)(implicit ec: ExecutionContext): Future[Seq[Row]] = {
      if (evaluated.incrementAndGet() == 2) Thread.sleep(nodeDelayMs)
      inner.evaluate(rows, ctx)
    }
  }

  private final class SpyEngine(implicit ec: ExecutionContext) extends InProcessPipelineEngine(new LocalFileSystem(Paths.get("/"))) {
    override def executeTree(
        rootFrames: Vector[(String, Seq[Row])], steps: Vector[PipelineStep], stepRepo: PipelineStepRepository,
        rootIdOfStep: Map[PipelineStepId, PipelineRootId], dataSourceRepo: DataSourceRepository, assertionSink: AssertionSink,
        truncationSink: TruncationSink, onNodeProgress: (NodeKey, Long) => Unit, writeBackSink: WriteBackSink, ownerUserId: Option[String],
        contextTransform: PipelineExecutionContext => PipelineExecutionContext, externalLanes: Map[String, Seq[Row]],
        onNodeFrame: (NodeKey, Seq[Row]) => Unit, onNodeError: Option[(PipelineStep, Throwable) => Unit], shouldContinue: () => Boolean,
        retainOnly: Option[Set[NodeKey]], leafFirst: Boolean, runRetention: Boolean
    ): Future[TreeWalkResult] =
      super.executeTree(rootFrames, steps.map(s => new CountingStep(s)), stepRepo, rootIdOfStep, dataSourceRepo, assertionSink, truncationSink,
        onNodeProgress, writeBackSink, ownerUserId, contextTransform, externalLanes, onNodeFrame, onNodeError, shouldContinue, retainOnly, leafFirst, runRetention)
  }

  override protected def draftPreviewEngine(implicit ec: ExecutionContext): Option[InProcessPipelineEngine] = Some(new SpyEngine)

  private val log = LoggerFactory.getLogger(Slf4jLogger.ROOT_LOGGER_NAME).asInstanceOf[Logger]
  protected val captured = new ListAppender[ILoggingEvent]()

  override def beforeAll(): Unit = { super.beforeAll(); captured.start(); log.addAppender(captured) }
  override def afterAll(): Unit  = { log.detachAppender(captured); captured.stop(); super.afterAll() }

  private lazy val binding = Await.result(Http().newServerAt("127.0.0.1", 0).bind(routes), 10.seconds)
  protected def url(seed: DraftSaveSeed) = s"http://127.0.0.1:${binding.localAddress.getPort}/api/pipelines/${seed.pipeline}/draft-preview"

  protected def post(seed: DraftSaveSeed, user: String, body: JsObject): Future[HttpResponse] =
    Http().singleRequest(
      HttpRequest(HttpMethods.POST, url(seed), entity = HttpEntity(ContentTypes.`application/json`, body.compactPrint))
        .addHeader(Cookie(SessionCookies.Name -> tokenOf(user))).addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))
    )


  /** A request whose body is held back: the head and the first half of the body are written now (over a raw socket, so no client
   *  pool can reorder or serialise several of them), [[finish]] writes the rest and returns the whole response text. */
  protected final class SlowPost(seed: DraftSaveSeed, user: String, body: JsObject) {
    private val bytes = body.compactPrint.getBytes("UTF-8")
    private val socket = new java.net.Socket("127.0.0.1", binding.localAddress.getPort)
    private val out    = socket.getOutputStream
    out.write(
      (s"POST /api/pipelines/${seed.pipeline}/draft-preview HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${bytes.length}\r\n" +
        s"Cookie: ${SessionCookies.Name}=${tokenOf(user)}\r\n${AuthDirectives.CsrfHeaderName}: ${AuthDirectives.CsrfHeaderValue}\r\nConnection: close\r\n\r\n").getBytes("UTF-8")
    )
    out.write(bytes, 0, bytes.length / 2)
    out.flush()

    def finish(): String = {
      out.write(bytes, bytes.length / 2, bytes.length - bytes.length / 2)
      out.flush()
      socket.setSoTimeout(15000)
      val text = new String(socket.getInputStream.readAllBytes(), "UTF-8")
      socket.close()
      text
    }
  }

  protected def firstLine(r: HttpResponse): JsObject =
    Await.result(r.entity.dataBytes.via(Framing.delimiter(ByteString("\n"), 1024 * 1024)).take(1).runWith(Sink.head), 10.seconds).utf8String.parseJson.asJsObject

  protected def outcomes(): Vector[String] = captured.list.asScala.map(_.getFormattedMessage).filter(_.startsWith("draft-preview")).toVector

  protected def awaitOutcome(pipeline: String): String = {
    val deadline = System.nanoTime() + 10.seconds.toNanos
    while (System.nanoTime() < deadline) {
      outcomes().find(l => l.contains(s"pipeline=$pipeline ") && l.contains("outcome=")).foreach(return _)
      Thread.sleep(20)
    }
    fail(s"no outcome logged for $pipeline; saw ${outcomes()}")
  }

}
