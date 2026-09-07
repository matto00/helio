## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

Read from the tree, not from prose: `ticket.md`, `proposal.md`, `design.md` (256 lines), `tasks.md`,
and all five spec deltas under `specs/`.

**Round-4 CR1 (expiry ceiling self-contradiction) — CLOSED.** `design.md` D9 final paragraph:
"60-minute default, operator-configurable in either direction, hard-capped at 24 hours … the
implementation clamps to a hard-coded 24-hour ceiling (`min(configured, 24h)`), which is therefore
reachable and is the worst case the residual-risk statement below is argued against." `tasks.md` 4.4
states the same clamp in the same direction. The Risks paragraph now argues explicitly at 24 hours
("Is the mitigation set still sufficient at 24 hours?"). Direction, ceiling and the risk baseline agree.

**Round-4 CR2 (supersession guard never reached the write) — CLOSED.** The predicate
`WHERE consumed_at IS NULL AND superseded_at IS NULL AND expires_at > now()` appears verbatim in D3 and
in task 2.3; D9 carries the cross-reference ("The full validity predicate must live in the conditional
write, not only in the in-memory validator — see D3"). Both D3 and 2.3 also state the general rule
(every validity condition in the write) rather than only the instance. Task 4.6b adds the
supersede-vs-consume race test explicitly ("a token validated as live, then superseded while its
submission is in flight, must NOT bind"), and 8.3b covers superseded-token indistinguishability.

**Round-4 CR3 (detectability argument rested on a property the design forbids) — CLOSED, with a caveat
recorded below as a non-blocking note.** D10 exists and is scoped: owner-visible completed-at on the
connectors list, plus owner-only distinguishability of "already completed" vs "not found" on the
authenticated re-mint endpoint. The Risks paragraph now depends on it by name ("Only because of D10's
owner-visible completion signal. Without it, 'misuse is detectable' would be **false under this
design's own rules**"). Tasks 4.6c and 8.3b implement and test both halves, including the negative
half (anonymous endpoint stays byte-identical).

*Judged directly, as asked.* (a) Does the owner-visible signal reach an owner who was never watching?
It is a passive UI timestamp, not a notification — so it makes misuse *observable*, not *noticed*. The
design says exactly that ("what a longer window costs is time-to-detection, not capability"), which is
an honest, contestable acceptance rather than the round-4 circularity, where the claim was refuted by
the design's own indistinguishability rule. That is a real improvement in kind, not relocation.
(b) Does owner-only distinguishability leak to a non-owner? No. Ownership is checked first: D9 and
`connector-completion-token/spec.md:102` refuse a non-owner with the standard not-found mapping, so a
non-owner's response set is unchanged; the "already completed" branch is only reachable after
ownership is established, on an authenticated endpoint, about a resource the caller already knows
exists. The anonymous endpoint is explicitly untouched (D10, task 4.6c, spec scenario at :124-129).

**Round-4 CR4 (indistinguishability omitted superseded) — CLOSED.**
`connectors/connector-completion-token/spec.md:110-123`: the requirement sentence names "a
**superseded** token" alongside expired/consumed/nonexistent, and the scenario "Consumed, superseded
and nonexistent tokens are identical to the caller" exercises all three. The new owner-visibility
scenario is present at :124-129.

**Ground-truth spot checks of premises the plan depends on.** Max applied migration is `V102`
(`ls backend/src/main/resources/db/migration | sort -V | tail`), matching the plan's "derive V103,
re-derive at write time". `V93__connectors.sql:23` confirms `credential_id UUID NOT NULL REFERENCES
connector_credentials(id) ON DELETE RESTRICT`, so D1's nullable-column change and its compile-error
enumeration are grounded. `TokenHashing` exists at
`backend/src/main/scala/com/helio/infrastructure/crypto/TokenHashing.scala` with `ShareTokenValidator`
as the named precedent, so D2's "reuse, do not add a second hashing helper" is real.

No round-4 CR has survived.

### Is this plan sound enough to hand to an executor?

Yes. Every acceptance criterion traces to concrete tasks (AC1→5.1/4.6, AC2→4.2/4.3/6.1/6.2, AC3→3.1/3.2,
AC4→4.4/4.7/8.3, AC5→5.2/8.5), the security-relevant decisions are stated as decisions with rejected
alternatives rather than deferred, and the remaining objections below are all things a competent
executor resolves while implementing without guessing at intent or being sent down a wrong path.

### Verdict: CONFIRM

### Non-blocking notes

1. **Where `completedAt` is stored is unspecified.** Task 4.6c requires the connectors list to carry a
   completed-at timestamp, but neither D10 nor the schema task 1.3 says whether it is a new column on
   `connectors` or derived from `connector_completion_tokens.consumed_at`. Derivation works and needs no
   column, but note the interaction with D4a: deleting a Connector cascades its tokens, which is fine,
   while a *completed* Connector must retain its consumed token row for the signal to survive. Pick one
   and say which in the implementation.
2. **Record *who* completed, not only *when*.** In this flow the legitimate completer is frequently not
   the owner, so a bare timestamp cannot distinguish "my teammate finished it" from "someone who read
   the transcript finished it" — the exact discrimination D10's detectability argument leans on. Storing
   the completing principal (authenticated user id, or an explicit `anonymous`) alongside the timestamp
   costs one column and materially sharpens the signal. Not blocking: the timestamp alone is still
   strictly more than round 4 had.
3. **D9's refusal sentence still reads literally against D10.** D9 says the owner re-mint endpoint is
   "refused with the standard not-found mapping if the caller does not own it **or it is not pending**",
   which for the owned-and-completed case is the case D10 then makes distinguishable. Task 4.6c and the
   spec scenario are unambiguous and test 8.3b would fail if D9 were implemented literally, so this is
   self-correcting — but a one-clause edit to D9 ("…or it is not pending, except that an owner is told
   distinctly when it is already completed — D10") would remove the ambiguity for free.
4. **Planner Notes retains one pre-CR1 phrase**, "lowerable by configuration but capped at a hard-coded
   24-hour ceiling", which reads lower-only against D9's "either direction". D9 is the binding decision
   and task 4.4 agrees with it; align the stray Planner Notes sentence when convenient.
5. **The 24-hour ceiling remains the one number a human might want to contest.** The design says so
   itself ("If that is judged unacceptable in review, the **ceiling** is the wrong number, not this
   paragraph"), which is the right framing. I am not blocking on it: the token discloses no existing
   secret and addresses exactly one credential-less Connector, so the ceiling trades detection latency,
   not capability.
