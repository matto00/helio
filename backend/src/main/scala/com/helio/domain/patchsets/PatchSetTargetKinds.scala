package com.helio.domain.patchsets

/** The single backend source of the patch-set `target.kind` set (HEL-1459): the request decoder, the
 *  `propose_patch_set` tool schema and description, and the refinement prompt skeleton all read it,
 *  and `PatchSetTargetKindsSchemaGuardSpec` pins it to every `schemas/patch-sets/` kind enum, the
 *  frontend `PATCH_SET_TARGET_KINDS` and the MCP const. */
object PatchSetTargetKinds {

  /** Every accepted `target.kind`, in schema order. */
  val All: Vector[String] = Vector("panel", "dashboard", "dataSource", "pipeline", "pipelineStep", "output")

  val AllSet: Set[String] = All.toSet

  /** "panel, dashboard, ..." for error messages. */
  val AllList: String = All.mkString(", ")

  /** "panel/dashboard/..." for tool-description prose. */
  val AllSlashed: String = All.mkString("/")

  /** "panel | dashboard | ..." for the refinement prompt's shape skeleton. */
  val AllPiped: String = All.mkString(" | ")
}
