package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.ServiceError.StaleTarget

/** Builds the 409 for a stale patch-set apply (HEL-1458). The message names every stale target because the
 *  helio-mcp client forwards only `body.message`, so this is how stale targets reach an MCP caller. */
private[services] object PatchSetStaleMessage {

  def error(stale: Vector[StaleTarget]): ServiceError.PatchSetStale = {
    val named = stale.map(t => s"edit ${t.index} (${t.kind} ${t.id})").mkString(", ")
    ServiceError.PatchSetStale(
      stale,
      s"Nothing was applied: changed since the preview: $named. Preview the patch set again before applying."
    )
  }
}
