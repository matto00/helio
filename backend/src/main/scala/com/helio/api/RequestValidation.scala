package com.helio.api

object RequestValidation {

  private val EmailRegex = """^[^@]+@[^@]+\.[^@]+$""".r
  private val MinPasswordLength = 8

  def validateRegisterRequest(req: RegisterRequest): Either[String, RegisterRequest] =
    if (req.email.isBlank || req.password.isBlank)
      Left("email and password are required")
    else if (EmailRegex.findFirstIn(req.email).isEmpty)
      Left("invalid email format")
    else if (req.password.length < MinPasswordLength)
      Left(s"password must be at least $MinPasswordLength characters")
    else
      Right(req)

  def validateLoginRequest(req: LoginRequest): Either[String, LoginRequest] =
    if (req.email.isBlank || req.password.isBlank)
      Left("email and password are required")
    else
      Right(req)

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

  def normalizeLayoutCoordinate(value: Int): Int =
    math.max(0, value)

  def normalizeLayoutSpan(value: Int): Int =
    math.max(1, value)

  private def normalizeText(value: Option[String], defaultValue: String): String =
    value.map(_.trim).filter(_.nonEmpty).getOrElse(defaultValue)
}
