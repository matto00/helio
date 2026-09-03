## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read `skeptic-design-1.md` first, then re-derived everything from the artifacts and the tree.
Files read in full: `ticket.md`, `proposal.md`, `design.md` (145 lines), `tasks.md` (101 lines),
and the deltas for `pipeline-lane-rejoin-input`, `pipeline-step-config-rejection`,
`patch-set-apply`, `conversational-refinement`, `pipeline-joinstep-right-source-acl`,
`pipeline-run-execution`, `pipeline-steps-persistence`.

**Round-1 CR verification, item by item:**

1. **CR1 (empty-id contradiction) — ADDRESSED, and I judge the resolution sound.**
   `design.md:57-64` now separates the two objects explicitly with a bullet each;
   `tasks.md:1.3a` and `2.1a` exist; `specs/pipeline-step-config-rejection` carries a
   dedicated scenario ("An empty dataSourceId in the new shape is NOT rejected") and
   `pipeline-joinstep-right-source-acl` / `pipeline-lane-rejoin-input` are now consistent
   with it rather than contradicting it. The false "the shape that made HEL-950 necessary
   is gone" claim is deleted. I verified the forcing data myself:
   `hel904-real-dump.sql:10163` and `:10230` are genuine `lookup` rows with
   `"referenceDataSourceId":""` (line 10230 also has empty `lookupKey`/`sourceKey` — an
   unmistakable saved draft), and the fixture holds 6 legacy-shaped rows total, matching
   task 2.6's stated count. See "On CR1" below for one residual I judged non-blocking.
2. **CR2 (cross-pipeline stepId) — ADDRESSED.** Contract item 6a, task 5.3, task 11.12,
   and a whole new requirement in `specs/pipeline-lane-rejoin-input` with four scenarios
   (foreign pipeline / another user's pipeline / nonexistent id, all at write time, plus a
   run-time arm). Contract item 10 now states its own dependency on 6a in writing
   ("Item 10 is unsound without item 6a; they ship together"). This is mechanism-
   constraining, not outcome-only.
3. **CR3 (schemas/ false premise) — HALF ADDRESSED. See CR1/CR2 below.** `design.md:82`
   and `tasks.md:1.5` are fixed correctly, but the two other places CR3 named were not.
4. **CR4 (missing deltas) — ADDRESSED for the two named files, NOT keyed on the property.**
   `specs/patch-set-apply` and `specs/conversational-refinement` exist with real MODIFIED
   requirements, and proposal.md's Modified Capabilities lists both. But see CR3 below:
   the same defect survives in two other live spec files.
5. **CR5 (missing surfaces) — ADDRESSED.** `repair-dev-db.sql`, `backend/README.md` and
   `PipelineService.scala` are all in the `design.md` enumeration; tasks 9.7 and 9.8 exist.
   I re-ran the full-tree grep (archive excluded): 46 files, and every non-test,
   non-artifact one is now enumerated.
6. **CR6 (engine `.find` sites) — ADDRESSED.** Task 3.2a names `expandChain` and
   `walkTrunk` explicitly and requires the sweep be keyed on the property; the risk
   section gained a matching bullet at `design.md:136`.
7. **CR7 (~17 legacy-shape test files) — ADDRESSED.** Task 11.14 requires per-assertion
   justification and independent leg-breaking of HEL-950's guard. My own grep returns 13
   backend + 4 frontend test files carrying the legacy names, consistent with "~17".
8. **CR8 (FlywayNonSuperuserMigrationSpec) — ADDRESSED.** Task 2.6 now demands assertions
   *inside* the non-superuser spec, names the six fixture rows and the two empty-id
   drafts, and explicitly calls out the "green the moment the file lands, zero assertions"
   trap.

**Independent ground-truth checks I ran:**

- `schemas/pipelines/create-pipeline-step-request.schema.json` → `config` is
  `{'type': 'object'}`; `grep` across `schemas/` for all three legacy names returns
  nothing. The round-1 premise-correction is factually right.
- `frontend/.../stepConfigs/` contains `UnionConfig.tsx` and `LookupConfig.tsx`; there is
  indeed no `JoinConfig.tsx`.
- `openspec/specs/pipeline-run-execution/spec.md:148` and
  `openspec/specs/pipeline-steps-persistence/spec.md:125,:206` still carry
  `rightDataSourceId` in normative text — and neither capability's delta touches it.

**Assessment of the Engine contract as a deliverable.** Items 1–4, 6, 6a, 7–12 are precise
and plannable; 6a in particular is the right kind of fix (a security boundary stated as a
mechanism with both arms and four scenarios). Decision 2's parity claim and Decision 3's
`nodeOutcomes` justification are the same ones round 1 verified against code. The section
is close to shippable — but item 5 contains a statement the same document elsewhere calls
false, and item 5 is precisely what HEL-914 will be planned from. That, plus a spec-delta
gap of exactly the class CR4 was filed for, is a REFUTE at the stated bar.

### Verdict: REFUTE

### Change Requests

1. **Contract item 5 still names `schemas/` in its enforcement list — the exact thing CR3
   asked to remove, and it contradicts this document's own `design.md:82`.**
   `design.md:119` reads "**No other shape is accepted anywhere** — not by the engine, the
   wire codec, `schemas/`, the MCP tools, …", while `design.md:82` states `schemas/`
   requires **no action** because it models nothing, and `tasks.md:1.5` forbids inventing a
   step-config schema surface. Both cannot be true. This is not cosmetic: item 5 is in the
   section three downstream tickets are planned from, so HEL-914 would be planned against a
   `schemas/` enforcement point that does not exist and that this change has decided not to
   create. Remove `schemas/` from item 5's enumeration and replace it with the explicit
   statement that no `schemas/` file constrains step-config shape today (cross-referencing
   `design.md:82`), so the gate is never cited as evidence it cannot supply.

2. **`proposal.md`'s Impact still asserts the false premise, and the ticket AC it collides
   with is never answered.** Impact → Contracts reads "`schemas/pipelines/*` for the
   step-config shape", which `design.md:82` disproves. Separately, the ticket's acceptance
   criteria say literally "`schemas/` + OpenSpec updated in the same change" — the design
   has decided (correctly, on evidence) that `schemas/` needs no update, but no artifact
   states that this AC is being answered by "verified no-op, here is why". An AC silently
   left unsatisfied is how a final gate gets argued at. Correct the Impact line and record
   the AC disposition in `proposal.md` (or `design.md`) in one sentence.

3. **The CR4 fix was keyed on the two file names I happened to list, not on the property —
   and two live spec files still carry the legacy field names with no delta covering them.**
   `openspec/specs/pipeline-steps-persistence/spec.md:125` and `:206` state the
   second-source ownership requirement in terms of `config.rightDataSourceId`, and
   `openspec/specs/pipeline-run-execution/spec.md:148` states the join config "SHALL contain
   `rightDataSourceId`". Both capabilities *are* in this change, but their deltas address
   only traversal (`pipeline-steps-persistence`) and lane-path error reporting
   (`pipeline-run-execution`) — the legacy-field text is untouched, so it ships describing a
   field the change deletes. `:125`/`:206` is the worst case: it is the normative statement
   of the ACL this change is rewriting, pinned to a field name that will no longer exist.
   Extend those two deltas (or add requirements to them) to restate the affected text in
   terms of `secondaryInput`, and — per this design's own §9.5 — re-run the sweep across
   `openspec/specs/**` keyed on the *property* rather than on the file names round 1 named,
   confirming in the change record that the resulting list is complete. (Lesson: an audit
   keyed on one name structurally cannot see the sites reaching the property another way;
   round 1's CR4 named two files and exactly two files were fixed.)

### Non-blocking notes

- **On CR1, since you asked me to judge it directly.** I think the resolution honours the
  owner's decision rather than softening it, and I would not send it back. The owner's
  "not a default, an empty id, or a silent `{kind:'source'}` coercion" governs the *runtime
  decoder*, and there the artifacts are now unambiguous and strict (task 1.3, the rejection
  spec's three legacy scenarios). One residual is worth naming honestly: V97's rule in task
  2.1a *is*, read literally, a legacy flat field being coerced into `{kind:"source"}` with
  an empty id — at the migration layer, once. But the alternatives are destroying two real
  saved user drafts or making them hard read-time failures, both worse and neither asked
  for; the rule is stated explicitly rather than emerging as an accident; and HEL-950
  already settled that an unset id inside the new shape is legal. I record it so a later
  reader meets it as a deliberate, bounded exception rather than discovering it.
- Task 9.4 correctly warns off the phantom `JoinConfig.tsx`, but `LookupConfig.tsx` does
  exist in `stepConfigs/` and carries `referenceDataSourceId`. Naming it costs nothing and
  removes one grep from the executor's path.
- `tasks.md` lists 9.7 and 9.8 between 9.4 and 9.5. Cosmetic.
- Round-1's note that contract item 11 never defines what a "lane path" string *is*
  recurs, and has now hardened: `specs/pipeline-run-execution` makes "the path of the lane"
  normative without a format. HEL-912 will render it. Still not blocking here, but it will
  be cheaper to pin now than to renegotiate across three tickets.
