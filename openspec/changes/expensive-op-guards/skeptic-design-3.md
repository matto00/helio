## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### Spawn-cwd guard

`pwd -P` → `/home/matt/Development/helio`. `assert-cwd.sh` returned
`READY ambient=/home/matt/Development/helio branch=feature/expensive-op-guards/HEL-505`. Proceeded.

### Scope of this round

Round 2 REFUTEd on exactly one small, actionable gap: `proposal.md` never mentioned the C7
dry-run/concurrency-cap exclusion, unlike C5's parallel callout. Round 2 explicitly scoped this as
"a small, mechanical documentation fix, not a re-open of the underlying design decision." This
round verifies the fix landed correctly and does a final consistency pass, without re-deriving the
architectural substance rounds 1 and 2 already exhausted.

### What I verified (with evidence)

**1. `proposal.md`'s C7 callout — present and accurate.**

Read the full file. Confirmed:
- "What Changes" bullet 1 (line ~14) is now qualified: "...so no trigger path, present or future,
  can bypass either guard **for a real (non-dry) run**. See the dry-run deviation below" — where
  round 2 found this unqualified.
- A dedicated new bullet: "**Deviation from the design's original claim, found and required by
  design-gate review** (design.md Decision 3, C7): dry-run submissions (`isDry = true`) are
  excluded from the **concurrency cap only** — they remain fully subject to the rate limit above,
  identically to real runs," with a one-line rationale (HEL-509/HEL-873 single-statement
  dry-run-persistence invariants, out-of-scope-to-restructure) and the practical consequence
  spelled out (a user can run many concurrent dry runs bounded only by the rate limit, not
  `PIPELINE_RUN_MAX_CONCURRENT`). This mirrors C5's existing "Deviation from the ticket's literal
  AC" bullet in phrasing pattern, exactly as round 2's Change Request asked.
- "Capabilities" → `pipeline-run-guard` now reads: "The rate limit covers every submission (dry
  and real) identically; the concurrency cap covers real (non-dry) submissions only — see the
  dry-run deviation under 'What Changes' above." Previously this section said "enforced uniformly
  across every trigger path" with no dry-run qualifier — now qualified.
- `grep -n -i "uniform\|every trigger path\|no trigger path\|unconditional" proposal.md` finds
  only the two now-qualified instances (lines 14, 44) — no other unqualified "applies everywhere"
  claim survives elsewhere in the document.

This resolves round 2's Change Request 1 in full: both the "What Changes" qualification and the
"Deviation" callout it asked for are present, matching C5's treatment.

**2. design.md's two citation-pinpoint fixes — both verified correct against the actual code.**

- `DbContext.scala` (read lines 30-52 in full): `withUserContext[R](userId)(action: DBIO[R]):
  Future[R] = db.run((setUserVar(userId) andThen action).transactionally)` is at **lines 50-51**
  exactly. `design.md:135` now cites `DbContext.scala:50-51` — correct (round 2 found this was
  previously miscited as 34-46).
- `PipelineRunService.scala` (read lines 1085-1096 in full): the doc comment "this dry run's row
  is inserted above (unlike the real-run path, where insertRun already ran during preExec)" is at
  **lines 1091-1093** (comment block spans 1089-1093). `design.md:168` now cites "confirmed by the
  code's own comment at 1090-1093" — correct (round 2 found this was previously miscited as
  1079-1082, which is a different, adjacent doc comment).

Both fixes are substantively correct, not just re-worded to dodge the finding.

**3. Fresh full-set consistency pass (ticket.md, proposal.md, design.md, tasks.md, spec.md,
workflow-state.md) — no new gap found.**

- `tasks.md:9` (Standing Constraint C7 restatement) and `tasks.md:22,24,26-27,52` (task-level C7
  scoping at 2.4, section header before 3, 3.1, 3.2, 8.1) all still correctly split "rate limit:
  both dry+real" vs. "concurrency: real-only" — unchanged from round 2's verification, re-read and
  still consistent with the now-updated proposal.md.
- `specs/pipeline-run-guard/spec.md`: re-read both Requirements. First Requirement (rate limit)
  states "Dry-run submissions count toward this rate limit identically to real-run submissions."
  Second Requirement (concurrency) states "The system SHALL reject a **real (non-dry)** pipeline-run
  submission..." plus an explicit dedicated scenario "A dry-run submission is not subject to the
  concurrency cap." Consistent with proposal.md's now-updated language.
- `workflow-state.md` CONSTRAINTS C7 entry and CONSTRAINT_REVIEWS ledger (`verdict_seq":1,
  "gate":"design","round":1,"verdict":"REFUTE","promoted":["C7"]` then
  `"verdict_seq":2,...,"round":2,"verdict":"REFUTE","promoted":[]`) accurately record the two-round
  history; the round-3 pre-fill note at the bottom of the file correctly summarizes what round 2
  found and what was fixed, matching what I independently verified above.
- `ticket.md` re-read in full: nothing in the AC list, scope, dependencies, or premise-validation
  findings is now orphaned or contradicted by the C7 narrowing — the ticket's own
  "Standing constraints" section already anticipated a possible narrowing via its "Real design
  fork (escalate)" bullets, and the owner-ruling framing at the top is unaffected.
- `git status --short openspec/changes/expensive-op-guards/` shows only the untracked change dir
  as a whole (no code diff) — consistent with still being at the design gate before any execution
  cycle, `HEAD` unchanged from main's `e08cce1d`.

No new defect surfaced on this pass. The two items round 2 flagged as resolved-but-unverified are
now verified; the substance rounds 1 and 2 already confirmed sound remains unchanged.

### Verdict: CONFIRM

### Non-blocking notes

None beyond what rounds 1 and 2 already recorded (all resolved).
