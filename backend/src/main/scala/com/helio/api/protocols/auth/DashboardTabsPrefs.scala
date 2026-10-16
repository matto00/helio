package com.helio.api.protocols.auth

import spray.json._

import java.time.Instant
import scala.util.Try

/** Validation and decoding of the `dashboardTabs` preferences key (HEL-1575). One implementation serves both the
 *  PATCH body (reject with a message) and the stored value (an invalid stored value is read as never set). */
object DashboardTabsPrefs {

  val MaxTabs: Int  = 20
  val MaxIdLength   = 64

  private val TabsFields = Set("tabs", "activeId")
  private val TabFields  = Set("id", "lastViewedAt", "ownWriteAt")

  private def instantOf(field: String, value: Option[JsValue]): Either[String, Option[String]] = value match {
    case None | Some(JsNull) => Right(None)
    case Some(JsString(s)) if Try(Instant.parse(s)).isSuccess => Right(Some(s))
    case Some(_) => Left(s"dashboardTabs $field must be an ISO-8601 instant or null")
  }

  private def tabOf(value: JsValue): Either[String, DashboardTabPref] = value match {
    case JsObject(fields) =>
      val unknown = fields.keySet.diff(TabFields)
      if (unknown.nonEmpty) Left(s"Unknown dashboardTabs tab field: ${unknown.toSeq.sorted.mkString(", ")}")
      else
        for {
          id <- fields.get("id") match {
            case Some(JsString(s)) if s.nonEmpty && s.length <= MaxIdLength => Right(s)
            case _ => Left(s"dashboardTabs tab id must be a non-empty string of at most $MaxIdLength characters")
          }
          viewed <- instantOf("lastViewedAt", fields.get("lastViewedAt"))
          own    <- instantOf("ownWriteAt", fields.get("ownWriteAt"))
        } yield DashboardTabPref(id, viewed, own)
    case _ => Left("dashboardTabs tab must be an object")
  }

  def parse(value: JsValue): Either[String, DashboardTabsPref] = value match {
    case JsObject(fields) =>
      val unknown = fields.keySet.diff(TabsFields)
      if (unknown.nonEmpty) Left(s"Unknown dashboardTabs field: ${unknown.toSeq.sorted.mkString(", ")}")
      else
        for {
          rawTabs <- fields.get("tabs") match {
            case Some(JsArray(items)) if items.size <= MaxTabs => Right(items)
            case Some(JsArray(_)) => Left(s"dashboardTabs.tabs holds at most $MaxTabs tabs")
            case _ => Left("dashboardTabs.tabs must be an array")
          }
          tabs <- rawTabs.foldLeft[Either[String, Vector[DashboardTabPref]]](Right(Vector.empty)) { (acc, raw) =>
            acc.flatMap(done => tabOf(raw).map(done :+ _))
          }
          _ <- if (tabs.map(_.id).distinct.size == tabs.size) Right(()) else Left("dashboardTabs tab ids must be unique")
          active <- fields.get("activeId") match {
            case None | Some(JsNull) => Right(None)
            case Some(JsString(s)) if tabs.exists(_.id == s) => Right(Some(s))
            case Some(_) => Left("dashboardTabs.activeId must be null or one of the tab ids")
          }
        } yield DashboardTabsPref(tabs, active)
    case _ => Left("dashboardTabs must be an object")
  }
}
