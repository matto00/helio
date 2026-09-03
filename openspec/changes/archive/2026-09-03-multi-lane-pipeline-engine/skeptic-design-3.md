## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read both prior reports, then re-derived from the artifacts and the tree: `ticket.md`,
`proposal.md`, `design.md` (146 lines), `tasks.md`, and all 18 spec deltas.

**Round-2 CR verification, item by item:**

1. **CR1 (`schemas/` in contract item 5) — ADDRESSED, literal wording checked.**
   `design.md:121` (contract item 5) now enumerates "the engine, the wire codec, the MCP
   tools, the frontend editors, the patch-set apply path, or the Spark submitter" and adds
   an explicit "**`schemas/` is deliberately absent from this list**" clause stating no
   `schemas/` file constrains step-config shape, that this change does not create one, and
   that HEL-914 must not be planned against a gate that does not exist, cross-referencing
   Decision 1a. `design.md:84` is consistent. I re-confirmed the premise myself:
   `schemas/pipelines/create-pipeline-step-request.schema.json` types `config` as
   `{"type": "object"}`, and a grep of all three legacy names across `schemas/` returns
   nothing. No surviving contradiction.
2. **CR2 (proposal Impact + AC disposition) — ADDRESSED.** `proposal.md`'s Impact →
   Contracts line no longer names `schemas/`, and a dedicated paragraph
   ("Disposition of the …acceptance criterion") records the `schemas/` half of the ticket AC
   as a verified no-op with the evidence and the reason not to invent the surface. The AC is
   answered by a stated finding, not left silent.
3. **CR3 (sweep on the property across `openspec/specs/**`) — the sweep was done correctly,
   but the remedy does not work. See the Change Request.** I re-ran the sweep myself:
   `grep -rl` for the three legacy names across `openspec/specs/` returns exactly seven
   files — `conversational-refinement`, `patch-set-apply`, `pipeline-joinstep-right-source-acl`,
   `pipeline-lookup-op`, `pipeline-run-execution`, `pipeline-steps-persistence`,
   `pipeline-union-op` — matching task 10.2a's list exactly, and all seven have deltas. The
   file-level accounting is right. What is wrong is the delta *mechanism*, below.

**Round-2 non-blocking notes applied — all confirmed:** contract item 11 now pins the
lane-path format (ordered step ids root→failing step, `" > "`-joined, virtual root as
`root`, ids not names, worked example); task 9.4 names `LookupConfig.tsx` and warns off the
phantom `JoinConfig.tsx`; `design.md:64` records V97's empty-id mapping as a deliberate,
bounded, migration-layer-only exception to Decision 1a. I did not reopen the three owner
decisions or CR1's empty-id resolution; I found no new evidence against either.

**The check that produced the finding (reproduced after a bad first reading).**
OpenSpec's own sync workflow
(`@fission-ai/openspec/dist/core/templates/workflows/sync-specs.js:98-104`) defines
`## MODIFIED Requirements` as *"Find the requirement in main spec"* and apply changes to it;
a renamed requirement is expressed via `## RENAMED Requirements` (FROM:/TO:), which no delta
in this change uses. So a MODIFIED block whose `### Requirement:` header does not exist in
the live spec does not replace anything — it lands as a new requirement beside the legacy
one, which survives verbatim.

My first pass at matching delta headers against live specs had an off-by-one in the awk
substring and reported false unmatches; I caught it, corrected it, and re-ran. Corrected
results:

- **This change: 0 of 18 MODIFIED requirement headers match an existing requirement in the
  corresponding live spec.**
- **Baseline, same check, same script, on this repo's archived changes (2026-08/09):
  289 of 291 MODIFIED headers match.** The repo's convention is unambiguous, and this change
  is the outlier — this is not "how deltas are written here."
- `openspec validate multi-lane-pipeline-engine --strict` is green apart from one RFC-2119
  wording warning. The gate does not check that a MODIFIED requirement targets an existing
  one, so a green validate is not evidence here.

### Verdict: REFUTE

### Change Requests

1. **Every `## MODIFIED Requirements` block in this change is titled with a new requirement
   name, so none of them modifies anything — the legacy text CR3 was filed about survives in
   all seven files.** Verified 0/18 matching against a 289/291-matching archived baseline
   (method and tool citation above). The two most damaging cases are exactly the two CR3
   named:
   - `specs/pipeline-steps-persistence/spec.md` MODIFIES *"Step creation verifies
     secondary-input ownership via the discriminated shape"*, which does not exist. The live
     requirement carrying the ACL text is **"POST /api/pipelines/:id/steps appends a new
     step"** (`openspec/specs/pipeline-steps-persistence/spec.md:93`), whose body at `:125`
     ("the backend SHALL additionally verify that `config.rightDataSourceId` is owned…") and
     whose scenario at `:204-208` are untouched. Post-sync the spec would state the ACL in
     terms of a field this change deletes **and** state it in terms of `secondaryInput`, in
     two separate requirements.
   - `specs/pipeline-run-execution/spec.md` MODIFIES *"Join step merges two **inputs** on a
     key column"*; the live requirement is *"Join step merges two **data sources** on a key
     column"* (`openspec/specs/pipeline-run-execution/spec.md:146`), whose text at `:148`
     ("The config SHALL contain `rightDataSourceId`") survives. A pure rename with no
     `RENAMED` entry.
   Fix on the **property, not on these two examples**: for each of the 18 MODIFIED blocks,
   either retitle it to the exact existing requirement header it is meant to change, or pair
   it with a `## RENAMED Requirements` FROM:/TO: entry, or relabel it `## ADDED` where it is
   genuinely a new requirement (e.g. "A failing step names its lane path" and "Step traversal
   handles multiple children…" have no live counterpart and are additions, not modifications).
   Please state the rule you applied and the resulting per-delta disposition in the change
   record, so this is auditable rather than re-derived.

2. **Task 10.2a's sweep cannot catch this, and should say what it actually proves.** It
   directs a post-implementation grep of `openspec/specs/**` for the three legacy names — but
   `openspec/specs/**` is only rewritten at *archive*, after this ticket's work is done, so
   the sweep will find the legacy names present regardless of whether the deltas are correct,
   and will find nothing about whether each MODIFIED block targets a real requirement.
   Replace/extend it with the check that does discriminate: for every requirement header under
   a `## MODIFIED` (or `## REMOVED`) heading in `changes/multi-lane-pipeline-engine/specs/**`,
   assert the identical header exists in the corresponding `openspec/specs/<cap>/spec.md`,
   and record the result. Keep the seven-file property sweep as the post-archive check it
   really is.

### Non-blocking notes

- The rest of the Engine contract reads as plannable to me. Items 1-4, 6, 6a, 7-12 constrain
  mechanism rather than outcome, item 11's newly pinned lane-path format removes the last
  thing HEL-912/914 would have had to renegotiate, and item 10's stated dependency on 6a is
  the right way round. Nothing in the contract section is driving this REFUTE — CR1 above is
  a delta-authoring defect, and fixing it should not require touching `design.md`'s contract.
- `tasks.md` still lists 9.7 and 9.8 between 9.4 and 9.5 (carried over from round 2). Cosmetic.
