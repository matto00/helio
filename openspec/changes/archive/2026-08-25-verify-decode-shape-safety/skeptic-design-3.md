## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read all five artifacts in full from disk (`cat ticket.md proposal.md design.md tasks.md
specs/conversational-refinement/spec.md`), not from the orchestrator's summary.

**Round-2 CR-1 (stale `rightDataSourceId` = "highest-severity" sentence) — FIXED.**
`grep -rn "highest-severity\|highest severity" openspec/changes/verify-decode-shape-safety/`
now matches only `skeptic-design-2.md` (my own prior report). design.md's Premise
Correction mechanism-(2) bullet now reads that `rightDataSourceId` "is caught and surfaced
as `NotFound` before any silent corruption — it is the LEAST severe instance in the set,
not the most". The closing paragraph now reads "`JoinStep`'s `joinKey`/`joinType` (not
`rightDataSourceId`, which is backstopped by a referential check) get particular attention
in the live trials (D1)". D1 itself names `joinKey`/`joinType` as "the fields with NO
downstream check" and explicitly disqualifies `rightDataSourceId` as a probe. D1's
cross-reference now points at "the Premise Correction section", not the generic Context
section. tasks.md 2.1 independently encodes the corrected probe order (`joinKey` primary,
`joinType` secondary, `rightDataSourceId` explicitly not a useful probe, with the
`PatchSetApplyResolvers.scala:228-232` reason). No contradiction survives in design.md.

**Round-2 CR-2 (unconditional spec vs. conditional tasks) — FIXED, via option (a).**
The spec delta's single ADDED requirement is unconditional ("SHALL include a worked UPDATE
example for each of `join`, `pivot`, `window`, and `unpivot`") with four scenarios, one per
kind. tasks.md section 3 is now titled "Worked examples — unconditional for all four step
kinds": 3.1 adds one example per kind "regardless of what section 2's live trials show";
3.2 adds one decode-and-assert-actual-values test per kind, "all four, unconditional", and
names the spec requirement it verifies. 3.3 no longer gates the work — it now only
distinguishes *re-running* a trial (where a gap reproduced) from *noting* the pass (where
it didn't), with "the example still ships (3.1/3.2)" stated explicitly. proposal.md's
Impact section matches: "four new worked examples — join/pivot/window/unpivot — added
unconditionally" and "four new regression-guard tests, one per new example". No "possible"
hedge remains. Tasks, proposal, and spec now agree.

**Whole-plan consistency re-check.**
- AC coverage: AC1 (code read) satisfied by the Setup premise-validation recorded in
  ticket.md + design.md Context; AC2 → tasks 1.1–2.6 (all four kinds, both mechanisms,
  `window` covering `orderBy` and `partitionBy`); AC3 → tasks 3.1–3.2 + D2's
  assert-actual-values discipline, which correctly rejects the bare
  "decodes-without-throwing" assertion the AC calls out; AC4 → resolved
  `defer-to-followup` consistently in ticket.md, proposal.md Non-goals, design.md D3, and
  design.md Open Questions. No AC is uncovered.
- Scope drift: none. Filter/Sort are consistently declared out of scope in ticket.md,
  proposal.md Non-goals, and design.md Open Questions + Premise Correction, with the same
  rationale each time.
- Placeholders/TBD/hand-waving: none found. Every task names the concrete file, the
  concrete decoder, and the concrete assertion shape.
- Cleanup of shared dev Postgres state is an explicit task (2.6) and a stated risk
  mitigation — correct given the known shared-DB hazard.
- `openspec validate verify-decode-shape-safety --strict` → `Change
  'verify-decode-shape-safety' is valid` (exit 0).

### Verdict: CONFIRM

Both round-2 change requests are genuinely resolved in the files, the plan is internally
consistent across all five artifacts, and validation passes. Sound enough to implement.

### Non-blocking notes

- ticket.md's "Coordinator Premise Correction" still carries the pre-correction parenthetical
  in its mechanism-(2) bullet: "`JoinStep.decode` (all three fields, most severe:
  `rightDataSourceId` defaults to `\"\"`)" — immediately contradicted two lines later by the
  same section's own "Note: `join`'s real silent-degradation surface is `joinKey`/`joinType`,
  NOT `rightDataSourceId`". Non-blocking because the correction sits directly beneath it and
  because the artifacts an implementer actually builds from (design.md D1, tasks.md 2.1) are
  both unambiguous and correct. Worth deleting the four stale words if ticket.md is touched
  again.
- design.md's Premise Correction closing paragraph says "see the Premise Correction section"
  while sitting inside that very section — a self-reference left over from the D1 edit.
  Cosmetic only.
- Risks section correctly frames a live-trial PASS as "this framing didn't reproduce it",
  not "proven safe". Worth carrying that exact wording into the final evidence trail so a
  passing trial is never recorded as a safety proof.
