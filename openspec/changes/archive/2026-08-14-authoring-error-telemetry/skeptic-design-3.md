## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope: cold re-review of the fold-in revision only (ticket.md/proposal.md/tasks.md §6,
design.md deliberately unchanged) — HEL-401's original scope (already implemented, evaluated,
skeptic-CONFIRMed at final gate x2, archived, PR #330 open/green) was not re-litigated.

### What I verified (with evidence)

- Read the revised `ticket.md`, `proposal.md`, `tasks.md` (§6, tasks 6.1/6.2, both unchecked) and
  confirmed `design.md` is byte-for-byte the same content the prior final-gate rounds already
  reviewed (no diff pending in it per `git status`/`git diff` — only `ticket.md`/`proposal.md`/
  `tasks.md` show as modified).
- Cross-checked the fold-in items against `evaluation-1.md`'s actual "Non-blocking Suggestions"
  section (the source of truth for what was "approved") — both items are transcribed faithfully:
  suggestion 1 → tasks.md 6.1, suggestion 2 → tasks.md 6.2. No scope drift beyond what was
  triaged.
- Read the real `DashboardAuthoringService.scala` (438 lines) and `AuthoringTelemetry.scala`
  (120 lines) to check task 6.1's "behavior-preserving" claim against the actual code, not the
  plan's description of it.
- Read the real `AuthoringTelemetrySpec.scala` (`backend/src/test/scala/com/helio/api/routes/`)
  to confirm task 6.2's premise: the buffered "generated" test (lines 302–330) and the streaming
  "generated" test (lines 396–421) both currently assert only `obj.fields.keySet should
  contain("authoringRequestId")` / `terminal.head._2.fields.keySet should
  contain("authoringRequestId")` — presence, never equality against the telemetry line's own
  `authoringRequestId` field. Confirmed the gap is real, not already covered elsewhere in the file.
- Confirmed `succeedWithTelemetry`/`succeedStreamEvent` (`DashboardAuthoringService.scala:291-306`)
  already mint one `authoringRequestId` and use the SAME value for both the
  `AuthoringTelemetry.emitGenerated(...)` call and the constructed
  `DashboardAuthoringResponse`/`AuthoringStreamEvent.Result` — so D4's funnel-correlation claim is
  actually true today; task 6.2 closes a test-coverage gap on already-correct behavior, not a
  behavior change. This confirms leaving `design.md` unchanged is correct for 6.2.

### Design-decision question 1 — leaving design.md unchanged for 6.2: correct.

Verified above: the correlation the new assertion checks was already true in the shipped code;
no new design point exists to record.

### Design-decision question 2 — leaving design.md unchanged for 6.1: NOT fully safe as tasks.md
currently reads (see Change Request 1). It's a real, checkable code fact, not a matter of taste.

### Verdict: REFUTE

### Change Requests

1. **tasks.md 6.1 as literally written will not compile** — `succeedWithTelemetry` and
   `succeedStreamEvent` (`DashboardAuthoringService.scala:291` and `:302`) take
   `outcome: AttemptOutcome` as a parameter, and `AttemptOutcome` is declared
   `private final case class AttemptOutcome(...)` **nested inside `DashboardAuthoringService`**
   (`DashboardAuthoringService.scala:86`, plain `private`, not `private[services]`). Moving these
   two functions verbatim into `AuthoringTelemetry.scala` (or any sibling object outside
   `DashboardAuthoringService`) exposes a type that's private to a different class in a
   non-private function signature — Scala will reject this ("private class escapes its defining
   scope"). This is not true of `failWithTelemetry`/`failStreamEvent` (they only take the
   already-public `AuthoringError`), so the move is only mechanically clean for 2 of the 4 named
   helpers.
   - This matters concretely: ticket.md AC8 ("`DashboardAuthoringService.scala`'s
     telemetry-outcome helpers live alongside `AuthoringTelemetry.scala`, not inline in the
     service") reads as covering all four. An implementer who hits the compile error has at least
     three materially different, equally "behavior-preserving" ways to resolve it — (a) widen
     `AttemptOutcome` to `private[services]` (precedented elsewhere in this exact file/package:
     `AlertEvaluationService.scala:39/56/65`, `DashboardAuthoringParsing.scala:35`,
     `DashboardServiceValidation.scala` throughout, `PanelService.scala:199` all already use
     `private[services]` for cross-file-within-package helpers), (b) restructure the moved
     functions to take `proposal`/`warnings`/`tokens` as separate primitive parameters instead of
     the whole case class (avoids exposing the private type at all — arguably tighter
     encapsulation), or (c) only move the two functions that don't reference `AttemptOutcome`,
     leaving `succeedWithTelemetry`/`succeedStreamEvent` inline (in which case AC8 isn't actually
     met for those two, and the PR description should say so explicitly rather than silently
     under-delivering).
   - Required revision: tasks.md 6.1 should pick one of these explicitly (option (a) or (b) are
     both fine and cheap — my read is (b) is slightly cleaner since it doesn't widen any type's
     visibility at all) so the executor doesn't have to invent the resolution mid-implementation
     and doesn't quietly leave two of the four helpers inline while the AC/commit message imply a
     full move.

### Non-blocking notes

- Removing only the 4 named functions (leaving the 1-line `totalTokensOf` helper and the
  section-header comment in place) removes roughly ~20 lines from
  `DashboardAuthoringService.scala`, landing it around ~415-420 lines — still over CONTRIBUTING.md's
  "~400" informational split threshold, not "back under" it as ticket.md's Scope bullet and
  proposal.md's "What Changes" both phrase it. This is motivational framing, not a testable AC
  (AC8 only requires the helpers to live elsewhere, not a specific resulting line count, and the
  threshold is explicitly informational/soft), so it's not blocking — but the phrasing overstates
  the outcome and could read as a false completion claim once implemented. Worth a one-word softening
  ("closer to" instead of "back under") or just dropping the specific-threshold claim.
- tasks.md 6.1's "(or a sibling object it exposes)" already leaves room for NOT merging these
  functions directly into the `AuthoringTelemetry` object itself. Worth keeping that framing once
  6.1 is revised per Change Request 1 — `AuthoringTelemetry`'s own doc comment currently describes
  itself as pure log-emission ("This is the ONE call site in the authoring capability that needs an
  MDC-aware EC"); folding in functions that also construct `DashboardAuthoringResponse`/
  `AuthoringStreamEvent.Result` domain objects would blur that stated scope if dropped directly
  into the `AuthoringTelemetry` object rather than a distinctly-named sibling.
- Everything else checked out clean: no placeholders/TBDs, no internal contradictions across
  ticket.md/proposal.md/tasks.md, no scope drift relative to what was actually triaged in
  `evaluation-1.md`, no missing contract/schema updates (correctly — this fold-in touches no wire
  shape), and task 6.2's scope is precise and requires no design.md change.
