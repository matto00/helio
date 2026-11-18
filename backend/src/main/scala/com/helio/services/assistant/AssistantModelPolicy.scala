package com.helio.services.assistant

import com.helio.infrastructure.ai.{ClaudeModelCatalog, ClaudeModelSpec}

/** HEL-1755 D3/D8: the one place the "which model does this turn use" rules live, so the routes, the picker's
 *  list endpoint and the converse path can never disagree.
 *
 *  `serverDefault` is `CLAUDE_MODEL`. It may be catalog-defined (then it has rules and a weight even when narrowed
 *  out of the selectable set) or not (the code default `claude-opus-4-8`: operator config, today's behaviour,
 *  weight 1). */
final class AssistantModelPolicy(val catalog: ClaudeModelCatalog, val serverDefault: String) {

  /** A client-supplied id against the allow-list: the catalog spec, or the 400 message. */
  def validate(id: String): Either[String, ClaudeModelSpec] =
    catalog.select(id).toRight(s"Unknown model '$id'; choose one of: ${catalog.selectable.map(_.id).mkString(", ")}")

  /** The default for a NEW conversation: the user's default if still selectable, else the server default. */
  def defaultFor(userDefault: Option[String]): String =
    userDefault.filter(catalog.isSelectable).getOrElse(serverDefault)

  /** stored model if still selectable > user default if still selectable > server default. */
  def effective(stored: Option[String], userDefault: Option[String]): String =
    stored.filter(catalog.isSelectable).getOrElse(defaultFor(userDefault))

  /** The spec to send for a resolved id: its catalog definition (rules apply), else `None` = `config.model`. */
  def specFor(resolvedId: String): Option[ClaudeModelSpec] = catalog.definition(resolvedId)

  def weightOf(resolvedId: String): Int = catalog.weightOf(resolvedId)

  def labelOf(id: String): Option[String] = catalog.labelOf(id)
}
