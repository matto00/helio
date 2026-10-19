package com.helio.services.pipelines

import com.helio.domain.engine.{NodeKey, RootKey, StepKey}
import com.helio.domain.model.Output

/** The node an Output is bound to, as the key the tree walk files that node's frame under. The ONE mapping the run's snapshot and
 *  alert writes and the run's pre-execution `retain` set share, so the frames the walk keeps are exactly the frames the writes read.
 *
 *  HEL-913 (design.md R12): a root-bound Output (`stepId = None`) keys on its OWN `RootKey(rootId)`, never a bare `None` that would
 *  ambiguously match any root. An Output with neither (a pre-V98 legacy shape) maps to `None` and is skipped, not guessed at. */
private[pipelines] object OutputNodeKeys {
  def of(output: Output): Option[NodeKey] = output.node.stepId match {
    case Some(sid) => Some(StepKey(sid.value))
    case None      => output.node.rootId.map(rid => RootKey(rid.value))
  }
}
