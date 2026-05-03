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

  val MaxExpressionLength  = 500
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

  private val ValidImageFitValues = Set("contain", "cover", "fill")

  def validateImageFit(imageFit: Option[String]): Either[String, Option[String]] =
    imageFit match {
      case None      => Right(None)
      case Some(fit) if ValidImageFitValues.contains(fit) => Right(Some(fit))
      case Some(fit) => Left(s"Invalid imageFit value: '$fit'. Valid values: contain, cover, fill")
    }

  private val ValidDividerOrientationValues = Set("horizontal", "vertical")

  def validateDividerOrientation(orientation: Option[String]): Either[String, Option[String]] =
    orientation match {
      case None                                                            => Right(None)
      case Some(o) if ValidDividerOrientationValues.contains(o)           => Right(Some(o))
      case Some(o) => Left(s"Invalid dividerOrientation value: '$o'. Valid values: horizontal, vertical")
    }

  private def normalizeText(value: Option[String], defaultValue: String): String =
    value.map(_.trim).filter(_.nonEmpty).getOrElse(defaultValue)
}
