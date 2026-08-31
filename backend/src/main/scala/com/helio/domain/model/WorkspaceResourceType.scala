package com.helio.domain.model

/** Closed, parseable identity for the 4 resource kinds `WorkspaceSearchService.find`/`getResource`
 *  (HEL-661) operate over — mirrors `DataFieldType`'s `fromString`/`asString` pairing (design.md D4),
 *  the codebase's established convention for this exact pattern (also `Role`, `PanelType`,
 *  `Severity`, `Comparator`, `ScheduleKind`, `AlertEventState`), never a bare `String` threaded
 *  through call sites or an `Object.toString` override.
 *
 *  Case objects are nested under this companion (`WorkspaceResourceType.DataSource`, etc.) so they
 *  never collide with the identically-named top-level domain case classes (`DataSource`, `DataType`,
 *  `Dashboard`) also in this package. */
sealed trait WorkspaceResourceType

object WorkspaceResourceType {
  case object DataSource extends WorkspaceResourceType
  case object DataType   extends WorkspaceResourceType
  case object Pipeline   extends WorkspaceResourceType
  case object Dashboard  extends WorkspaceResourceType

  def asString(t: WorkspaceResourceType): String = t match {
    case DataSource => "dataSource"
    case DataType   => "dataType"
    case Pipeline   => "pipeline"
    case Dashboard  => "dashboard"
  }

  /** Reverse of `asString`. Returns `None` for any string that isn't one of the 4 canonical wire
   *  values — parsing Claude's raw tool-call `type`/`resourceTypes` arguments through this and
   *  surfacing an unparseable value as a tool-execution error is HEL-662's responsibility, not this
   *  ticket's (design.md D4). */
  def fromString(s: String): Option[WorkspaceResourceType] = s match {
    case "dataSource" => Some(DataSource)
    case "dataType"   => Some(DataType)
    case "pipeline"   => Some(Pipeline)
    case "dashboard"  => Some(Dashboard)
    case _            => None
  }
}
