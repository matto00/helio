## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round 2 CR#1 (test command) — CONFIRMED FIXED.** I ran the claimed command myself
from inside `helio-mcp/`, not just read the prose:

```
Test Suites: 14 passed, 14 total
Tests:       250 passed, 250 total
Time:        2.583 s
```

`write.test.ts` is in the PASS list, no OOM, real 2.9s wall time. The orchestrator's
claim is accurate. The command text is reproduced correctly (byte-for-byte, including
the `moduleNameMapper` escaping) in `ticket.md:72`, `design.md:156`, and `tasks.md:5.9`.

**Round 2 folded-in finding (Output-create route) — CONFIRMED FIXED.** Verified against
the actual route file, not the report: `OutputRoutes.scala:31` is
`pathPrefix("pipelines" / PipelineIdSegment / "outputs")` with a `post` arm, matching the
corrected `POST /api/pipelines/:id/outputs` in `specs/mcp-output-tools/spec.md:10`.

**Other endpoint claims spot-checked against the route tree** (all exist, all as
described): `POST /api/pipelines/:id/preview` (`PipelineRunStatusRoutes.scala:53`),
`GET /api/outputs/:id/rows` (`OutputRoutes.scala:88`),
`GET /api/outputs/:id/assertion-status` (`:80`),
`POST /api/pipelines/:id/validate-expression` (`PipelineRoutes.scala:68`),
`GET /api/outputs` (`OutputRoutes.scala:109`).

**`openspec validate mcp-outputs-proposals-rewrite --type change`** → `is valid`.

**Full independent pass** over `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
all 21 `specs/**/spec.md`. Design decisions 1-8 are specific and implementable; decision 5
(source-attached vs. step-targeted grounding) and decision 2 (inline-source two-call
arm with orphan-id reporting) are genuinely well-derived and traced to real schema
files. Both Planner Notes self-approvals are within authority. The two findings below
are what that pass turned up.

### Verdict: REFUTE

Two findings. Both are narrow and mechanical — the artifact set is otherwise sound and
in materially better shape than rounds 1-2.

### Change Requests

1. **`GET /api/outputs` cannot do the scoping the spec normatively requires of
   `list_outputs`.** `specs/mcp-output-tools/spec.md:9-11` states the tools are exposed
   over "... and `GET /api/outputs`, scoped to a pipeline and node." I read that route:
   `OutputRoutes.scala:108-124` (`listRoutes`) accepts **only** `offset` and `limit` and
   calls `outputService.listAll(user, page)` — there is no pipeline filter and no node
   filter. The route that *is* scoped is the nested one, `OutputRoutes.scala:31-38`:
   `GET /api/pipelines/:id/outputs` with `parameter("nodeStepId".optional)`, calling
   `listByPipeline(pipelineId, nodeStepId, user)`. As written, an implementer following
   this requirement literally would either add an unplanned backend filter to
   `GET /api/outputs` (which design.md's second Planner Note explicitly says is an
   escalation, not self-approvable) or silently drop the scoping. Fix the requirement
   text to route `list_outputs`' scoped behavior through
   `GET /api/pipelines/:id/outputs?nodeStepId=`, and describe `GET /api/outputs` as
   what it actually is — the unscoped, workspace-wide lean paginated list. This is the
   same defect class as round 2's create-route error, one requirement further down the
   same paragraph.

2. **The wrong test command survives in the two places that actually gate HEL-647's
   closure**, contradicting `tasks.md:5.9` and re-opening the exact vacuous-gate trap of
   rounds 1-2:
   - `ticket.md`, Acceptance Criteria: "*root Jest imports every decomposed module
     without OOM (HEL-647)*"
   - `tasks.md:3.1`: "*confirm root `npm test` imports every module without OOM
     (HEL-647)*"
   - `tasks.md:5.6`: "*root Jest suite imports every decomposed module without OOM*"

   All three name root Jest as the evidence for HEL-647, which by the ticket's own
   lesson #1 (`ticket.md:66-71`) finds **zero** helio-mcp tests inside this worktree and
   exits 0 vacuously. An executor can tick the HEL-647 AC and both boxes without running
   anything. Replace the command in all three with the verified scoped command (or have
   them reference 5.9 as the evidence source) so the AC HEL-647 is closed on is the one
   that actually scans helio-mcp.

### Non-blocking notes

- `tasks.md:5.9` hardcodes "confirm 14 suites". That count is correct today (I measured
  it), but this ticket decomposes `write.ts`/`helioApi.ts`/`context.ts` into new modules
  with new test files, so the suite count is expected to *rise* during execution. Phrase
  it as "all suites green, none skipped, no OOM" rather than a fixed 14, so a correct
  increase doesn't read as a gate failure mid-run.
