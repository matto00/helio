## Skeptic Report — final gate (round 2, axis: deletion-sweep completeness)

HEAD verified: `5977223a`. Every command below re-run fresh in the worktree; no conclusion
inherited from round 1, the executor's report, or any evaluation.

### What I verified (with evidence)

**1. Round-1 CR1 (six stale package READMEs) — FIXED, verified file-by-file.** For each of the six
I `cat`'d the README and `ls`'d its directory:
- `domain/panels/README.md` — now names `DividerPanel`/`ImagePanel`/`MarkdownPanel`/`OutputPanel`/
  `TextPanel`/`OutputBindingSpec`/`PanelConfigCodec`; directory contains exactly those plus
  `package.scala`. Deleted family named only as history ("replacing the former …").
- `api/protocols/pipelines/README.md` — Holds list = the 8 files present, no `DataTypeProtocol`.
- `api/routes/pipelines/README.md` — Holds list = the 10 files present, no `DataTypeRoutes`.
- `api/protocols/panels/README.md` — Holds `PanelCapabilityProtocol`, `PanelProtocol`; matches.
- `api/routes/panels/README.md` — Holds `AutoLayoutRoutes`, `PanelRoutes`; matches.
- `services/panels/README.md` — Holds list = the 6 files present; correctly records
  `PanelCapabilityService`'s retarget onto `OutputId`.
No README backticked class name fails to resolve on the filesystem. **CR1 closed.**

**2. Round-1 CR2 (`patch-set.schema.json`) — fixed in that ONE file, but the same defect survives
in its two siblings.** `git diff main...HEAD -- schemas/patch-sets/` touches exactly one file
(`patch-set.schema.json`, 3 insertions/3 deletions). The enum is now
`["panel","dashboard","dataSource","pipeline","pipelineStep"]`, `"metric"` is absent, and both
descriptions were updated. Matches `PatchSetProtocol.scala:66-67`'s `recognizedKinds`. But see
Change Request 2 — the identical enum one file over is untouched.

**3. AC 6.1 grep, run verbatim, then narrowed to real code.** After excluding
`src/main/resources/db/migration/**` and `src/test/resources/db/fixtures/hel904-real-dump.sql`,
filtering `src/main` to non-comment lines leaves **exactly 15 hits in 5 files**, all of them
Exemption 1 and Exemption 2: `PipelineProposalProtocol.scala:117`,
`CombinedProposalService.scala:82,163,165,167`, `PipelineProposalService.scala:325,416,446`,
`WorkspaceContextService.scala:357,878,880,888`, `WorkspaceContextProtocol.scala:56,58,126`. Every
other match in `src/main` is a prose comment. **Nothing unexempted survives.**

**4. The expanded exemption list is genuinely justified, not rubber-stamped.** I re-derived each:
- Ex.1/Ex.2 — re-confirmed as round 1 did: all `String`-typed wire field NAMES, no `DataTypeId`
  value survives; `grep -rln outputDataTypeId helio-mcp/src frontend/src` still returns 30+
  out-of-scope files.
- Ex.3 (`PipelineAnalyzeProposalResponse.outputDataTypeName`) — real field, same agent-facing
  proposal surface as Ex.1; renaming one without the other would leave the pair inconsistent.
  Legitimate.
- Ex.4 (`AssistantProposalToolSchemas` mirror) — verified it is a Claude-facing tool-call JSON
  schema mirroring Ex.3's field name, not a comment. Legitimate.
- Value-exemption (`"dataType"` `resourceType`) — verified the shipped code really does emit it
  from `OutputRepository` (not the deleted `DataTypeRepository`), and that the
  `workspace-resource-search` spec delta was corrected to match shipped behavior rather than the
  code being bent to match a plan. Legitimate.
None of the four reads as "added to make a finding go away."

**5. Frontend `patchSet.ts` out-of-scope characterization — CORRECT, not a REFUTE.** `npm run
typecheck` (`tsc --noEmit`, frontend) is **green** at HEAD with the file unchanged. The union arm
has 7 importers but no production construction site: `grep -rn 'kind: "dataType"' frontend/src
helio-mcp/src` returns exactly two hits, both in `frontend/src/features/patchSets/ui/
PatchSetReview.test.tsx` (a test fixture). No live TS code builds an `EditTarget` with `"dataType"`
that would now be silently wrong. And the deferral target is REAL, not phantom: the design doc's
row table (line 222) explicitly assigns P1.4/HEL-907 "proposal + patch-set schemas and services
(**both sides**)". I grepped it rather than trusting the citation. **Not a finding.**

**6. Phantom-deferral sweep across THIS round's new notes** (`execution-progress.md` items 1-10 of
the current cycle). Each deferral target grepped, not trusted:
- Item 8's own claim that no `tasks.md` task owns `patch-set.schema.json` → **re-derived and
  correct**; `grep -n "patch-set\|PatchSet" tasks.md` returns no owning task.
- "Not fixed this cycle … `patchSet.ts` … likely HEL-907/P1.4" → **real target**, per item 5 above.
- Item 10's design.md exemptions → **real**, all four + the value-exemption exist verbatim in
  `design.md:317-405` with a matching `specs/workspace-resource-search/spec.md` delta.
No new phantom deferral found this round.

**7. Compile + full suite, fresh single-threaded clean run (HEL-924 protocol).**
`sbt -batch 'set Test/parallelExecution := false' clean compile Test/compile test` →
`Total number of tests run: 3345`, `Tests: succeeded 3345, failed 0, canceled 0`, `EXIT=0`.
Round 1's one anomalous `V94OutputsMigrationSpec` failure did not recur; it is confirmed as stale
compiled artifacts, closing round 1's open risk note.

### Verdict: REFUTE

Two findings. Finding 1 is the significant one — it is systematic, contract-facing, was not caught
by any prior gate, and lands in *newly added* files this branch owns outright.

### Change Requests

1. **31 mechanical string-substitution corruptions across 11 newly-added OpenSpec deltas.** The
   deletion sweep sed-replaced deleted class/field names inside spec prose and produced
   ungrammatical, factually wrong requirement text. All 11 files are `A` (added) in
   `git diff --name-status main...HEAD`, and all the damage sits under `## MODIFIED Requirements`
   — i.e. this is the authoritative text that gets archived into `openspec/specs/`, not quoted
   history. Reproduce with:
   `grep -rn "the pipeline/Output services\|Output/node[A-Z]\|the Output's config\|outputOutput" openspec/changes/outputs-model-migration/specs/`

   Representative cases, each of which contradicts the code I verified in item 3/4 above:
   - `specs/panel-data-freshness/spec.md:6` — "`PipelineRepository` SHALL provide
     `findLastRunAtByOutputOutput/nodeId(id: Output/nodeId)`". Not a valid identifier, **and** the
     method was *removed outright* by task 4.1 (`PipelineRepository.scala:273` says so in a
     comment). The delta asserts a `SHALL` for a capability this very ticket deleted. Repeats at
     lines 14, 18, 22, 26.
   - `specs/pipeline-list-api/spec.md:7-8` — `GET /api/pipelines` "SHALL include …
     `outputOutput/nodeName`, `outputOutput/nodeId`". The real, *exempted* wire fields are
     `outputDataTypeName`/`outputDataTypeId` (Exemption 2, verified live at
     `WorkspaceContextProtocol.scala:126`). The spec now documents a field that does not exist.
     Same at line 18, and identically in `specs/pipeline-analyze-api/spec.md:7`,
     `specs/pipeline-proposal-contract/spec.md:7,12,16,39`,
     `specs/pipeline-proposal-analyze-api/spec.md:23`.
   - `specs/patch-set-apply/spec.md:28` — "a panel-update edit whose config patch sets `the
     Output's config` to a metric the caller does not own". `metricId` was replaced by the phrase
     "the Output's config", making the sentence meaningless. Same at lines 9, 70, and
     `specs/patch-set-undo/spec.md:26`.
   - `specs/patch-set-apply/spec.md:36,53` — `Output/nodeResponse` in the prior-state shape list
     (was `DataTypeResponse`), a type that exists under neither name.
   - `specs/patch-set-apply/spec.md:59` — "`sourceDataSourceName`/`outputOutput/nodeName`".
   - `specs/patch-set-preview/spec.md:13,15` — "mirrors `the pipeline/Output services.applyUpdate`"
     / "`the pipeline/Output services.delete`'s two conflict checks" (was `DataTypeService.*`).
   - `specs/resource-tagging/spec.md:6` — "`DataSourceService`, `PipelineService`, and `the
     pipeline/Output services` create paths SHALL accept…".
   - `specs/workspace-context-assembly/spec.md:6,336-337` — "Output/nodes" as a resource noun;
     hints "reporting `leftOutput/nodeId` … `rightOutput/nodeId`" where the live, exempted wire
     keys are `leftDataTypeId`/`rightDataTypeId` (`WorkspaceContextProtocol.scala:56,58`).
   - `specs/metric-crud-api/spec.md:5,9,13,17,21` — the identical Migration sentence pasted five
     times verbatim under five different removed requirements.

   Fix: rewrite each affected requirement/scenario in real prose against the shipped code, and for
   the wire-field cases specifically, use the actual exempted names (`outputDataTypeId`/
   `outputDataTypeName`/`leftDataTypeId`/`rightDataTypeId`) that `design.md`'s exemption list has
   now formally blessed — the specs and that list currently disagree with each other. `openspec`'s
   live `openspec/specs/` tree is clean of this pattern (grepped), so the corruption is entirely
   this branch's.

2. **`schemas/patch-sets/` is now internally inconsistent — CR2 was fixed in one of three files.**
   - `schemas/patch-sets/patch-set-preview-response.schema.json:30` still declares
     `"enum": ["panel","dashboard","dataSource","dataType","pipeline","pipelineStep"]` for
     `EditPreview.kind` — the exact enum, with the exact rejected value, that CR2 had removed from
     the request schema. The published contract now says a preview response may carry a `kind` the
     request schema forbids and `PatchSetProtocol` hard-rejects at parse.
   - `patch-set-preview-response.schema.json:20` and `patch-set-apply-response.schema.json:29` both
     still name `DataTypeResponse` in their before/after and priorState shape lists, and the latter
     still describes "a dashboard/dataSource/**dataType**/pipeline delete-rollback", plus both say
     "six-way oneOf" where five kinds now remain.

   Either finish the narrowing across all three files (preferred — it is the same one-line edit
   already made once) **or**, if `schemas/patch-sets/*` is genuinely wholly P1.4's per
   `design.md:144` ("Proposal and patch-set schemas … `schemas/patch-sets/*` are owned by P1.4"),
   revert the partial fix and record the whole directory as a named exemption. What must not ship
   is the current state: one file narrowed, two not, with no note explaining the split. Note this
   also weakens the executor's own item-8 claim to have "closed the exact phantom-deferral
   pattern" — the deferral it closed still stands, unclosed, in the adjacent files.

### Non-blocking notes

- The `metric-crud-api` delta's five identical pasted Migration sentences (CR1's last bullet) are
  cosmetically the least severe of the 31 and could be reduced to one shared note.
- Round 1's open risk (the one-off `V94OutputsMigrationSpec` failure) is now closed: a fresh
  `clean compile Test/compile test` single-threaded run is 3345/3345 green, exit 0.
