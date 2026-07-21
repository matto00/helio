## Context

`backend/src/main/resources/logback.xml` selects the console appender at startup with an `<if>` conditional nested
**inside** `<root>`:

```xml
<root level="${LOG_LEVEL}">
  <if condition='p("LOG_FORMAT").equalsIgnoreCase("json")'>
    <then><appender-ref ref="json" /></then>
    <else><appender-ref ref="plain" /></else>
  </if>
</root>
```

Logback's Janino `<if>` action is a "second-phase" conditional; `<root>` is itself a second-phase element. Nesting
one inside the other trips the `IfNestedWithinSecondPhaseElementSC` sanity check, which logs a WARN on every boot.
The selection still resolves correctly (verified across all `LOG_FORMAT` branches in HEL-115), so this is pure
startup noise.

## Goals / Non-Goals

**Goals:**

- Eliminate the `IfNestedWithinSecondPhaseElementSC` startup WARN in both plain and JSON modes.
- Preserve identical runtime behavior: appender selection by `LOG_FORMAT`, `LOG_LEVEL` root level, MDC + `severity`.

**Non-Goals:**

- No change to log format, encoders, field set, severity mapping, dependencies, or the env-var contract.
- No Scala code change; `logback.xml` is the only edited file.

## Decisions

**Decision: Lift the `<if>` to the top level, and put each `<appender>` inside its own branch alongside its `<root>`.**

The conditional sits directly under `<configuration>` (a first-phase context), not inside `<root>`, so the nesting
check passes. Each branch defines ONLY the appender it uses and a complete `<root>` referencing it:

```xml
<if condition='p("LOG_FORMAT").equalsIgnoreCase("json")'>
  <then>
    <appender name="json" class="ch.qos.logback.core.ConsoleAppender"> ... </appender>
    <root level="${LOG_LEVEL}"><appender-ref ref="json" /></root>
  </then>
  <else>
    <appender name="plain" class="ch.qos.logback.core.ConsoleAppender"> ... </appender>
    <root level="${LOG_LEVEL}"><appender-ref ref="plain" /></root>
  </else>
</if>
```

Each branch produces exactly one `<root>` with one appender-ref, and the unused appender is never defined — no
dangling refs, no double-appender, and (critically) no `Appender named [...] not referenced` WARN.

- Rationale: This is the canonical logback pattern for conditional root config and honors the ticket's zero-noise
  intent. `equalsIgnoreCase("json")` keeps the "any non-json → plain" fallback, including unset (`p()` returns
  empty string, which is not equal to `json`).

**Revision note (post cycle-1 probe):** The original design declared BOTH appenders unconditionally at the top level.
Runtime probing (cycle 1) empirically disproved the "harmless — an unreferenced appender does nothing" assumption:
Logback emits a new `level=1` WARN `Appender named [plain]/[json] not referenced. Skipping further processing.` on
every boot. That merely trades one line of boot noise for another, violating the ticket's zero-noise goal. Moving each
appender inside its branch eliminates BOTH the nesting WARN and the not-referenced WARN.

**Alternative considered — declare both appenders unconditionally, two `<root>` branches only:** Rejected after
cycle-1 evidence (introduces the not-referenced WARN above).

**Alternative considered — conditional `<appender-ref>` via a property:** Set a `SELECTED_APPENDER` property inside
the `<if>` and reference `${SELECTED_APPENDER}` in a single `<root>`. Rejected: still requires the `<if>` outside
`<root>` to set the property, so it is no simpler, and property-indirection is less readable than two explicit
branches.

## Risks / Trade-offs

- [Only the selected appender is defined per boot] → The unused appender is never instantiated, so no
  `not referenced` WARN and no wasted resources. Duplicated appender XML across the two branches is the only cost —
  acceptable for two small `<appender>` blocks.
- [Janino/`<if>` still required on classpath] → Unchanged from current config; no new dependency risk.
- [Regression in selection or level] → Mitigated by runtime-probing all `LOG_FORMAT` branches (json / plain / unset)
  plus a `LOG_LEVEL` check, and by the existing `StructuredJsonLoggingSpec` (per the verification-before-completion
  law).

## Planner Notes

- Self-approved: config-only cleanup, no external deps, no API/scope expansion — no ESCALATION warranted.
