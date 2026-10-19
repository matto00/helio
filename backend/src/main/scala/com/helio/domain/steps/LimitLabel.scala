package com.helio.domain.steps

/** HEL-1660 (design.md D2): how a limit message names the ceiling it enforces. The draft preview (HEL-1630) and a real run or saved
 *  preview share one set of guards; only the words differ, so each guard takes the label of the context it runs in. `sentence` opens
 *  a sentence, `mid` sits inside one, and `scope` is what the budget belongs to ("what this request has left"). */
final case class LimitLabel(sentence: String, mid: String, scope: String)

object LimitLabel {
  val Draft: LimitLabel = LimitLabel("Draft preview", "draft preview", "request")
  val Run: LimitLabel   = LimitLabel("Pipeline run", "pipeline run", "run")
}
