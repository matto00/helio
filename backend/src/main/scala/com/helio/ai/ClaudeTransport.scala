package com.helio.ai

import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source

import scala.concurrent.Future

/** SPI boundary between [[ClaudeClient]] and the wire transport (design.md D2). Production
 *  implementation: [[HttpClaudeTransport]]. Tests substitute a stub/mock so the automated suite
 *  makes zero real network calls — see design.md D2's rejected alternative (faking the wire via
 *  `pekko-http-testkit` route testing) for why this SPI, not an HTTP-level fake, is the seam. */
trait ClaudeTransport {
  def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]
  def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed]

  /** Tool-use-loop variant of [[send]] (design.md D4). Given a **trait-level default
   *  implementation** — not an abstract member — so the 6 pre-existing `FakeClaudeTransport` test
   *  fakes across the codebase (`ClaudeClientSpec` plus 5 more in `com.helio.api.routes`/
   *  `com.helio.services`, none of which ever call `sendWithTools`) keep compiling untouched;
   *  mirrors `claudeApiRequestFormat.read`'s existing "outbound-only, throws if actually invoked"
   *  pattern in `ClaudeProtocol.scala`. [[HttpClaudeTransport]] overrides this for real. */
  def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] =
    throw new UnsupportedOperationException(
      s"${getClass.getName} does not implement ClaudeTransport.sendTool"
    )
}
