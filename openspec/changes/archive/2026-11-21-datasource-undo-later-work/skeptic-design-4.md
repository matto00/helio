## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD ebfeb6af76fdb594e072e46458d660c423a1db63. The planning artifacts are untracked in the change dir.
I did not reopen the owner rulings of 2026-11-20.

### Round-3 checklist

1. **CR1 (task 2.2 wording): ADDRESSED.** Task 2.2 now reads "Journal JournaledCreatedDataset(rowsStampedAt = stored
   data_sources.created_at, declaredSchema) per D2 (never fails apply)". A grep of proposal.md, design.md, tasks.md and
   the spec delta finds no `maxSeq` or `rowsUpdatedThrough`. The only `max(dataset_rows...)` hit is design.md:46,
   which rejects that approach.
2. **CR2 (Delivery task for the D9 follow-up): ADDRESSED.** Task 5.1 raises it through follow-up triage before the
   PR is presented, and cites the id in the PR body and the closing comment. That matches the owner ruling.
3. **CR3 (T from stored data_sources.created_at, zero-row case): ADDRESSED.**
   - D2 takes `T` from the stored `data_sources.created_at`, read back after `createStatic`, and gives the reason
     (an append cannot move it).
   - D2 states that `T` is always present, a zero-row create included. `createdDataset = None` only on a failed
     read-back, which goes to the D4 fallback. D4's last sentence is now true.
   - Task 1.1 adds the probe for stored `data_sources.created_at` == stored `dataset_rows.created_at`.
   - Code check: both columns are `TIMESTAMPTZ` (V4:6 and V106:35). The row insert passes `source.createdAt` for both
     stamps (DataSourceRepository.scala:385). Every `data_sources` update in the repository (:254, :337, :348, :390,
     :644, :753, :873, :1082) writes other columns, never `created_at`. So D2's "nothing updates it afterwards" holds.

Earlier rounds' CRs (round 1: CR1-5; round 2: CR1-2) remain addressed. I re-checked that the wiring arm is still at
PatchSetUndoConflictCheck.scala:83 and that `JournaledEdit` is `jsonFormat9` with `createdChildren` as its last
field (PatchSetApplicationRepository.scala:129, :147). D2's `jsonFormat10` is correct.

### New finding (verified)

**D6's chosen reference wording puts ids in the message, which contradicts D7 and the HEL-1720/1792/1795 rule.**
- D6 says a reference refusal is "worded by `SourceReferences.describe`". The proposal says the same: "via the
  existing `SourceReferences.describe`".
- `SourceReferences.describe` (DataSourceReferenceRepository.scala:163-178) prints each visible pipeline as
  `'<name>' (<pipeline id>; as ...)`, and each visible form panel as
  `'<title>' (<panel id>) on dashboard '<name>' (<dashboard id>)`. It also has no name cap.
- D7 says "No id or value ever appears". The design therefore contradicts itself, and an implementer could resolve
  it either way.
- The precedent the design says it mirrors forbids ids:
  - HEL-1792 (763c69f6f) moved undo refusals to "readable panels named by title and dashboard, the rest counted ...
    no ids", through `PatchSetUndoBoundPanels.nameList`/`describeBlocking`. Those name `"<title>" on dashboard "<name>"`,
    cap at `NameCap`, and count the rest.
  - The live `patch-set-undo` spec (openspec/specs/patch-set-undo/spec.md:295, HEL-1795) says "No id of a blocking
    Output or step SHALL appear in the message."
- The delta spec only says "name only the pipelines and panels the undoing user can read, and count the rest". It
  does not forbid ids. A test written from the spec would pass with `describe`'s ids in the message.
- `findReferences` visibility (owner or named grantee, DataSourceReferenceRepository.scala:25-30) does match "what the
  undoing user can read". Only the formatting is wrong.

### Verdict: REFUTE

### Change Requests

1. **design D6/D7, proposal "What Changes", task 3.2:** do not word the Phase-1 reference refusal with
   `SourceReferences.describe`. Build it from `findReferences`' result, using `PatchSetUndoBoundPanels.nameList`:
   - visible pipelines named by name, with their reference kind if you want it;
   - visible form panels as `"<title>" on dashboard "<name>"`;
   - overflow past `NameCap` and the hidden pipeline and panel counts counted;
   - no pipeline, panel, dashboard or source id.

   State this in D6. Leave `describe` untouched, because the direct delete's 409 still uses it.
2. **specs/patch-set-undo/spec.md:** add to the requirement that no id of a referencing pipeline, panel or dashboard
   SHALL appear in the message. This mirrors spec.md:295. In the scenario "A later pipeline using the source refuses
   the whole undo...", add to THEN that the message contains the pipeline's name and not its id.
3. **design D8:** add a test assertion that the reference-refusal message contains no pipeline or panel id. Add a
   mutation that swaps in `describe`, which must go red.

### Non-blocking notes

- The Phase-2 backstop inside `DataSourceService.delete` still produces `describe`-worded text (with ids) if a
  reference lands between the Phase-2 re-check and the delete. If the undo's `failed` outcome carries that text
  verbatim, consider mapping it to the fixed count-only phrase. That window is already accepted. At minimum, say in
  D7 which text a `failed` outcome shows in that case.
- The spec's "that the same patch set did not create" qualifier on the reference bullet is still redundant. It is
  harmless.
