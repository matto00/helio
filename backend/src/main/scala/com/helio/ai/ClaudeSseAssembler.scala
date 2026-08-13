package com.helio.ai

import org.apache.pekko.stream.scaladsl.{Framing, Source}
import org.apache.pekko.util.ByteString
import org.slf4j.LoggerFactory

/** Wires the hand-rolled [[ClaudeSseFrameParser]] into a Pekko stream (design.md D5):
 *  `Framing.delimiter` splits `bytes` on the SSE frame delimiter (`\n\n`), buffering internally
 *  across chunk boundaries — so a frame split mid-write by the network layer still parses
 *  correctly, without any extra handling here — then each delimited frame is parsed and event
 *  kinds this client doesn't model are dropped. Used by `HttpClaudeTransport.stream`, and unit
 *  tested directly against hand-constructed `ByteString` chunks (including deliberately
 *  mid-frame splits) in `ClaudeStreamAssemblySpec`.
 *
 *  D9 (fold-in, post-delivery follow-up A): a failure on `bytes` itself *after* streaming has
 *  already started (e.g. a mid-stream connection drop) — as opposed to a request-initiation
 *  failure, which `HttpClaudeTransport.stream`'s outer `Future.recover` already handles — reaches
 *  this `Source` directly, past where `Future.recover` can see it. `.recover` here converts that
 *  into one terminal `ClaudeStreamEvent.Error` element followed by normal completion, mirroring
 *  D4a's "typed error event, not a thrown exception/unhandled stream failure" contract. Placed
 *  inside `assemble` itself (not `HttpClaudeTransport`'s call site) so this is reachable by
 *  `ClaudeStreamAssemblySpec`'s existing hand-constructed-`Source` test pattern. Never logs the
 *  API key — only the exception. No retry: matches this client's existing non-retrying model. */
object ClaudeSseAssembler {

  private val log = LoggerFactory.getLogger(getClass)

  /** Generous ceiling for a single SSE frame — Anthropic's largest single frame is one
   *  `content_block_delta` text chunk, always far smaller than this. Guards against unbounded
   *  buffering if a delimiter is ever missing entirely. */
  private val MaxFrameBytes = 1024 * 1024

  def assemble[Mat](bytes: Source[ByteString, Mat]): Source[ClaudeStreamEvent, Mat] =
    bytes
      .via(Framing.delimiter(ByteString("\n\n"), maximumFrameLength = MaxFrameBytes, allowTruncation = true))
      .mapConcat(frame => ClaudeSseFrameParser.parse(frame.utf8String).toList)
      .recover { case e: Throwable =>
        log.error("Claude streaming connection failed mid-stream", e)
        ClaudeStreamEvent.Error(ClaudeError.TransportFailure("Streaming connection failed"))
      }
}
