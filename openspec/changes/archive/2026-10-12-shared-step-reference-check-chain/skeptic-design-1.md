## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `849dd96c936182d4a8c8597c3cbdc92ae39fcb82`. The change dir is untracked, so the artifacts were read from the working tree.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/shared-step-reference-checks/HEL-1515`.
- **Three hand-copied chains (premise):** confirmed.
  - Create: `PipelineStepCreate.scala` L61-148. The order is acl, then lane, then `findByIdShared`, then (non-owner) `requireEditorAccess`, then `upsertOwnershipCheckF`.
  - Update: `PipelineStepWrites.scala` L87-119. The order is acl, lane, upsert. The editor check and type check run earlier, at L42-53.
  - Duplicate: `duplicateReferenceChecksF` at L304-341. The order is acl, lane, upsert.
- **Update descendant formula (D4):** `descendantStepIds(Set(existing.id), current) - existing.id` is correct. `descendantStepIds` seeds the accumulator with its input set (`PipelineService.scala` L431-438), so subtracting `existing.id` gives exactly the strict descendants. A `req.position` on update does not re-parent anything. Sound.
- **Splice semantics (`spliceInsertReportingInternal`, `PipelineStepRepository.scala` L683-760):** the splice re-parents **every** direct child of the anchor under the new step, tails included. Two exceptions:
  - With `(None, Some(root))` it re-parents that root's parentless steps.
  - With `(None, None)` it re-parents every root-level step (`siblingsQuery(pipelineId, None)`).
  - `attachTailInternal` re-parents nothing.
  - `rejectIfReparents` fails the transaction before the write.
- **Duplicate keeps descendants empty (D4):** sound. The clone C is spliced with `anchor = existing.id` (`PipelineStepWrites.scala` L279), so C inherits all of E's former children. C's descendants are therefore E's former descendants, and C's lane target equals E's. A lane target inside that set means E was already cyclic, so duplicate introduces no new unrunnable state. Note: `DuplicateStepReferenceChecksSpec` L148-152 already SQL-seeds exactly such a descendant reference (join -> target, where target is a child of join), which independently confirms that the state is storable.
- **Engine semantics:** `InProcessPipelineEngine.executeTree` is Kahn's algorithm over parent edges **plus lane edges** (scaladoc above `executeTree`). A cycle through lane edges therefore fails at run time just like a direct descendant reference.
- **Stage disjointness:** `PipelineStepConfigCodec.scala` L114-140 defines `secondaryDataSourceId` and `secondaryLaneStepId` over the same `SecondaryInput` discriminator. Its own scaladoc says "exactly one of the two ever applies to a given decoded config". `upsertOwnershipCheckF` matches only `UpsertSourceConfig` (`PipelineServiceSupport.scala` L189-199). So **at most one of ownership / lane / upsert is non-trivial for any request.**
- **Spec delta format:** both MODIFIED requirements copy the existing headers verbatim (`openspec/specs/pipeline-lane-rejoin-input/spec.md` L23, L35) and keep every existing scenario. The format is OK.
- **D3 (AC2):** the two lane tests at `DuplicateStepReferenceChecksSpec` L130-165 do have a matching PATCH call to compare against. The plan is executable.

### Verdict: REFUTE

### Change Requests

1. **D2 mutation (d) is unobservable, and D2 makes it mandatory.** Ownership, lane and upsert are mutually exclusive per decoded config (see the codec scaladoc above), so swapping lane and ownership cannot change any response. D2's rule ("each mutation must turn at least one test red for create, update AND duplicate; if none, add a test first") is unsatisfiable for (d), and the executor will either stall or fabricate. Revise D2:
   - State the disjointness explicitly.
   - Replace (d) with order mutations that can actually be observed. The precedence that really carries load is the position of create's `beforeUpsertF` (pipeline lookup plus editor check) relative to the other stages:
     - (d1) Run `beforeUpsertF` before ownership/lane. Create should turn red, e.g. a viewer grantee with a lane-to-ancestor config gets 400 today and would get 403 after the mutation. A caller with no pipeline access and a foreign source gets 404 "Data source not found" today and would get 404 "Pipeline not found".
     - (d2) Run upsert before `beforeUpsertF`. Create should turn red, e.g. a viewer grantee with a foreign upsert target gets 403 today and would get 404.
   - Say per path which mutations are expected to be red. Update and duplicate have a trivial `beforeUpsertF`, so they can't go red under (d1)/(d2). Their precedence is set by the pre-chain (editor check, type check, raw-config check), which stays outside the helper.
   - Restate D1's "single ordering site" claim accordingly. The order of the three stages among themselves is not a behaviour-bearing fact. The interleave with create's lookup/editor check is.
   - Require that the (d1)/(d2) red tests exist, or are added first.

2. **D4 must enumerate the prospective-descendant set for every create placement arm, not just "a create spliced in front of existing steps".** `persistNewStep` has six arms and each re-parents a different set. Specify each one, so the descendants are derived from the same anchor the insert uses:
   - (a) `parentStepId` splice: subtrees of all of the parent's current children.
   - (b) `parentStepId` + `attachAsTail`: the empty set.
   - (c) `rootId`, where `resolveRootTrunkAnchor` returns `Right(Some(a))`: subtrees of `a`'s children.
   - (d) `rootId` with `Right(None)`: subtrees of that root's parentless steps (scoped to that root, matching the repo's `(None, Some(rid))` query).
   - (e) `rootId` with `Left`, or an unknown root: the empty set. Persist returns its 422.
   - (f) `(None, None)` with no position: subtrees of trunk-last's children. This is reproducible today on a **plain append**: trunk-last T has a tail X, a new step N with a lane to X is accepted, the splice moves X under N, and the pipeline becomes unrunnable.
   - (g) `(None, None)` with `position = k`: subtrees of `current(k-1)`'s children; for `k = 0`, all root-level steps; out of range gives the empty set.

   Extend task 1.2's red repro beyond rootId+position. Add at least the plain-append-onto-a-tail-bearing-trunk-last case (f) and a `parentStepId` splice (a). Generalise the spec scenario "created at a position in front of existing steps" to "any create whose placement re-parents existing steps under the new step".

3. **Decide the pre-existing anchor mismatch in the `(None, None)` + `position` arm.** The lane check computes ancestors from trunk-last (`PipelineStepCreate.scala` L110-113), but the insert anchors at `current(index - 1)` (L314). Example: trunk `h -> A -> B -> C` and a `position = 1` create with a lane to B. B is a would-be descendant, but today it is rejected with the **ancestor** message, because the trunk-last chain contains it. Conversely, if `current(index - 1)` is a tail, a lane to that tail is a real ancestor and is accepted today. D4 says descendants use "the same anchor resolution the insert uses", while ancestors stay on trunk-last. The design must state which of these it does:
   - (i) Keep ancestors as they are (C2) and compute descendants from the real anchor. Document that the ancestor branch is checked first, so the existing "ancestor" message stays for the overlap. File the mismatch as a follow-up.
   - (ii) Align ancestors to the real anchor. This is a behaviour change, so it would need to be flagged alongside C1.

   Leaving it implicit invites an accidental C2 violation.

4. **Transitive lane cycles: scope them or close them, and don't let the spec overclaim.** Suppose step A lanes to X, and X lanes to B, where B is a descendant of A. That is a run-time cycle in the engine's Kahn walk (lane edges are dependency edges), yet it passes a descendant check that walks only `parentStepId`. The modified requirement is titled "A lane reference forming a cycle is rejected at write time". Pick one:
   - (i) Compute "descendants" as the forward closure over parent edges plus lane edges (`laneTarget -> referrer`). This is recommended: it is the same cost, and it is what "cycle" means to the engine. The duplicate-keeps-empty argument above still holds under this closure.
   - (ii) Explicitly scope it out: record a red probe of the transitive case in the report, list it as a follow-up, and word the spec delta as "names one of its descendants" rather than implying that all cycles are caught.

### Non-blocking notes

- **Pre-existing existence/topology oracle on create, worth a follow-up ticket and not to be changed here (C2).** The create lane check runs before `findByIdShared` and reads `listByPipelineInternal(pipelineId)`, which bypasses RLS. A caller with no access to a pipeline can tell a 422 "does not exist in this pipeline" apart from a fall-through 404 "Pipeline not found", and a 400 ancestor response leaks topology. The new descendant branch widens this slightly. Mention it in the executor report and the PR.
- **`rejectIfReparents = true` precedence.** A lane to a would-be descendant used to reach the repo and fail with `ReparentRejected`. It will now be a 400 lane-cycle first. This is newly-rejected input only, but call it out in the OWNER REVIEW section.
- **Requirement title.** "A lane reference may name any non-ancestor node" becomes slightly inaccurate. Renaming it would need a RENAMED delta; leaving the title alone is acceptable.
- **D1 lazy `laneScopeF`.** The plan holds. Make sure create's scope computation still returns empty ancestors and descendants on an unknown root or an out-of-range position, so `validateLaneReference`'s 422/400 precedence over persist's 422 is unchanged.
