package com.helio.domain.history

import spray.json.{JsBoolean, JsNull, JsObject}

/** `outputs.config.historyPayloads` (HEL-1276, owner ruling Q2): the opt-in for storing a node's full
 *  row payload with each history point. Absent, `null` and `false` mean off; any non-boolean is a
 *  validation error. Pure; no I/O. */
object PayloadOptIn {

  private val Expected = "historyPayloads must be a boolean (true to store each run's full rows, false or omitted to store none)"

  def validateConfig(config: JsObject): Either[String, Unit] =
    config.fields.get("historyPayloads") match {
      case None | Some(JsNull) | Some(JsBoolean(_)) => Right(())
      case Some(_)                                  => Left(Expected)
    }

  /** True only for an explicit JSON `true`. */
  def enabled(config: JsObject): Boolean = config.fields.get("historyPayloads").contains(JsBoolean(true))
}
