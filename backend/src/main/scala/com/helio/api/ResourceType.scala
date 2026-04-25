package com.helio.api

import scala.concurrent.Future

/** Describes a registered resource type for ACL enforcement.
 *
 *  @param key           String key used in `resource_permissions.resource_type` (e.g. `"dashboard"`, `"panel"`).
 *  @param ownerResolver Function that resolves the owner user ID for a given resource ID.
 *                       Returns `None` if the resource does not exist.
 */
case class ResourceType(
    key: String,
    ownerResolver: String => Future[Option[String]]
)
