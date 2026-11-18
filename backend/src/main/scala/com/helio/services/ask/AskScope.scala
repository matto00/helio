package com.helio.services.ask

import com.helio.domain.panels.OutputPanel

/** HEL-1745 D1: what one ask is about. The id is the route's, never a model-supplied value. */
sealed trait AskScope { def id: String }

object AskScope {
  final case class DashboardScope(id: String) extends AskScope
  final case class OutputScope(id: String)    extends AskScope
}

/** One Output in scope and the panels (in panel order) that bind it; no panels on the Output path. */
final case class ScopedOutput(outputId: String, panels: Vector[OutputPanel])

/** The in-scope set as of ONE call. Never cached: every tool call resolves a fresh one (D4). */
final case class ScopeSnapshot(outputs: Vector[ScopedOutput]) {
  def find(outputId: String): Option[ScopedOutput] = outputs.find(_.outputId == outputId)
}
