## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 CR disposition — checked against the artifacts, not the prose that claims them.**

| CR | Landed? | Evidence |
|---|---|---|
| CR1 → R12 | **Partially** | `design.md` R12 exists; V98 step 2 widened to four tables and step 4a added; `tasks.md` 2.3/2.5a/3.6a/5.8; `pipeline-multi-root/spec.md` "An Output or snapshot bound to the root binds to a root id, never to NULL". **But the encoding is not complete — see CR-A/CR-B/CR-C below.** |
| CR2 → R10 | **Yes** | R10 rewritten, retracts the "consumed once … transitional" claim by name, roots `trunkOf`/`tailsOf`, states the rows/trunk-terminal/binary-ref-key same-root-same-node rule and requires a divergence test. `tasks.md` 4.4 adds `trunkOf` (`:727`) + `tailsOf` (`:771`); 5.5 states the agreement and the failing test. |
| CR3 | **Half** | design R3 narrowed to "no **semantic** behaviour" naming three tiebreaks — real. `pipeline-run-execution/spec.md`'s zero-step scenario is now single-root-qualified with a new multi-root scenario — real. **But the spec delta that carries the SHALL was not touched — see CR-D.** |
| CR4 → R13 | **Yes** | R13 (`rootClientId`, three named BadRequests, no default to `roots[0]`), `tasks.md` 7.3a, and a full spec requirement + four scenarios in `pipeline-multi-root/spec.md`. |
| CR5 | **Yes** | V98 step 8 now per-command (`FOR SELECT USING (helio_can_access_pipeline(pipeline_id))` + owner-only IUD), states the Postgres USING-as-WITH-CHECK mechanism; `tasks.md` 2.8 + 3.6b (grantee can read, cannot write). |
| CR6 | **Yes** | V98 step 4 adds `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))`; `tasks.md` 2.5 + 7.3b; new spec requirement "POST /api/pipelines/:id/steps appends a step against a parent or a root" with a DB-rejection scenario. |
| CR7 | **Yes** | R7 restructured into "Phase 1 — refuse, before touching anything" / "Phase 2 — report, then delete, atomically"; `tasks.md` 7.5 restates it. |
| CR8 | **Yes** | "Accepted end state" section names HEL-969 (blocked by HEL-913 only), and `tasks.md` 10.2 names the two expected-red specs and states any other red spec is this change's defect. |
| CR9 | **Yes** | `pipeline-execution/spec.md` is now REMOVED + ADDED with the openspec "MODIFIED may not drop scenarios" reason stated; the duplicate pre-HEL-911 scenarios are gone from the ADDED block. |
| NB: RLS mechanism | **Yes** | V98 header section now correctly attributes the silent read to V39's `helio_can_access_pipeline` fail-false and notes V35's form would have raised. Matches `V39:38-45`/`:78-83` and `V35:63`, which I re-read. |
| NB: R14 | **Yes** | R14 fixes `roots[<i>] › steps[<i>]` as this change's request address; `tasks.md` 7.3c. |
| NB: R15 | **Yes** | R15 names the four wire surfaces and forbids null-means-root; `tasks.md` 5.7; spec requirement "A root is identified on the wire by its id, never by a null node". |

**Ground truth re-read myself (not from the reports):** `V94__outputs_model.sql:200` (NULL node_step_id = raw source),
`:209`, `:281`, `:286-296` (the partial-unique-index pair), `:299-320` (node_snapshots policies), `:1329-1330` (FORCE),
`:425-427`/`:438` (binary_refs re-key), `V46__binary_refs.sql:12,25,33-40`, `V39:38-45,:78-95`, `V35:63`,
`NodeSnapshotRepository.scala:14,38-51,58-74,101-107`, `OutputRepository.scala:63-66,:160-190,:247-249,:290`,
`OutputService.scala:88-94,:138`, `OutputRoutes.scala:36-37`, `BinaryRefRepository.scala:28,36,42-52,63-86`,
`model.scala:827-835`, `OutputProtocol.scala:26,40,95`, `DemoData.scala:56`.

### Verdict: REFUTE

Eight of the nine CRs landed as real changes to rules, migration steps, spec deltas and tasks — not as prose. The
revision is a genuine one. But R12 — the round-1 finding the design itself calls "the highest-severity finding" —
was fixed as a *rule about two tables* rather than as a *sweep of the encoding*, and the same NULL-means-root
encoding lives in at least one more table and in three more code paths that nothing in the change touches. Two of
those are silent cross-root data destruction, which is the exact failure class R12 exists to prevent. Plus one
merged-SHALL contradiction that CR3 fixed in `design.md` and left standing in the spec delta.

### Change Requests

1. **`binary_refs` is a third table with the same NULL-means-root encoding, and it is outside R12 and outside the
   V98 bracket.** `V94:425-427` gave `binary_refs` a nullable `node_step_id`, and
   `BinaryRefRepository.scala:28` states the encoding in terms: *"`nodeStepId = None` means the ..."* [pipeline root].
   `overwriteForNode(pipelineId, nodeStepId, refs)` (`:42-52`) deletes on `node_step_id IS NULL` when the key is
   `None` — i.e. **pipeline-wide, not root-wide**. Under multi-root, writing root B's binary refs deletes root A's.
   `findByNode`/`findByNodeAndRow`/`selectQuery` (`:63-86`) read the same way, so a root-bound binary ref is
   additionally read across roots. `binary_refs` is FORCE RLS (`V46:34`), so any V98 DML against it needs the bracket
   too. R12 names only `outputs` and `node_snapshots`; V98 brackets four tables; `tasks.md` never mentions
   `binary_refs`. Required: extend R12's rule to `binary_refs`, add it to the V98 bracket and rebind (making the
   bracket **five** tables), and root-scope `overwriteForNode`/`findByNode`.

2. **`idx_node_snapshots_root_unique` makes two roots' snapshots collide, and `NodeSnapshotRepository.overwriteRows`
   makes one root's write delete the other's.** R12 keeps `node_step_id` NULL for root-bound rows and adds a sibling
   `root_id`. But `V94:294-296` is `CREATE UNIQUE INDEX idx_node_snapshots_root_unique ON node_snapshots(pipeline_id,
   row_index) WHERE node_step_id IS NULL` — under R12's encoding, root A row 0 and root B row 0 are both
   `node_step_id IS NULL` with the same `(pipeline_id, row_index)` and **violate that index**. And
   `NodeSnapshotRepository.scala:43` deletes `WHERE pipeline_id = $pipelineId AND node_step_id IS NULL` before
   inserting, so whichever root writes second first *wipes* the other root's snapshot rows — silent, and exactly the
   stale-dashboard vector R12 was written to close, reintroduced by R12's own encoding. V98 must drop and recreate
   that partial index as `(pipeline_id, root_id, row_index) WHERE node_step_id IS NULL`, and
   `overwriteRows`/`fetchRows` (`:38-51`, `:58-74`, `:101-107`) must take a `NodeKey`, not an `Option[String]`.
   Neither the index nor the repository appears in `design.md` or `tasks.md`.

3. **R12's code-side sweep is one task (5.8) against a surface of at least six sites.** Task 5.8 covers only
   `PipelineRunService.scala:891`. Untouched anywhere in `tasks.md`: `OutputRepository.listByNodeInternal:63-66`
   (`nodeStepId.isEmpty` — returns *every* root's Outputs under multi-root), `insertInternal:160-190` and the
   `OutputRow`/`*` projection (`:275`, `:290`, `:301`) which have no `root_id`,
   `OutputService.create:138` and `CreateOutputRequest` (no way to create a root-bound Output once NULL is invalid —
   the R12 CHECK would make every such create fail), `OutputService.listByPipeline:88-94`,
   `OutputRoutes.scala:36-37`'s `nodeStepId` query parameter, `OutputProtocol.scala:26,40,95`, `model.scala:835`
   (`NodeRef.nodeStepId: Option[String]`, whose comment at `:830` states the NULL encoding),
   `ProposalOutputSummary` (`PipelineProposalProtocol.scala:126`), and `DemoData.scala:56`. §8 lists three schemas and
   none of them is an output schema. Required: enumerate the R12 surface the way §1 enumerates the
   `sourceDataSourceId` surface — by the *encoding*, per this design's own closing lesson — and carry `root_id`
   through the model, protocol, schema, route and repository, not just the run-service intersect.

4. **CR3 was fixed in `design.md` and left standing in the spec delta — the merged-SHALL contradiction round 1
   raised is still there, verbatim.** `specs/pipeline-multi-root/spec.md`, requirement "Root order is deterministic
   and presentational, never semantic", still reads: *"**No behaviour SHALL branch on a root's position; no root SHALL
   be treated as primary.**"* — unqualified. Meanwhile the same change now adds, in
   `specs/pipeline-run-execution/spec.md`, the scenario *"Run with no steps on a multi-root pipeline returns the
   lowest-positioned root's rows"*, plus the canonical-path-through-the-lowest-positioned-root SHALL in the same file.
   The spec deltas therefore contradict each other, and the change would still merge a spec it violates. `design.md`
   R3's narrowing to "no **semantic** behaviour … three deterministic tiebreaks" is the correct text; it must be
   carried into the spec's SHALL. (This is precisely the "revision that adds a paragraph without changing the rule"
   pattern — the paragraph is excellent, and the binding artifact was not updated.)

5. **V98 step 7 still says "both tables" after step 2 was widened to four.** Order of operations step 7:
   *"Restore `FORCE ROW LEVEL SECURITY` on **both** tables"*. `tasks.md` 2.3 correctly says four. Taken literally,
   V98 leaves `outputs` and `node_snapshots` permanently `NO FORCE` — a real, durable RLS weakening on two
   sharing-aware tables, shipped by a migration whose whole thesis is RLS care. Fix step 7 to enumerate every
   bracketed table (five, after CR1). Relatedly, `tasks.md` 2.2 still instructs the V98 header comment to
   *"Name `pipelines` (read) and `pipeline_steps` (written)"* — the header is the artifact designed to teach the
   next reader, and as specified it teaches a two-table bracket the migration does not use.

6. **Step 5's hard assertion — "the single most important statement in V98" — does not cover step 4a.** V98 step 5
   and `tasks.md` 2.6 assert only that every pipeline has a root and every parentless step has a `root_id`. The R12
   rebind is a separate DML against two (per CR1, three) additional FORCE-RLS tables, and it fails silently in
   exactly the same way if the bracket is wrong for those tables — that is the stated reason for widening the
   bracket at all. Required: extend the step-5 `DO $$ … RAISE EXCEPTION` guard to assert zero remaining rows with
   both `node_step_id` and `root_id` NULL in `outputs`, `node_snapshots` (and `binary_refs`), before the drop; and
   extend `tasks.md` 3.5 ("prove the guard fires") to seed that failure condition too. As written, the R12 CHECK in
   step 4a would fail the migration *if* the rebind ran and missed rows — but if the bracket is wrong the rebind
   writes nothing and the CHECK still passes on a table where every root-bound row was already NULL/NULL only
   *because* the UPDATE was invisible; the guard is what distinguishes those.

7. **`outputs.root_id` / `node_snapshots.root_id` have no stated FK or delete behaviour.** R7 phase 2 requires
   deleting "any Outputs/`node_snapshots` bound to the root itself", and step-bound Outputs get that today for free
   via `node_step_id … ON DELETE CASCADE` (`V94:209`). V98 step 4a says only "add nullable `root_id`". State whether
   it is `REFERENCES pipeline_roots(id) ON DELETE CASCADE` (which would make R7 phase 2 partly automatic and would
   also make the CHECK a genuine invariant) or a bare column the service must clean up. `node_snapshots.pipeline_id`
   is notably *not* a FK today (`V94:279`), so do not assume the answer is uniform across the two tables.

### Non-blocking notes

- **The HEL-914 sufficiency AC is now met for the create/address surface** — R13 + R14 + R5's two-address table
  together answer "how does a step name its root" and "what does a validation error look like" without re-derivation.
  It is **not** met for Output binding: HEL-914 proposes/applies Outputs, and after R12 there is no defined wire shape
  for "an Output bound to root R" (CR3 above). Closing CR3 closes this too.
- **R-clause numbering is out of order** in `design.md` (R10, R12, R13, R14, R15, then R11). R11 is the only clause a
  reader is likely to miss as a result. Cosmetic.
- **The closing "what the design gate taught" section is the best thing in the document** and states the exact rule
  that would have caught CR1/CR2 of this round ("when a sweep is keyed on names, enumerate separately the
  *encodings*"). It is stated but not yet *executed* — CR2 above is that enumeration being demanded rather than
  described.
- **`pipeline-execution`'s REMOVED+ADDED** modelling reads clean; the ADDED block's five scenarios cover the
  multi-root seeding, single-root parity, mid-graph lane, disabled-step, and fan-out cases with no duplicates left.
