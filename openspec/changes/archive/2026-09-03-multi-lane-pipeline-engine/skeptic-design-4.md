## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Read all three prior reports, then re-derived from the artifacts and the live specs.

1. **Round-3 CR1 (MODIFIED blocks titled with non-existent headers) — FIXED, verified
   independently.** I re-ran the header-match check with my own script: for every
   `### Requirement:` under a `## MODIFIED` / `## REMOVED` heading in
   `changes/multi-lane-pipeline-engine/specs/**`, assert the identical header exists in
   `openspec/specs/<cap>/spec.md`. Result: **0 mismatches across 19 MODIFIED + 4 REMOVED**
   (round 3 measured 0/18 matching; it is now 23/23). The two capabilities with no live
   spec (`pipeline-lane-walk`, `pipeline-lane-rejoin-input`) are purely `## ADDED`, correctly.
2. **Scenario preservation on MODIFIED — verified myself, not via `openspec validate`.**
   For each matched MODIFIED block I diffed its `#### Scenario:` titles against the live
   requirement's. **Zero dropped scenarios.** (I did not rely on validate for this: validate
   only checks requirements it *finds*, which is exactly the hole round-3 CR2 named.)
3. **REMOVED blocks carry Reason + Migration** and each names the ADDED requirement that
   preserves the behaviour, including HEL-950's empty-seed-id exemption
   (`pipeline-joinstep-right-source-acl:50`, `pipeline-union-op:64`, `pipeline-execution:61`).
   The `pipeline-execution` Phase-1-invariant removal is removed outright with a stated
   replacement guarantee — correct, that is the ticket.
4. **Round-3 CR2 (10.2a's sweep proves nothing) — ADDRESSED.** `tasks.md` 10.2a is now the
   header-match check with the "validate stays green either way" caveat stated; 10.2b is the
   property sweep, explicitly labelled as proving nothing until after archive. The
   disposition and the rule are recorded in `design.md` under "Delta-authoring disposition
   (round-3 CR1)", and the `pipeline-step-tree` misfiling it caught is recorded there.
5. **`openspec validate --strict`**: green apart from one RFC-2119 wording warning on an
   ADDED requirement in `pipeline-lane-rejoin-input`. Cosmetic.
6. **Decision 1b — I judge it FAITHFUL to Q1=B. It should not go back to the owner.**
   I read the live requirement rather than the summary of it.
   `openspec/specs/pipeline-step-config-read-strictness/spec.md` contains two requirements
   that together draw exactly one partition: *present key of the wrong JSON type* SHALL fail
   to decode; *absent key* SHALL decode to its existing default. Decision 1b maps the new
   field onto that same partition with no new axis invented — absent `secondaryInput` →
   `{"kind":"source","dataSourceId":""}` (the tolerant default, matching the live "a `join`
   configuration that omits `joinKey` … `joinKey` holds its existing empty default"
   scenario); present legacy flat field / unrecognised `kind` / mismatched field → hard named
   error. What Q1=B ruled out was *tolerating the old shape*, and under 1b the old shape
   still errors — so 1b is if anything stricter than the live read-path requirement demands,
   not a softening of the owner's decision. It is also the same absent-vs-present distinction
   round 2 already accepted for Decision 1a's empty id. Escalating it would re-ask a question
   the live spec already answers.

7. **The property that the two prior CRs were really about — I checked it directly, and it
   is not yet closed.** See the Change Request. Method: for every live `openspec/specs/*`
   requirement whose header or body contains a legacy field name (`rightDataSourceId`,
   `otherDataSourceId`, `lookupDataSourceId`), assert it is covered by a MODIFIED or REMOVED
   block in this change. Six of the seven legacy-bearing capabilities are fully covered.
   `pipeline-union-op` is not. Reproduced twice (full script, then a per-header
   `grep -c` live-vs-delta comparison) — stable, not a tooling artifact.

### Verdict: REFUTE

### Change Requests

1. **`pipeline-union-op`: four of the seven live requirements still specify the union
   config as `otherDataSourceId` and no delta touches them. Post-archive the capability
   would specify two contradictory config shapes in one file.**

   The delta (`changes/.../specs/pipeline-union-op/spec.md`) contains exactly three blocks:
   MODIFIED *"Union op stacks rows from a second DataSource"*, ADDED *"Union secondary-input
   ownership is checked only for source-kind inputs"*, REMOVED *"Union step second-source
   reference must be caller-owned on creation and update"*. Untouched, and each stating the
   deleted field in its body or scenarios:

   - `openspec/specs/pipeline-union-op/spec.md:37` — *"Union op fails descriptively on
     unresolvable source or unsupported mode"*; body `:38` "when `otherDataSourceId` is
     missing", scenarios `:43`/`:48` titled *"Missing otherDataSourceId fails at execute
     time"* / *"Unresolvable otherDataSourceId fails at execute time"*.
   - `:59` — *"Union op analyze-inference is a documented best-effort passthrough"*; `:68`
     specifies the config as `{"otherDataSourceId": "<id>", "mode": "byName"}`.
   - `:82` — *"Frontend StepCard renders a union config editor…"*; `:84` "an other-source
     picker (`otherDataSourceId`)", `:93`/`:98` patch/persist assertions on
     `otherDataSourceId`. This surface is in scope: `design.md` contract item 5 enumerates
     "the frontend editors".
   - `:144` — *"MCP `add_pipeline_step` tool supports the union op"*; `:146` "shape
     (`otherDataSourceId`, `mode` …), so agent-driven pipeline …". Also in scope per the
     same contract item ("the MCP tools").

   Verification I ran (please reproduce, don't take my word):
   `for r in "Union op fails descriptively" "analyze-inference is a documented" "Frontend StepCard renders a union" "MCP add_pipeline_step tool supports the union"` → `live=1 delta=0` for all four.

   **Fix on the property, not on these four headers.** The generalised defect is that both
   surviving guards check a *weaker* thing than the property they were filed for:
   - 10.2a asserts every MODIFIED/REMOVED title targets a *real* requirement. It says nothing
     about whether every *legacy-bearing* requirement is targeted — a delta can be 100%
     header-matched and still leave the legacy text standing, which is precisely the state
     the change is in now.
   - 10.2b is file-level: "all seven now have deltas addressing the legacy text". Each of the
     seven does have *a* delta. `pipeline-union-op` shows that file-level coverage is not
     requirement-level coverage. This is the round-1 failure mode one granularity down —
     round 1 named two files and exactly two got fixed; round 3 named seven files and each
     got at least one block.

   So: add a **third, requirement-level** check (and run it), stated on the property —
   *for every requirement in every live `openspec/specs/<cap>/spec.md` whose header, body or
   scenario titles contain a legacy field name, assert that requirement header appears under
   a `## MODIFIED` or `## REMOVED` block of this change; report the count and the residue.*
   It currently reports four; it must report zero. Then dispose of the four above under the
   rule already recorded in design.md — note that at least two of them (`:37`, `:82`) have
   **scenario titles embedding `otherDataSourceId`**, so by that rule they are REMOVED +
   re-ADDED, not MODIFIED. Update the per-capability disposition paragraph accordingly.

### Non-blocking notes

- Decision 1b's two bullets overlap on one concrete row: a legacy stored config
  `{"otherDataSourceId":"x","mode":"byName"}` has `secondaryInput` **absent** *and* a legacy
  flat field **present**. The prose resolves it the right way (legacy-present wins → hard
  error), but the precedence is implied rather than stated. One clause — "a present legacy
  flat field is checked before the absent-key default" — would remove the ambiguity for the
  implementer. V97 makes this unreachable for migrated rows, which is why this is a note.
- `openspec validate --strict` warns that the ADDED requirement "A lane reference may name
  any non-ancestor node…" (`pipeline-lane-rejoin-input`) lacks SHALL/MUST. Cosmetic.
- `tasks.md` still lists 9.7 and 9.8 between 9.4 and 9.5 (carried from rounds 2 and 3).
  Cosmetic; third time it has been noted.
- The Engine contract section: I agree with round 3. Nothing in it drives this REFUTE, and
  CR1 above should require no change to it.
