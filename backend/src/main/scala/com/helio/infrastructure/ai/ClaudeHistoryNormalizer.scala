package com.helio.infrastructure.ai

import spray.json.JsValue

/** Pure request-shaping rules for HEL-1636 (design D3a, D5): no request the client sends may carry
 *  an empty text block or an empty message, and a thinking block is never sent in a message the
 *  client had to alter (the API binds a thinking block to the exact messages it was produced
 *  after, so a partly edited signed message would 400). */
/** One hop's outbound request plus the history it was built from (post strip-point rewrite) and its
 *  serialized `tools`, which the next hop compares against (design.md D3a). */
private[ai] final case class PreparedHop(apiRequest: ClaudeApiToolRequest, history: Seq[ClaudeToolMessage], toolsJson: JsValue)

private[ai] object ClaudeHistoryNormalizer {

  private def isThinking(b: ClaudeContentBlock): Boolean = b match {
    case _: ClaudeContentBlock.Thinking | _: ClaudeContentBlock.RedactedThinking => true
    case _                                                                       => false
  }

  private def isBlankText(b: ClaudeContentBlock): Boolean = b match {
    case ClaudeContentBlock.Text(t) => ClaudeContentBlock.isBlankText(t)
    case _                          => false
  }

  /** D3a `stripAllThinking`: removes every thinking / redacted-thinking block, keeping every
   *  message (so the caller's turn count never changes). Opaque blocks are not signed; they stay. */
  def stripAllThinking(history: Seq[ClaudeToolMessage]): Seq[ClaudeToolMessage] =
    history.map(m => m.copy(content = m.content.filterNot(isThinking)))

  /** D5: drops blank text blocks, drops messages left with no blocks, and merges the same-role
   *  neighbours that creates. The Boolean is true when this altered a message that holds a
   *  thinking block (a blank text beside it, or a merge with it), which is a D3a strip point. */
  def normalise(history: Seq[ClaudeToolMessage]): (Seq[ClaudeToolMessage], Boolean) = {
    var alteredThinking = false
    val kept = Vector.newBuilder[ClaudeToolMessage]
    var last: Option[ClaudeToolMessage] = None
    def flush(): Unit = last.foreach(kept += _)
    history.foreach { m =>
      val cleaned = m.content.filterNot(isBlankText)
      if (cleaned.size != m.content.size && m.content.exists(isThinking)) alteredThinking = true
      if (cleaned.nonEmpty) {
        last match {
          case Some(prev) if prev.role == m.role =>
            if (prev.content.exists(isThinking) || cleaned.exists(isThinking)) alteredThinking = true
            last = Some(prev.copy(content = prev.content ++ cleaned))
          case _ =>
            flush()
            last = Some(m.copy(content = cleaned))
        }
      }
    }
    flush()
    (kept.result(), alteredThinking)
  }

  /** D5 for the string-content `send`/`stream` request: drops blank messages and joins same-role
   *  neighbours with a blank line. */
  def normaliseText(messages: Seq[ClaudeMessage]): Seq[ClaudeMessage] =
    messages.filterNot(m => ClaudeContentBlock.isBlankText(m.content)).foldLeft(Vector.empty[ClaudeMessage]) {
      case (acc, m) if acc.lastOption.exists(_.role == m.role) =>
        acc.init :+ acc.last.copy(content = acc.last.content + "\n\n" + m.content)
      case (acc, m) => acc :+ m
    }
}
