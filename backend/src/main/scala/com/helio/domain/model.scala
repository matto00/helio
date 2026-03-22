package com.helio.domain

import java.time.Instant

final case class DashboardId(value: String) extends AnyVal
final case class PanelId(value: String) extends AnyVal

sealed trait PanelType
object PanelType {
  case object Metric extends PanelType
  case object Chart  extends PanelType
  case object Text   extends PanelType
  case object Table  extends PanelType

  val Default: PanelType = Metric

  def fromString(s: String): Either[String, PanelType] = s match {
    case "metric" => Right(Metric)
    case "chart"  => Right(Chart)
    case "text"   => Right(Text)
    case "table"  => Right(Table)
    case other    => Left(s"Unknown panel type: '$other'. Valid values: metric, chart, text, table")
  }

  def asString(t: PanelType): String = t match {
    case Metric => "metric"
    case Chart  => "chart"
    case Text   => "text"
    case Table  => "table"
  }
}
final case class ResourceMeta(createdBy: String, createdAt: Instant, lastUpdated: Instant)
final case class DashboardAppearance(background: String, gridBackground: String)
final case class PanelAppearance(background: String, color: String, transparency: Double)
final case class DashboardLayoutItem(panelId: PanelId, x: Int, y: Int, w: Int, h: Int)
final case class DashboardLayout(
    lg: Vector[DashboardLayoutItem],
    md: Vector[DashboardLayoutItem],
    sm: Vector[DashboardLayoutItem],
    xs: Vector[DashboardLayoutItem]
)

object DashboardAppearance {
  val Default: DashboardAppearance = DashboardAppearance(
    background = "transparent",
    gridBackground = "transparent"
  )
}

object DashboardLayout {
  val Default: DashboardLayout = DashboardLayout(
    lg = Vector.empty,
    md = Vector.empty,
    sm = Vector.empty,
    xs = Vector.empty
  )
}

object PanelAppearance {
  val Default: PanelAppearance = PanelAppearance(
    background = "transparent",
    color = "inherit",
    transparency = 0.0
  )
}

final case class Dashboard(
    id: DashboardId,
    name: String,
    meta: ResourceMeta,
    appearance: DashboardAppearance,
    layout: DashboardLayout
)
final case class Panel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    panelType: PanelType
)
