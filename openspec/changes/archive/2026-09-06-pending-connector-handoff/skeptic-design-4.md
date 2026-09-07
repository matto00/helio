## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Round 3 CR1 — stale 15-minute reference.** CLOSED on its literal terms.
`grep -rn "15-minute\|15 minute\|15min\|900\b"` over the change directory returns hits only inside
skeptic-design-{2,3}.md (the reports themselves). design.md:188 now reads "60-minute default expiry";
D9:167-170 states the revision; the residual-risk paragraph (188-201) is rewritten against the 24-hour
worst case. No stale number survives.

**Round 3 CR2 — supersession mechanism.** The column exists: design.md D2:48-50 and tasks.md 1.3:11-15
both carry `superseded_at TIMESTAMPTZ NULL`; D9:158-165 defines the two events; the spec's validity
requirement (specs/connectors/connector-completion-token/spec.md:23-24) includes "has not been superseded";
scenarios at 90-97 cover invalidation and mint/supersede atomicity; tasks 4.6b and 8.3b exist.

**Round 3 CR3 — both re-mint routes.** Owner route named at D9:151-156 and tasks 4.6a; normalization rule
at D9:143-150 and tasks 4.6; spec scenarios at 99-108. I checked the auth-shape-in-key decision against
ground truth: `authType` is persisted in `connectors.config` JSONB
(`backend/src/main/scala/com/helio/services/sources/ConnectorEntityService.scala:58`,
`ImplicitConnectorConfig.scala:20-34`, `V93__connectors.sql:22`), so "a pending row persists its intended
auth shape" is true with no additional schema. The normalization rule is implementable as written
(lowercase scheme/host, drop default port, strip one trailing slash, case-sensitive path/query, no DNS) —
it is a total function over the stored `base_url` and needs no new column. Auth-shape-in-key creates no
oracle: the agent supplies the shape itself.

**So: none of round 3's three CRs survived a round the planner believed it fixed.** This is not an
escalation. It is a fourth REFUTE on defects the round-3 edits introduced or left in siblings, plus one
soundness defect in the threat argument that rounds 1-3 missed.

Also checked: spec coverage for D4a is real (connector-management spec scenarios at :64 rotation-refusal,
:69 pending delete, :74 completion transition); credential-binding spec covers the completion write path;
chokepoint enumeration in Context matches the tree.

### Verdict: REFUTE

### Change Requests

1. **The expiry ceiling contradicts itself — "may lower" vs "raises it to 24 hours".**
   design.md D9:168-170 and tasks.md 4.4:67-69 both say configuration "may lower it but SHALL NOT exceed a
   hard-coded 24-hour ceiling". If configuration may only *lower* the 60-minute default, the 24-hour ceiling
   is unreachable dead code and the true worst case is 60 minutes. But the residual-risk paragraph
   (design.md:193-199) computes its accepted risk against "**up to 24 hours** if an operator raises it to
   the ceiling". These cannot both be the plan. An implementer will code either `min(configured, 24h)`
   (raising allowed) or `min(configured, 60min)` (lowering only) and both are defensible readings of the
   text. Pick one and make D9, tasks 4.4 and the Risks paragraph agree. This is the same
   fixed-the-cited-line/left-the-sibling pattern flagged in round 3.

2. **The supersession guard was never propagated into the consume predicate — the race D3 exists to close
   is reopened for the new invalidation event.** design.md D3:59 and tasks.md 2.3:29 both specify the
   atomic single-use write as a conditional `UPDATE … WHERE consumed_at IS NULL`. D9:161 now says a token
   is valid only if `consumed_at` AND `superseded_at` are both NULL and it is unexpired — but that second
   condition lives only in the in-memory validator, i.e. a read-then-write check, which is exactly what
   D3:59-60 argues is insufficient. Concretely: token A is validated as live; an owner or agent re-mint
   sets `superseded_at` on A; A's already-in-flight submission then satisfies `WHERE consumed_at IS NULL`
   and binds. A superseded token still completes the Connector, so "minting invalidates any previously
   outstanding token" (spec :75) and D9's "never a window with two live tokens" are not actually enforced
   at the write. Extend the conditional predicate to `WHERE consumed_at IS NULL AND superseded_at IS NULL
   AND expires_at > now()` in D3, D9 and tasks 2.3, and add the concurrent supersede-vs-consume case to
   tasks 4.6b/8.3b (which currently test the mint side only).

3. **The threat statement's detectability claim is false under this plan's own rules, which is the load-
   bearing half of the "sufficient at 24 hours" argument.** design.md:186-198 justifies accepting a
   24-hour window on the grounds that "misuse is always detectable — the human's own completion fails as
   already-consumed, and re-minting (D9) recovers". Both clauses are contradicted elsewhere in the plan:
   (a) the indistinguishability requirement (spec :110-116, D5:108-110, tasks 8.3) *mandates* that a
   consumed token be byte-identical to an expired or nonexistent one, so the human specifically cannot
   observe "already consumed" — they observe the same thing they would see after a benign expiry, which is
   the far more likely interpretation in a flow where expiry is expected; and (b) after an attacker binds,
   the Connector is no longer pending, so the owner re-mint route is refused as not-pending (D9:151-153)
   and agent re-initiation no longer matches the row (D9:143) and creates a *new* pending Connector —
   the attacker-bound Connector is left live and usable in the owner's workspace with nothing surfacing
   the event. Either add a genuinely owner-visible signal (this is safe: an *authenticated owner*, unlike
   an anonymous token presenter, is not an oracle risk — e.g. surface a completion timestamp / "completed
   at, not by you" state on the connectors list of task 6.3, and let the owner re-mint endpoint's
   not-pending refusal be distinguishable to the owner), or delete the detectability claim and re-argue
   whether 24 hours is acceptable without it. Do not leave the residual-risk acceptance resting on a
   property the design forbids.

4. **The indistinguishability requirement omits the state it just gained.** spec.md:110-116 enumerates
   "an expired token, a consumed token, and a token that has never existed" and its three scenarios
   (:118-129) likewise never mention *superseded*, even though D9:164 asserts it and tasks 8.3b tests it.
   The spec is the binding contract; as written an implementer is not required to make a superseded token
   indistinguishable, and the second invalidation event becomes exactly the oracle 8.3b is worried about.
   Add "superseded" to the requirement sentence and to at least the "identical to the caller" scenario.

### Non-blocking notes

- Planner Notes:222-223 still describes the resolution as "expiry default configurable with a conservative
  short default" — vestigial phrasing from the 15-minute era. It is not wrong, but once CR1 is settled this
  sentence should state the same direction as D9 rather than a generic characterization.
- D9's "removes the row-accumulation problem" is weaker than stated now that a differing auth shape
  deliberately forks a second pending row (D9:146-150). The consequence is acknowledged in the same
  paragraph and there is no reaper by design; worth one clause conceding accumulation is bounded-but-
  nonzero rather than removed.
