package com.helio.api

object RequestValidation {
  val DefaultDashboardName = "Untitled Dashboard"
  val DefaultPanelTitle = "Untitled Panel"

  def normalizeDashboardName(name: Option[String]): String =
    normalizeText(name, DefaultDashboardName)

  def normalizePanelTitle(title: Option[String]): String =
    normalizeText(title, DefaultPanelTitle)

  private def normalizeText(value: Option[String], defaultValue: String): String =
    value.map(_.trim).filter(_.nonEmpty).getOrElse(defaultValue)
}
