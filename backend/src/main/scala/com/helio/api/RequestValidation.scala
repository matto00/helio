package com.helio.api

import com.helio.domain.panels.TimelineOptions
import com.helio.api.protocols.RedeemInviteCodeRequest

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

  private val ValidChartTypeValues = Set("bar", "line", "pie", "scatter")

  def validateChartType(chartType: Option[String]): Either[String, Option[String]] =
    chartType match {
      case None                                          => Right(None)
      case Some(t) if ValidChartTypeValues.contains(t)  => Right(Some(t))
      case Some(t) => Left(s"Invalid chartType value: '$t'. Valid values: bar, line, pie, scatter")
    }

  val ValidTableDensityValues = Set("condensed", "normal", "spacious")

  def validateTableDensity(density: Option[String]): Either[String, Option[String]] =
    density match {
      case None                                            => Right(None)
      case Some(d) if ValidTableDensityValues.contains(d)  => Right(Some(d))
      case Some(d) => Left(s"Invalid density value: '$d'. Valid values: condensed, normal, spacious")
    }

  def validateTimelineSort(sort: Option[String]): Either[String, Option[String]] =
    sort match {
      case None                                                    => Right(None)
      case Some(s) if TimelineOptions.ValidSorts.contains(s)       => Right(Some(s))
      case Some(s) =>
        Left(s"Invalid sort value: '$s'. Valid values: ${TimelineOptions.ValidSorts.toSeq.sorted.mkString(", ")}")
    }

  /** HEL-366: max length of the free-form `tag` field on data sources,
   *  pipelines, and DataTypes — mirrors the DB `CHECK (length(tag) <= 200)`
   *  (V73) so an over-length tag surfaces as a curated 400 before it ever
   *  reaches the DB constraint. */
  val MaxTagLength = 200

  def validateTag(tag: Option[String]): Either[String, Option[String]] =
    tag match {
      case Some(t) if t.length > MaxTagLength => Left(s"tag must be at most $MaxTagLength characters")
      case other                              => Right(other)
    }

  val MaxApiTokenNameLength = 100

  def validateCreateApiTokenRequest(req: CreateApiTokenRequest): Either[String, CreateApiTokenRequest] =
    if (req.name.isBlank)
      Left("name is required")
    else if (req.name.trim.length > MaxApiTokenNameLength)
      Left(s"name must be at most $MaxApiTokenNameLength characters")
    else if (req.expiresInDays.exists(_ < 1))
      Left("expiresInDays must be a positive number of days")
    // HEL-369: `scopedPipelineIds` present-but-empty is rejected outright
    // (a scope with no pipelines can never trigger anything, so it is a
    // caller mistake, not a legitimate "scope to nothing"); blank ids inside
    // a non-empty array are rejected the same way. Ownership/editor-role
    // validation happens in ApiTokenService.create (needs repository access
    // this pure function doesn't have).
    else if (req.scopedPipelineIds.exists(_.isEmpty))
      Left("scopedPipelineIds must not be empty when present")
    else if (req.scopedPipelineIds.exists(_.exists(_.isBlank)))
      Left("scopedPipelineIds must not contain blank ids")
    else
      Right(req)

  /** HEL-493: shared `name` trim/non-empty check for `MetricService.create`
   *  and `.update` — unlike `normalizeDashboardName`/`normalizePanelTitle`
   *  above, an empty metric name is a hard 400 (no silent placeholder
   *  default), so this returns `Either` rather than defaulting. */
  def validateMetricName(name: String): Either[String, String] = {
    val trimmed = name.trim
    if (trimmed.isEmpty) Left("name is required") else Right(trimmed)
  }

  private def normalizeText(value: Option[String], defaultValue: String): String =
    value.map(_.trim).filter(_.nonEmpty).getOrElse(defaultValue)

  /** HEL-698 design.md D5: `ConverseRequest.idempotencyKey` normalization — trimmed, a blank value
   *  treated as absent (a client sending `""` should behave exactly like sending no key at all,
   *  never a literal empty-string idempotency key), longer than `MaxIdempotencyKeyLength` rejected
   *  outright (bound junk, mirrors this file's own normalize-first posture). */
  val MaxIdempotencyKeyLength = 128

  def validateIdempotencyKey(key: Option[String]): Either[String, Option[String]] = {
    val trimmed = key.map(_.trim).filter(_.nonEmpty)
    trimmed match {
      case Some(k) if k.length > MaxIdempotencyKeyLength =>
        Left(s"idempotencyKey must be at most $MaxIdempotencyKeyLength characters")
      case other => Right(other)
    }
  }

  /** HEL-704 tasks.md 4.2 -- `POST /api/beta-access/redeem`'s `code` field: trimmed, required
   *  (unlike `validateIdempotencyKey` above, a blank code is a hard 400, not "treat as absent" --
   *  there is no meaningful redeem-with-no-code request), length-bounded (design.md D7) so bound
   *  junk never reaches `TokenHashing.sha256Hex`. */
  val MaxInviteCodeLength = 128

  def validateRedeemInviteCodeRequest(req: RedeemInviteCodeRequest): Either[String, RedeemInviteCodeRequest] = {
    val trimmed = req.code.trim
    if (trimmed.isEmpty)
      Left("code is required")
    else if (trimmed.length > MaxInviteCodeLength)
      Left(s"code must be at most $MaxInviteCodeLength characters")
    else
      Right(req.copy(code = trimmed))
  }
}
