## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Fresh spawn; every check below re-derived from the current artifacts and the shipped tree, not from the
round-1 report's narrative.

**CR1 (lane-path highlight planned against a nonexistent wire field) — addressed by mechanism, with one
residue.**
- `specs/pipeline-lane-run-reporting/spec.md` no longer contains any highlight requirement. Its Purpose
  block states the absence explicitly as a verified gap ("It is not a scope trim"), names the unshipped
  field, the free-text `runError` flattening, the routing to HEL-913, and records the client-side
  derivation as considered-and-REJECTED on contract item 9 (a disabled node also reports no count). The
  only ADDED requirement is per-node row counts.
- `tasks.md` 6.3 is an explicit do-NOT-implement, forbidding both consumption and client-side derivation,
  with the reason and the escalation outcome recorded.
- `proposal.md` Non-goals carries the same "NOT a scope trim" framing.
- `grep -rniE "lane path|lanePath|highlight"` across the change dir: the only remaining implementation-
  planning hits are `ticket.md` (input, immutable) and **`design.md:35`** — see CR1 below.

**CR2 (empty/self-contradicted tail guard) — addressed by mechanism.** Task 3.3 now (a) states the
unsatisfiability of AC2's literal wording, (b) names the two properties `pipeline-tails-ui` actually
states (indented dashed chain; termination in the Output chip) as the thing to assert, (c) labels it a
GUARD not a proof, (d) requires it failable by ONE mutation, naming `LaneColumn`'s compact branch and
explicitly rejecting a conjunction, and (e) adds a STOP if a pre-existing tail assertion needs editing.
Re-confirmed the premises: `find frontend -name '*.snap' -o -name __snapshots__` returns only
`node_modules` hits — no frontend snapshots exist; `PipelineRiverView.test.tsx:320-334` are indeed the
`trunkLastHasTail` gate tests task 4.1 deletes.

**CR3 — addressed.** `proposal.md` Impact now reads `ui/stepConfigs/{UnionConfig,LookupConfig}.tsx`.
Confirmed `ls frontend/src/features/pipelines/ui/stepConfigs/` has no `JoinConfig.tsx`; design Decision 6
keeps `join` out of scope and says why.

**CR4 — addressed.** Task 9.2 and proposal Impact both state the boundary as `frontend/**` plus the
repo-root `e2e/` suite, with the forbidden set named as `schemas/`, `backend/`, `helio-mcp/`, and the
proposal/patch-set paths. Confirmed `./playwright.config.ts` and `e2e/hel908-*.spec.ts` are at the repo
root, so task 8.1 no longer trips task 9.2.

**Round-1 non-blocking note — addressed.** `specs/pipeline-step-tree/spec.md` now carries a REMOVED block
for "At most one trunk child per node" with a reason (contradicts the position-orders-siblings requirement
HEL-911 added) and an explicit "no frontend or backend change accompanies this removal" migration — an
openspec-only edit, inside scope.

**Contract re-check (P2.1 archive `design.md` § Engine contract).** Item 2 (trunk is a UI notion) honoured
by Decision 1 and the step-tree delta's "SHALL NOT treat a `position = 0` child as structurally special".
Item 6 honoured by tasks 2.2 and 5.4/5.5 (non-terminal targets, multi-consumer diamonds, no dedup). Item
6b honoured by 5.4's explicit prohibition on any left-of/above-of ordering filter, citing 6b by name. No
UI-invented restriction found anywhere in the plan.

**AC trace.** AC1 (author two lanes + rejoin) → 4.1/4.3/5.1-5.6/8.1. AC2 (tails unchanged) → 3.1/3.3, with
the literal-wording defect now stated rather than papered over. AC3 (mobile stacking / 44px) → 7.1-7.3,
with 7.3 carrying the "verify what the sweep actually scans" instruction; note the sweep is a set of
`*.css.test.ts` files, not a viewport render, so it alone will not demonstrate lane stacking. AC4 (gates) →
9.1-9.3. Ancillary lane-aware Outputs/run reporting → 6.1/6.2.

### Verdict: REFUTE

One item only, and it is a one-line documentation fix — everything else from round 1 is resolved by
mechanism.

### Change Requests

1. **`design.md:35` still lists the deferred highlight as a GOAL of this change**, contradicting its own
   Decision 5, the `pipeline-lane-run-reporting` delta, task 6.3, and the proposal's Non-goals. The line
   reads:
   `- Per-lane analyze, previews, Outputs rails, row counts, failing-lane-path highlight, mobile stacking.`
   CR1's requirement was that *nothing anywhere* still plans to consume or derive a lane path; a Goals
   bullet is a plan, and an executor cherry-picking the Goals list would implement exactly the thing the
   human deferred. Remove `failing-lane-path highlight` from that bullet (the Non-Goals block two lines
   below is the right home for it, and Decision 5 already carries the reasoning).

### Non-blocking notes

- `design.md:25` also restates item 11's lane-path format, but that is Context describing binding ground
  truth, not a plan to build it — leave it.
- Decision 6 (`join` out of scope) remains a narrowing of the ticket's literal "join/union/lookup config"
  wording. It is justified in both design.md and the rejoin-picker delta, and AC1 only requires `union`.
  Accepted, but it should stay visible in the final report.
- Task 7.3's sweep caveat above is worth repeating to the executor: passing the touch-target sweep is not
  evidence of lane stacking at 375/430px; that needs a real viewport render.
