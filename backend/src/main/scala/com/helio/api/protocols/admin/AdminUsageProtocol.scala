package com.helio.api.protocols.admin

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** One UTC day's count; used for the zero-filled signup and provenance-open series. */
final case class AdminUsageDayCount(day: String, count: Long)

/** DAU is zero-filled; `weeklyActiveUsers` is `null` (a gap, never 0) when the day has no WAU. */
final case class AdminUsageActiveUsersDay(day: String, dailyActiveUsers: Long, weeklyActiveUsers: Option[Long])

/** One day of the TTFD series. `sampleCount` is 0 and both percentiles `null` for a day without
 *  samples (a gap, never 0 seconds). */
final case class AdminUsageTtfdDay(day: String, sampleCount: Int, medianSeconds: Option[Double], p90Seconds: Option[Double])

/** `latest` is the most recent day in the window that has samples (percentiles are not averageable,
 *  so there is deliberately no window-level summary). */
final case class AdminUsageTtfd(newUsersOnly: Boolean, perDay: Seq[AdminUsageTtfdDay], latest: Option[AdminUsageTtfdDay])

/** `conversionFromPrevious` is `null` for the first stage and when the previous stage is zero. */
final case class AdminUsageFunnelStage(stage: String, users: Long, conversionFromPrevious: Option[Double])

final case class AdminUsageTemplateCount(template: String, count: Long)

/** Response of `GET /api/admin/usage` (HEL-1211). Aggregates only -- no user identifier. */
final case class AdminUsageResponse(
    days: Int,
    from: String,
    to: String,
    rolledThrough: Option[String],
    signupsPerDay: Seq[AdminUsageDayCount],
    ttfd: AdminUsageTtfd,
    funnel: Seq[AdminUsageFunnelStage],
    templateChoices: Seq[AdminUsageTemplateCount],
    provenanceOpensPerDay: Seq[AdminUsageDayCount],
    activeUsers: Seq[AdminUsageActiveUsersDay]
)

trait AdminUsageProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  /** Wraps a base format so each named `Option` field serialises as an explicit JSON `null`
   *  instead of being omitted (spray-json's default), without touching any other format. */
  private def nullingNones[T](base: RootJsonFormat[T], keys: Seq[String]): RootJsonFormat[T] =
    new RootJsonFormat[T] {
      def read(json: JsValue): T = base.read(json)
      def write(value: T): JsValue = {
        val fields = base.write(value).asJsObject.fields
        JsObject(fields ++ keys.filterNot(fields.contains).map(_ -> (JsNull: JsValue)))
      }
    }

  implicit val adminUsageDayCountFormat: RootJsonFormat[AdminUsageDayCount] =
    jsonFormat2(AdminUsageDayCount.apply)
  implicit val adminUsageActiveUsersDayFormat: RootJsonFormat[AdminUsageActiveUsersDay] =
    nullingNones(jsonFormat3(AdminUsageActiveUsersDay.apply), Seq("weeklyActiveUsers"))
  implicit val adminUsageTtfdDayFormat: RootJsonFormat[AdminUsageTtfdDay] =
    nullingNones(jsonFormat4(AdminUsageTtfdDay.apply), Seq("medianSeconds", "p90Seconds"))
  implicit val adminUsageTtfdFormat: RootJsonFormat[AdminUsageTtfd] =
    nullingNones(jsonFormat3(AdminUsageTtfd.apply), Seq("latest"))
  implicit val adminUsageFunnelStageFormat: RootJsonFormat[AdminUsageFunnelStage] =
    nullingNones(jsonFormat3(AdminUsageFunnelStage.apply), Seq("conversionFromPrevious"))
  implicit val adminUsageTemplateCountFormat: RootJsonFormat[AdminUsageTemplateCount] =
    jsonFormat2(AdminUsageTemplateCount.apply)
  implicit val adminUsageResponseFormat: RootJsonFormat[AdminUsageResponse] =
    nullingNones(jsonFormat10(AdminUsageResponse.apply), Seq("rolledThrough"))
}
