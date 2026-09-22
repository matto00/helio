## Context

See proposal.md - Why. Both `AuthoringTelemetry` and `AssistantTelemetry` are Scala
`object`s living at their post-HEL-633 paths (`services/proposals/`,
`services/assistant/`), each with a `private val log: Logger =
LoggerFactory.getLogger("com.helio.services.<Name>")` naming their pre-HEL-633
package. `logback.xml` has no `<logger name="com.helio...">` entries — only
`<root>` — so neither string is load-bearing for routing/filtering.

## Goals / Non-Goals

**Goals:**
- Make the log category agree with the class's actual package again.
- Make it impossible for this specific category to drift from a future package
  move.

**Non-Goals:**
- No other file moves or refactors — this ticket is the one behaviour change
  HEL-632's epic permits (design.md D9 of HEL-633).
- Not auditing every `getLogger` call site in the codebase for similar drift —
  the ticket's own `grep -rn 'getLogger("' backend/src/main` already confirmed
  these are the only two hardcoded, drifted literals.

## Decisions

**D1: `LoggerFactory.getLogger(getClass)` over an updated string literal.**
The ticket's own preferred option. A `getClass`-derived category can never drift
from a future package move again, whereas a corrected literal reintroduces the
exact same class of bug this ticket exists to fix. Nothing in
`backend/src/main/resources/` or `logback.xml` keys off the current or a
corrected literal string, so the ticket's stated escape hatch ("prefer the
latter unless something is discovered to depend on the exact string") does not
apply — nothing does.

**D2: Accept the trailing `$` this produces, rather than stripping it.**
Both objects are Scala `object`s (not `class`es), so `getClass.getName` on
either is the synthetic module class name, `...AuthoringTelemetry$` /
`...AssistantTelemetry$` (trailing `$`), not the "clean" package+class name
the ticket's prose implicitly assumes. Considered stripping the suffix (e.g.
`getClass.getName.stripSuffix("$")`) to produce a cosmetically cleaner category,
but rejected: this repo already has 13+ existing `object`s using
`LoggerFactory.getLogger(getClass)` unmodified (`PipelineAnalyzeService`,
`SqlConnectorDriver`, `LocalFileSystem`, `GcsFileSystem`, `PanelRowMapper`,
`PanelAppearance`, `PatchSetUndoConflictCheck`, `PatchSetApplyRollback`,
`PdfTextSupport`, `ClaudeSseAssembler`, `ContentSourceSupport`,
`TopLevelErrorHandlers`, `RewrapConnectorCredentialsJob`) — the trailing `$` is
this codebase's established convention for object loggers, and diverging from
it for just these two objects would be the inconsistency, not the fix.
Resolved category strings: `com.helio.services.proposals.AuthoringTelemetry$`
and `com.helio.services.assistant.AssistantTelemetry$`.

**D3: Update all matching test literals in the same commit, not a follow-up.**
`JsonLogCapture.withCapture(category)` asserts on an exact string; changing the
producer without the consumer breaks every affected spec deterministically.
Re-derived count from the current tree: 15 (10 in `AuthoringTelemetrySpec.scala`,
5 in `AssistantTelemetrySpec.scala`), not the 12 the ticket states — see
`.concertino/runs/HEL-803/evidence/premise-validation.md` for the full
re-derivation. All 15 move together with the two production literals.

## Risks / Trade-offs

[Log category name changes for these two `object`s] → any external log-based
alert/dashboard/saved-search keyed on the literal string
`com.helio.services.AuthoringTelemetry` or `com.helio.services.AssistantTelemetry`
would stop matching. Mitigated: confirmed via grep that nothing in this repo's
own resources/config keys off either string; this is the one behaviour change
HEL-632's epic explicitly permits for this ticket, called out to the human as
part of delivery (per this run's escalation table, this is a self-approvable,
previously-scoped decision — not an ESCALATION).

## Gate-Chain Implications Checklist

Not applicable — this change touches only `backend/src/main/scala` and
`backend/src/test/scala` files; no `.husky/**` script or pre-commit hook logic
is touched.

## Migration Plan

None — no data migration, no config change, no deploy-order dependency. Ships
as an ordinary backend code change.
