package com.helio.services.dashboards

/** The refusal texts for a dashboard action the caller's role does not allow (HEL-1785). The status stays `403`
 *  everywhere (a `ServiceError.Forbidden`); only the message names the reason, so the assistant and an MCP client can
 *  tell a model or a user why, instead of a bare "Forbidden". One place so the REST routes and the patch-set resolvers
 *  never drift. */
object DashboardAccessMessages {

  /** A `viewer` grantee attempting any edit of the dashboard or its panels. */
  val ViewOnly: String = "You have view-only access to this dashboard"

  /** Anyone but the owner attempting to delete the dashboard (an `editor` included). */
  val OwnerOnlyDelete: String = "Only the dashboard's owner can delete it"
}
