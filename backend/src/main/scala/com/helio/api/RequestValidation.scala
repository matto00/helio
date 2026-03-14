package com.helio.api

object RequestValidation {
  val DefaultDashboardName = "Untitled Dashboard"
  val DefaultPanelTitle = "Untitled Panel"
  val DefaultDashboardBackground = "transparent"
  val DefaultDashboardGridBackground = "transparent"
  val DefaultPanelBackground = "transparent"
  val DefaultPanelColor = "inherit"
  val MinTransparency = 0.0
  val MaxTransparency = 1.0

  def normalizeDashboardName(name: Option[String]): String =
    normalizeText(name, DefaultDashboardName)

  def normalizePanelTitle(title: Option[String]): String =
    normalizeText(title, DefaultPanelTitle)

  def normalizeDashboardBackground(background: Option[String]): String =
    normalizeText(background, DefaultDashboardBackground)

  def normalizeDashboardGridBackground(background: Option[String]): String =
    normalizeText(background, DefaultDashboardGridBackground)

  def normalizePanelBackground(background: Option[String]): String =
    normalizeText(background, DefaultPanelBackground)

  def normalizePanelColor(color: Option[String]): String =
    normalizeText(color, DefaultPanelColor)

  def normalizeTransparency(transparency: Option[Double]): Double =
    transparency
      .map(value => math.max(MinTransparency, math.min(MaxTransparency, value)))
      .getOrElse(MinTransparency)

  private def normalizeText(value: Option[String], defaultValue: String): String =
    value.map(_.trim).filter(_.nonEmpty).getOrElse(defaultValue)
}
