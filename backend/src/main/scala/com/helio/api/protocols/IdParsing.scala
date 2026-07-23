package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.server.PathMatcher1
import org.apache.pekko.http.scaladsl.server.PathMatchers.Segment
import com.helio.domain._

/** Path matchers that produce value-class IDs at the route boundary.
 *
 *  Use these in `pathPrefix` / `path` directives instead of raw `Segment`
 *  so that every ID is wrapped exactly once — at the route boundary —
 *  rather than being threaded through handlers as a `String` and wrapped
 *  inside repositories. The repository layer accepts value-class IDs only.
 */
object IdParsing {
  val DashboardIdSegment: PathMatcher1[DashboardId]         = Segment.map(DashboardId(_))
  val PanelIdSegment: PathMatcher1[PanelId]                 = Segment.map(PanelId(_))
  val DataTypeIdSegment: PathMatcher1[DataTypeId]           = Segment.map(DataTypeId(_))
  val DataSourceIdSegment: PathMatcher1[DataSourceId]       = Segment.map(DataSourceId(_))
  val PipelineIdSegment: PathMatcher1[PipelineId]           = Segment.map(PipelineId(_))
  val PipelineStepIdSegment: PathMatcher1[PipelineStepId]   = Segment.map(PipelineStepId(_))
  val PipelineRunIdSegment: PathMatcher1[PipelineRunId]     = Segment.map(PipelineRunId(_))
  val UserIdSegment: PathMatcher1[UserId]                   = Segment.map(UserId(_))
  val ApiTokenIdSegment: PathMatcher1[ApiTokenId]           = Segment.map(ApiTokenId(_))
  val ImageUploadIdSegment: PathMatcher1[ImageUploadId]     = Segment.map(ImageUploadId(_))
  val AlertRuleIdSegment: PathMatcher1[AlertRuleId]         = Segment.map(AlertRuleId(_))
  val AlertEventIdSegment: PathMatcher1[AlertEventId]       = Segment.map(AlertEventId(_))
}
