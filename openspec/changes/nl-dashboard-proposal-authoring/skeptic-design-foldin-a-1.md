## Skeptic Report — design gate, fold-in A re-run (skeptic-design-foldin-a-1.md)

### What I verified (with evidence)

**Ground truth re-established, cold, from the restored change dir:**
- `git status`: confirms the archive was actually undone (renamed back from
  `openspec/changes/archive/2026-08-13-nl-dashboard-proposal-authoring/` to
  `openspec/changes/nl-dashboard-proposal-authoring/`, staged), and `proposal.md`/`tasks.md`/
  `ticket.md`/`workflow-state.md` are the only files with further unstaged edits — `design.md` and
  `specs/nl-dashboard-proposal-authoring/spec.md` are untouched, exactly as claimed in point 5.
- Read `ticket.md` (new fold-in AC, lines 29-34), `proposal.md` (new fold-in bullet, lines 21-23),
  `tasks.md` section 7 (4 new tasks, 7.1-7.4), `design.md` in full (D1-D8), and
  `specs/nl-dashboard-proposal-authoring/spec.md` in full (7 ADDED Requirement blocks, all Scenarios).
- `openspec validate nl-dashboard-proposal-authoring --type change --strict` → own re-run: `Change
  'nl-dashboard-proposal-authoring' is valid`. (Note: structural validation only — it cannot and does
  not check spec/task traceability, which is the actual question here.)

**Tracing each new task (7.1-7.4) to design.md/spec.md text:**

- **7.1 (GuardrailExceeded → 422, buffered):** `spec.md` lines 90-93, "Scenario: An over-budget goal
  is rejected by the underlying client's own guardrail" — explicit, unambiguous: prompt exceeds
  `ClaudeConfig.maxInputTokens` → `GuardrailExceeded` → "mapped to a 422". `design.md` D8 confirms the
  `ServiceError.UnprocessableEntity` mapping. Cross-checked against the real code:
  `ClaudeClient.scala:56-60` (`guardrailReject`, `estimated > config.maxInputTokens`) confirms task
  7.1's proposed mechanism (a tiny `maxInputTokens` in a test `ClaudeConfig`) is exactly how this spec
  scenario is actually triggered. **Fully specified, no gap.**
- **7.3, guardrail half (streaming mirror):** the same `spec.md` Requirement text explicitly says
  "every call to `ClaudeClient.send`/`ClaudeClient.stream`... shall go through that client's own
  guardrails" — covers both variants by its own wording, and `design.md` D7 defines
  `AuthoringStreamEvent.Error` as the terminal-event shape a mapped error takes. **Adequately
  specified.**
- **7.2 (ApiError/TransportFailure → BadGateway, buffered) and the non-guardrail half of 7.3
  (streaming):** grepped `specs/nl-dashboard-proposal-authoring/spec.md` in full — **zero** mentions of
  `BadGateway`, `Bad Gateway`, or `502` anywhere in the document. The only source for this mapping is
  `design.md` D8's prose ("`ClaudeError.ApiError`/`TransportFailure` → `ServiceError.BadGateway`
  (upstream failure)") and the already-shipped code
  (`DashboardAuthoringService.scala:133-134`: `ApiError` → `BadGateway(s"Claude API error
  ($status): $body")`, `TransportFailure` → `BadGateway(message)`). **No spec.md Requirement/Scenario
  documents this endpoint's 502 behavior at all.**
- Checked whether this is normal for the codebase (i.e., whether upstream-failure→specific-HTTP-status
  mappings are typically left undocumented in `spec.md` and only live in `design.md`/code): grepped
  `openspec/specs/**/spec.md` for `BadGateway`/`502` — 7 capability specs document it explicitly, e.g.
  `openspec/specs/rest-api-connector/spec.md:29-31`: "**Scenario:** Refresh fetch failure returns 502
  / **WHEN** `POST /api/sources/:id/refresh` is called but the remote URL fails / **THEN** the response
  is 502 with a descriptive error...". This is the established convention in this codebase: an
  upstream-failure → specific-status mapping gets its own `spec.md` Scenario, not just a `design.md`
  Decision. `nl-dashboard-proposal-authoring/spec.md` breaks that convention for exactly the two
  branches (`ApiError`/`TransportFailure`) this fold-in's tasks 7.2/7.3 are about to lock in with
  permanent regression tests.
- Also checked `openspec/specs/claude-api-client/spec.md` (HEL-390's own capability, still un-archived
  status notwithstanding — checked the equivalent change-dir copy is the merged one on `main`) in case
  the 502 contract already lives there instead: it documents `ClaudeClient.send`/`.stream` themselves
  returning `Left(ClaudeError.GuardrailExceeded(...))` etc., but says nothing about
  `DashboardAuthoringService`'s HTTP-status mapping of those errors — that mapping is unique to this
  change and is not covered by any other capability's spec either.
- Read `evaluation-1.md` and `skeptic-final-1.md`'s original non-blocking notes verbatim: both cite
  *only* the guardrail/422 scenario as "spec.md's own written scenario" that went unexercised — neither
  claims `spec.md` documents the `ApiError`/`TransportFailure`/502 branches. `ticket.md`'s own new
  fold-in AC text (line 32-33) likewise cites only the "over-budget goal... mapped to 422" scenario as
  the pre-existing spec text being closed. The fold-in's own framing is consistent with my finding —
  it never actually claimed spec.md covers all three branches, only the coordinator's point-5 blanket
  "no spec delta ... needed this time" reasoning overgeneralizes from the one branch that is covered to
  all three.

**Design.md sufficiency (separate question from spec.md sufficiency):** D8 itself *is* unambiguous for
an implementer writing tests 7.2/7.3's non-guardrail half — `ApiError`/`TransportFailure` →
`BadGateway` is stated plainly, and the shipped code already implements it exactly that way
(`DashboardAuthoringService.scala:133-134`). So no *new* `design.md` Decision is required — that part
of point 5's reasoning holds. The gap is specifically in `spec.md`, not `design.md`.

**Tasks.md itself:** 7.1-7.4 are each mechanically unambiguous to implement (verified the trigger
mechanisms against real `ClaudeClient`/`ClaudeAuthoringService` code, not just prose) — the objection
below is not that an implementer would be confused about *what to write*, it's that the capability's
own written spec would remain silent on behavior a permanent regression test is about to enforce,
which is precisely the kind of test-without-a-traceable-requirement gap this fold-in exercise exists
to close, not reproduce for two of its own three branches.

### Verdict: REFUTE

Point 5's reasoning does not fully hold. It is correct for the `GuardrailExceeded`/422 branch (tasks
7.1 and half of 7.3) — `spec.md` already writes that scenario out in full and `design.md` needs no new
Decision. It is **not** correct for the `ApiError`/`TransportFailure`/502 branches (task 7.2 and the
other half of 7.3): there is no `spec.md` Requirement or Scenario documenting that this endpoint
returns `502 Bad Gateway` on an upstream Claude API/transport failure, only a `design.md` Decision
(D8) and the already-shipped code. Per this repository's own established convention (see
`openspec/specs/rest-api-connector/spec.md`'s "Refresh fetch failure returns 502" precedent), an
upstream-failure-to-specific-status mapping gets a written spec Scenario. Landing tasks 7.2/7.3 as
currently scoped, with no spec.md delta, would add permanent regression tests enforcing behavior the
capability's own spec never states — the same untraceable-test problem this whole fold-in was
commissioned to fix, just reintroduced for 2 of the 3 branches instead of closed for all 3.

### Change Requests

1. Add a `spec.md` delta for `openspec/changes/nl-dashboard-proposal-authoring/specs/nl-dashboard-proposal-authoring/spec.md`
   documenting the `ApiError`/`TransportFailure` → `502 Bad Gateway` behavior for both the buffered
   and streaming variants. Minimal form: extend the existing "Requirement: Cost/token guardrails apply
   to every request via the underlying client" section (or add a small new Requirement, e.g. "Upstream
   Claude API/transport failures surface as a Bad Gateway response") with two Scenarios — one for the
   buffered `author` path, one for the streaming `authorStreaming` terminal `Error` event — mirroring
   the phrasing pattern already used for the guardrail scenario (lines 90-93) and the repo's own
   `rest-api-connector/spec.md` precedent for a 502 Scenario.
2. Update `proposal.md`'s fold-in bullet (lines 21-23) and/or `ticket.md`'s fold-in AC (lines 29-34) to
   stop implying uniform "spec.md already specifies this in writing" coverage across all three
   `mapClaudeError` branches — the written-scenario claim is accurate for `GuardrailExceeded` only;
   say so explicitly, and note the new spec.md Scenario(s) from Change Request 1 as part of this
   fold-in's own scope (not a separate follow-up), since tasks 7.2/7.3 already plan to write the tests
   that scenario would describe.
3. No `design.md` change is needed (D8 already fully and unambiguously specifies the
   `ApiError`/`TransportFailure` → `BadGateway` mapping for an implementer) — do not add a new Decision
   for this, only the `spec.md` Scenario(s) above.
4. `tasks.md` section 7 itself needs no task-content changes — 7.1-7.4 are each implementable exactly
   as written once Change Request 1 lands; no new task item is required beyond folding the spec.md edit
   into the existing test tasks' scope (e.g., note it under 7.2's checklist item) or adding one line
   task for the spec delta.

### Non-blocking notes

- Tasks 7.1 and the guardrail half of 7.3 are genuinely sound as-is: fully traceable to an existing,
  unambiguous `spec.md` Scenario + `design.md` D8, and the proposed test mechanism (tiny
  `ClaudeConfig.maxInputTokens`) matches the real `ClaudeClient.guardrailReject` code path exactly.
- The overall fold-in scope (closing a real, previously-flagged coverage gap) is worthwhile and
  correctly triaged as non-architectural in nature — the objection here is narrowly about spec.md
  completeness for 2 of the 3 error branches, not about whether this fold-in should happen at all.
