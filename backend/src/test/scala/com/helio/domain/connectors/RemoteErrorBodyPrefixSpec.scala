package com.helio.domain.connectors

import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicLong
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Promise}

/** HEL-1877: the bounded prefix read. An infinite counting source proves how many bytes were pulled and that the
 *  upstream was cancelled (which closes the HTTP connection). */
class RemoteErrorBodyPrefixSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val system: ActorSystem = ActorSystem("remote-error-body-prefix-spec")
  private implicit val ec: ExecutionContext = system.dispatcher

  override def afterAll(): Unit = {
    Await.ready(system.terminate(), 10.seconds)
    super.afterAll()
  }

  private val Chunk = 256

  "RemoteErrorText.MaxBodyBytes" should {
    "leave room for 500 four-byte code points plus three bytes of decoder lookahead" in {
      // Asserted here, deliberately not by a `require`: a `require` would fail at object initialisation under a
      // mutation of the constant and prove nothing.
      RemoteErrorText.MaxBodyBytes should be >= 4 * RemoteErrorText.MaxCodePoints + 4
    }
  }

  "RemoteErrorText.readBodyPrefix" should {
    "pull a bounded number of bytes from an infinite source, cancel it, and return exactly the limit" in {
      val pulled    = new AtomicLong()
      val cancelled = Promise[Unit]()
      val source = Source
        .repeat(ByteString("y" * Chunk))
        .map { c => pulled.addAndGet(c.length.toLong); c }
        .watchTermination() { (m, done) => done.onComplete(_ => cancelled.trySuccess(())); m } // an infinite source ends only by cancellation
      val prefix = Await.result(RemoteErrorText.readBodyPrefix(source, 4096, 30.seconds), 15.seconds)
      info(s"bytes pulled from the infinite source: ${pulled.get}")
      prefix.length shouldBe 4096
      prefix.utf8String shouldBe "y" * 4096
      pulled.get should be <= (4096L + 4 * Chunk)
      Await.result(cancelled.future, 5.seconds) shouldBe (())
    }
    "return a short body whole" in {
      val prefix = Await.result(RemoteErrorText.readBodyPrefix(Source(List(ByteString("ab"), ByteString("cd"))), 4096, 30.seconds), 5.seconds)
      prefix.utf8String shouldBe "abcd"
    }
    "return an empty body as empty" in {
      Await.result(RemoteErrorText.readBodyPrefix(Source.empty[ByteString], 4096, 30.seconds), 5.seconds) shouldBe ByteString.empty
    }
    "fail when the body is slower than the timeout" in {
      val slow = Source.repeat(ByteString("z")).throttle(1, 1.second)
      a[TimeoutException] should be thrownBy
        Await.result(RemoteErrorText.readBodyPrefix(slow, 4096, 300.millis), 5.seconds)
    }
  }
}
