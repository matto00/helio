## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**The round-2 owner ruling is a genuine human decision, not a self-resolved/invented fix.**
Read `/home/matt/Development/helio/.concertino/runs/HEL-1096/events.jsonl` directly: a second
`escalation.raised` event (`t=1790270226177`) carries the exact question quoted in this round's
brief, with options `extend-patchRow-exclude-deleteRow-with-followup,extend-both-breaking-change-delete,
exclude-both-file-followups-for-each`. An `escalation.answer_discarded` event fires 8ms later (a stray
first attempt), then a real `escalation.answered` event (`t=1790270363507`,
`"resolution_channel":"cli","answer_source":"human"`) records
`"answer":"extend-patchRow-exclude-deleteRow-with-followup"` — matching `answer.json`
(`{"answer":"extend-patchRow-exclude-deleteRow-with-followup"}`) and matching design.md's Context
section verbatim. This is a real owner ruling, correctly distinguished from round 1's two
self-resolved items (design.md's history paragraph labels round 1 "self-resolved" and round 2's fix
"Owner ruling (2026-09-24, ...)" — that self-description is accurate against the event log).

**No lingering "three call sites"/"two call sites" language anywhere.**
`grep -n "three call sites\|two call sites\|THREE call sites\|TWO call sites" design.md proposal.md
tasks.md specs/*/spec.md` — zero hits. All "call site(s)" mentions found (`design.md:28,33,63,139`,
`tasks.md:20`) correctly say "four call sites" / name all four explicitly / describe the toast+page
copy-module pairing (unrelated). `proposal.md`'s "What Changes" and "Impact" sections were updated
(round 2 CR2) to list `appendFormRow`/`appendRows`/`replaceRows`/`patchRow` together and explicitly
call out `deleteRow`'s exclusion with the design.md pointer — this was the exact drift round 2
flagged as its minor CR2, and it is now fixed.

**`patchRow`'s extension is coherent given its genuinely different wire type.**
Read `DataSourceService.scala:857-882` (definitions) directly: `patchRow` returns
`Future[Either[ServiceError, RowMutationResult]]` (`RowMutationResult` defined at
`DataSourceService.scala:1340`), calling `triggerAutoRun(id)` at line 876 — distinct from
`appendRows`/`appendFormRow`/`replaceRows`, all of which return `RowWriteResult`
(`DataSourceService.scala:1318`). Wire-side, `DataSourceRoutes.scala:187` converts via
`RowResponse.fromDomain` (`patch` branch); `deleteRow` (`:900` in-file, wired at
`DataSourceRoutes.scala:200`) uses `ServiceResponse.runNoContent` — a real `204`, no body, matching
design.md's claim exactly. `RowResponse`/`RowWriteResponse` are separate case classes
(`api/protocols/sources/DataSourceProtocol.scala:262,281`), and both `schemas/sources/row-response.
schema.json` and `schemas/sources/row-write-response.schema.json` exist as separate files (`ls
schemas/sources/`). `tasks.md` 1.4 correctly describes this as "add the identical field to
`RowResponse`... for `patchRow`" — a field added to a distinct type, not a shared-type reuse. Coherent.

**`deleteRow`'s exclusion is documented in the places a future reader would find it.**
`design.md`'s Non-Goals (a named bullet, not a footnote), `design.md` D1 (states the exclusion
explicitly, "never migrated to the awaited form"), `design.md` Risks/Trade-offs ("a known,
owner-accepted limitation until HEL-1171 lands, not an oversight"), `proposal.md`'s "What Changes"
and "Impact" (both name `deleteRow`'s exclusion with a one-line rationale), the
`dataset-write-auto-run` spec delta's requirement text ("EXCEPT row delete...") and its own dedicated
scenario ("A delete-triggered denial is not surfaced in the response"), and `tasks.md` 1.3/3.2 (states
the exclusion and requires a test proving the `204`/no-body/log-only behavior is unchanged). Six
independent surfaces name it. Not silently absent by any read.

**HEL-1171 verified live via `mcp__linear__get_issue` (not trusted from the claim).**
Title: "Design a non-breaking way to surface auto-run denials for row DELETE" — matches. `labels:
["Follow-up"]` — matches C11. `projectId: "28f119e2-5738-46b1-a53b-42f73e06b053"` — matches C11 and
the brief exactly. `relations.relatedTo: [{"id":"HEL-1096", ...}]` — a real Linear relation, not just
an inline `<issue>` mention in the description text. `description` contains `origin_kind: followup` /
`origin_ticket: HEL-1096` per C11's convention. All claims check out against ground truth, not the
executor's narrative.

**Rest of the design (dual-surface, wire shape, canRun, round-1 visibility gate, toast
dedup/duration/copy-mapping) is textually unchanged from round 2 and still sound.** Diffed D2-D7
against my own round-2-verified understanding by re-reading them in full this round — identical
content to what round 2 confirmed unchanged from round 1. `specs/pipeline-analyze-api/spec.md` (the
third spec delta, not named in this round's brief but present in the change dir) is also unchanged
from what round 1 verified (`canRun` field, owner-or-editor check, two new scenarios) — read in full,
no drift.

**Artifact-format limits (openspec's own binding rules, read from `openspec/config.yaml`
`rules:`).** `design.md`: 149 lines (limit 150) — pass, genuinely close to the ceiling but compliant.
`tasks.md`: 45 lines (limit 80) — pass. `proposal.md`: 49 lines (limit 80, wrap-width rule, not a
hard line-count concern) — pass on lines; `wc -w` reports 352 words against the "under 300 words"
guidance — a real ~17% overage. I checked this isn't purely a hard gate: `openspec validate
run-to-update-affordance --type change` returns `Change 'run-to-update-affordance' is valid` (word
count isn't mechanically enforced), and two arbitrary archived, presumably-shipped proposals I
sampled (`2026-09-01-mcp-outputs-proposals-rewrite/proposal.md` at 425 words,
`2026-08-21-guided-first-run-onboarding/proposal.md` at 702 words) both blew past 300 by far more and
evidently weren't blocked on it. Noting as non-blocking given that precedent, not a Change Request.

**Minor factual softness in the `deleteRow` "breaking change" rationale (non-blocking).** Design.md
and the escalation context both assert `helio-mcp`'s `deleteDatasetRow` "depends on" the `204`
contract. Reading `helio-mcp/src/helioApi.ts:561-568` directly: `deleteDatasetRow` does `await
this.http.delete(...)` and never reads the response body or status beyond whatever the HTTP client's
own error-vs-success handling does — it would very likely tolerate a `200` just as well as a `204`.
The stronger, still-true argument for the exclusion is that `DataSourceRoutesSpec.scala` (backend
test suite) has hits for `204`/`NoContent` on this route, and `204`/no-body is a documented external
API contract independent of any one client's tolerance — so the underlying caution is still
justified, just not for the specific reason stated. This doesn't change the soundness of the decision
(defer to a follow-up ticket rather than silently reshape a working endpoint's response contract
inside this ticket), so I'm not treating it as a Change Request — flagging only so the executor
doesn't over-claim this specific rationale in a PR description or commit message.

### Verdict: CONFIRM

Both round-1 and round-2 Change Requests are genuinely resolved — re-derived from the live tree and
the actual Linear/event-log records, not accepted on the executor's word. The owner-ruling distinction
holds up: this is a real human CLI-channel decision, not an invented resolution. `patchRow`'s
extension is coherent given its distinct wire type; `deleteRow`'s exclusion is documented in six
independent places a future reader would find it, plus a verified, correctly-labeled, correctly-related
follow-up ticket. No stale three/two-call-site language remains anywhere. The rest of the design is
unchanged and still sound. Artifact-format limits are met except a non-blocking, precedented
~17% proposal.md word-count overage. Design is sound enough to implement.

### Non-blocking notes

- `proposal.md` is ~352 words against the "under 300 words" guidance (not mechanically enforced by
  `openspec validate`; archived precedent shows far larger overages shipping). Trim if convenient
  during execution, not worth a round-4 cycle on its own.
- The `deleteRow`/`helio-mcp` "breaking change" rationale as literally stated slightly overstates one
  specific client's actual coupling to the `204` status (it ignores the response body/status
  entirely) — the real justification (a documented `204`/no-body external API contract, and backend
  tests asserting it) is still sound. Executor: don't cite the helio-mcp-specific framing verbatim in
  the PR/commit body without the caveat, in case a careful reviewer checks it the way I just did.
