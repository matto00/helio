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
}
