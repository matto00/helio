package com.helio.logging

import ch.qos.logback.core.PropertyDefinerBase

/** HEL-1128: normalizes the `LOG_FORMAT` env var into exactly `"json"` or
  * `"plain"` for `logback.xml`'s unconditional `<appender-ref
  * ref="${LOG_APPENDER}">`.
  *
  * This is a logback `<define>` (`PropertyDefinerBase`), deliberately NOT an
  * `<if>` — local reproduction (real Dockerfile + real throwaway Postgres,
  * see design.md) probe-confirmed that ANY `<if>` in this repo's fat-jar
  * build leaves the root logger with no appender attached at runtime, even
  * though Joran reports a clean "End of configuration". A `PropertyDefiner`
  * runs as plain JVM code during property resolution, before appender
  * attachment, so it sits entirely outside that failure surface while still
  * restoring the case-insensitive-fallback contract
  * (`openspec/specs/structured-json-logging/spec.md`, `CLAUDE.md`'s
  * `LOG_FORMAT` row): any value other than exactly `json`
  * (case-insensitive) resolves to `plain`, so a typo or unset value never
  * again leaves the root appenderless.
  */
class LogFormatPropertyDefiner extends PropertyDefinerBase {
  override def getPropertyValue: String =
    sys.env.get("LOG_FORMAT").map(_.trim).filter(_.equalsIgnoreCase("json")) match {
      case Some(_) => "json"
      case None    => "plain"
    }
}
