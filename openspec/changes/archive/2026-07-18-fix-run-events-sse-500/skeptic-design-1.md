## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket ACs vs proposal/design/tasks mapping** — read `ticket.md` (probe-first mandate, 3 ACs: reproduce+capture,
  fix root cause to 200/never-500-for-valid/proper 4xx, regression coverage). Each AC maps 1:1 to `tasks.md` sections
  1 (Probe), 2 (Fix), 3 (Tests). No AC left uncovered by any task.

- **Design accurately reflects the real code, not a hallucinated chain.** Read the actual files named in the design:
  - `backend/.../routes/PipelineRunStreamRoutes.scala:26-38` — confirmed `onComplete(runService.pipelineExistsShared(...))`,
    `Failure(ex) => complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))` exactly as described
    (leaks `ex.getMessage`, matches Decision 3's stated problem).
  - `PipelineRunService.pipelineExistsShared` (line 205-206) → `pipelineRepo.findByIdShared(pipelineId, Some(user)).map(_.isDefined)` — matches design's stated chain.
  - `PipelineRepository.findByIdShared` (lines 55-80) — confirmed: `withSystemContext` row lookup, owner path is a
    plain string compare (`caller.id.value == ownerId`, no `UUID.fromString`), non-owner/grantee path does
    `ctx.withUserContext(caller.id.value)(permTable.filter(... p.granteeId === UUID.fromString(caller.id.value) ...))`.
    This exactly matches the design's Decision 1c claim ("only the shared-grantee path executes `UUID.fromString`")
    and Decision 2's plausible-candidate list — these aren't guesses invented for the write-up, they're grounded in
    the actual code path.
  - `frontend/.../hooks/usePipelineRunEvents.ts` — confirmed it's `fetch` + `credentials: "include"` (session cookie
    only, no PAT header, no `Last-Event-ID` reconnect logic today). Design's "check what request the frontend
    consumer actually issues" task (1.2) is answerable and the design doesn't misstate it as already known — it
    still requires the executor to inspect it, which is correctly scoped as a task rather than assumed in the design.
  - `V40__fix_rls_policy_function_recursion.sql` — confirmed the HEL-286 SECURITY DEFINER recursion history the
    design cites is real and matches (dev/CI superuser BYPASSRLS masking a prod-only RLS failure mode) — this is the
    exact same class of bug the ticket worries about, so citing it as a probe candidate is well-founded, not
    hand-waving.
  - Confirmed `pipeline-run-sse` is an **existing** capability (`openspec/specs/pipeline-run-sse/spec.md`, 3 existing
    requirements) and the new requirement in the spec delta is genuinely additive (no duplicate), consistent with
    proposal.md correctly listing it under "Modified Capabilities" (not "New").

- **No placeholders/hand-waving that block implementation.** No `TODO`/`TBD` in any artifact. The "fallback" path
  (Decision 5 / task 2.4) is not a loophole — it explicitly still requires shipping the route hardening (2.2) and the
  stub-based failure-path test (3.2) even if the live repro fails, and requires a documented report with matrix +
  evidence + exonerations before any not-reproducible conclusion — this matches the human briefing's binding
  constraint verbatim.

- **Probe ordering matches the Iron Law.** `tasks.md` section 1 is explicitly gated before section 2 (fix); design.md
  Decision 1 lays out an ordered matrix (auth mode → pipeline state → grantee path → concurrency → non-superuser RLS)
  rather than a vague "test some things." Decision 1's ordering is sound: it front-loads the cheapest/most-likely
  reproduction paths (happy path, states) before the RLS non-superuser setup (the most expensive probe step, requires
  creating a role per `docs/cloud-dev-setup.md`'s existing BYPASSRLS/CREATEROLE guidance) — a competent
  implementer can execute this without further judgment calls.

- **No scope drift.** Non-goals explicitly exclude SSE semantics rework, frontend changes (unless probe-implicated),
  and broad RLS rework. Impact section lists only the files actually in the suspect chain plus tests. This matches
  the ticket's scope.

- **No missing contract/schema updates needed.** The proposal correctly notes the error-body change is not a
  documented contract shape (ErrorResponse already exists as the generic error type); no `schemas/`/`openspec` OpenAPI
  delta is needed beyond the capability spec already produced.

### Verdict: CONFIRM

The design is grounded in the real code (verified independently, not taken on faith from the planner's narrative),
correctly orders probe-before-fix per the Iron Law, defines an unambiguous ordered matrix an implementer can execute
without guessing, keeps a legitimate fallback that still ships hardening + regression coverage, and leaves no AC
uncovered. Sound enough to implement.

### Non-blocking notes

- Design.md refers to "the team's RLS repro notes" for the non-superuser probe step; no single dedicated doc exists
  by that name — the closest concrete guidance is `docs/cloud-dev-setup.md`'s CREATEROLE/BYPASSRLS section and the
  archived `openspec/changes/archive/*rls*` proposals. Not a blocker (the executor has enough to construct the
  non-superuser role), but worth the executor citing the actual source(s) they used in their probe report rather than
  the informal "team notes" framing.
- Decision 1's "e" step (non-superuser RLS re-run of a-c) is the most expensive/riskiest step operationally (creating
  a role, granting/revoking privileges in a shared dev DB). Worth the executor double-checking this doesn't collide
  with other concurrently-running worktrees per the fleet notes in `workflow-state.md` ("HEL-290 cleanup may run in
  parallel") before mutating DB roles.
