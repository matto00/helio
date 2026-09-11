package com.helio.domain.engine

import java.time.format.DateTimeFormatter
import java.time.{LocalDate, LocalDateTime, ZonedDateTime}
import scala.util.Try

/** HEL-1076 tasks.md 2.1: extracted from `SchemaInferenceEngine.isTimestamp` (behavior-preserving
 *  refactor) so both schema inference and `DatasetRowValidator` share ONE definition of "does this
 *  string look like a timestamp" rather than duplicating four `DateTimeFormatter` patterns. */
object TimestampParsing {

  /** `true` when `s` parses under any of the four formats this codebase already treats as a
   *  timestamp: `ISO_DATE_TIME`, `ISO_LOCAL_DATE_TIME`, `ISO_LOCAL_DATE` (a bare date), or
   *  `MM/dd/yyyy`. */
  def looksLikeTimestamp(s: String): Boolean =
    Try(ZonedDateTime.parse(s, DateTimeFormatter.ISO_DATE_TIME)).isSuccess ||
    Try(LocalDateTime.parse(s, DateTimeFormatter.ISO_LOCAL_DATE_TIME)).isSuccess ||
    Try(LocalDate.parse(s, DateTimeFormatter.ISO_LOCAL_DATE)).isSuccess ||
    Try(LocalDate.parse(s, DateTimeFormatter.ofPattern("MM/dd/yyyy"))).isSuccess
}
