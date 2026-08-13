package com.helio.ai

import org.apache.pekko.stream.scaladsl.{Framing, Source}
import org.apache.pekko.util.ByteString

/** Wires the hand-rolled [[ClaudeSseFrameParser]] into a Pekko stream (design.md D5):
 *  `Framing.delimiter` splits `bytes` on the SSE frame delimiter (`\n\n`), buffering internally
 *  across chunk boundaries — so a frame split mid-write by the network layer still parses
 *  correctly, without any extra handling here — then each delimited frame is parsed and event
 *  kinds this client doesn't model are dropped. Used by `HttpClaudeTransport.stream`, and unit
 *  tested directly against hand-constructed `ByteString` chunks (including deliberately
 *  mid-frame splits) in `ClaudeStreamAssemblySpec`. */
object ClaudeSseAssembler {

  /** Generous ceiling for a single SSE frame — Anthropic's largest single frame is one
   *  `content_block_delta` text chunk, always far smaller than this. Guards against unbounded
   *  buffering if a delimiter is ever missing entirely. */
  private val MaxFrameBytes = 1024 * 1024

  def assemble[Mat](bytes: Source[ByteString, Mat]): Source[ClaudeStreamEvent, Mat] =
    bytes
      .via(Framing.delimiter(ByteString("\n\n"), maximumFrameLength = MaxFrameBytes, allowTruncation = true))
      .mapConcat(frame => ClaudeSseFrameParser.parse(frame.utf8String).toList)
}
