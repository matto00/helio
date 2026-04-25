package com.helio.api

/** Registry of known resource types for ACL enforcement.
 *
 *  The registry is immutable once constructed. Duplicate keys cause an
 *  `IllegalArgumentException` at construction time so misconfiguration is
 *  caught at startup before the server begins accepting requests.
 *
 *  To register a new resource type, add a [[ResourceType]] entry when building
 *  the registry in `ApiRoutes`. No changes to `AclDirective` are required.
 *
 *  Example:
 *  {{{
 *  val registry = ResourceTypeRegistry(
 *    ResourceType("dashboard", id => dashboardRepo.findById(DashboardId(id)).map(_.map(_.ownerId.value))),
 *    ResourceType("report",    id => reportRepo.findById(ReportId(id)).map(_.map(_.ownerId.value)))
 *  )
 *  }}}
 */
class ResourceTypeRegistry(types: ResourceType*) {

  private val typeMap: Map[String, ResourceType] = {
    val keys = types.map(_.key)
    val duplicates = keys.groupBy(identity).collect { case (k, vs) if vs.size > 1 => k }
    if (duplicates.nonEmpty)
      throw new IllegalArgumentException(
        s"Duplicate resource type keys: ${duplicates.mkString(", ")}"
      )
    types.map(rt => rt.key -> rt).toMap
  }

  /** Look up a registered [[ResourceType]] by its key.
   *
   *  @param key The resource type key (e.g. `"dashboard"`).
   *  @return    `Some(ResourceType)` if registered, `None` otherwise.
   */
  def lookup(key: String): Option[ResourceType] = typeMap.get(key)
}
