## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD: `cac4a975559425d78d79e33c2b04ede73c64a314`. Base `260943222894a97e2d65447ff9b00a7e7f57df89` was resolved live with `resolve-review-base.sh` (exit 0). The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=bug/guard-source-delete-config-refs/HEL-1252`. The working tree was clean.

### What I verified (with evidence)

**Diff since round 2 (`git diff 4ada48c0 HEAD`)**
- Outside `openspec/changes`, five hunks changed, and none of them is behavioural:
  - the docblocks in `DataSourceProtocol.scala`, `DataSourceDeleteError.scala`, `sourcesSlice.ts` and `SourceDeleteConflictNotice.tsx`;
  - the top-level `description` in `data-source-delete-conflict-response.schema.json`;
  - one Jest `it(...)` name in `sourcesSlice.test.ts`.
- Inside `openspec/changes`, it adds `evaluation-3.md`, `evaluation-4.md` and `skeptic-final-2.md`.
- This confirms that no behavioural code changed.

**Round-2 CRs 1–5**
- **CR1–CR4 are resolved.** Each of the four docblocks and the schema description now states the shipped contract: structured `hiddenPipelineCount`/`hiddenPanelCount`, copy composed in the UI, and `message` used only as a fallback.
- **CR5:** the grep returns 0 hits (exit 1).

**Gates (fresh, run by me)**
- `nice -n 19 sbt testFull`: `Tests: succeeded 5590, failed 0`, EXIT=0. `DataSourceReferenceGuardNonSuperuserSpec` and `V100ZeroRootGuardNonSuperuserSpec` both ran. I then ran `sbt --client shutdown`.
- Jest on `src/features/sources` and `src/features/toasts`: 34 suites, 302 passed.
- `npm run typecheck` is clean.
- `eslint --max-warnings=0 src/features/sources` exits 0.
- `prettier --check` is clean.

**Substance, re-checked cold**
- **Owner ruling: 409 on any reference.**
  - I re-grepped the domain for source-id fields myself. The only persisted carriers are:
    - `PipelineRoot.dataSourceId`
    - `SecondaryInput.Source` (join/lookup/union)
    - `UpsertTarget.ExistingSource`
    - `FormPanelConfig.dataSourceId`
  - These match R1–R4 in `DataSourceReferenceRepository.scala:59-98`.
  - Disabled steps are not filtered out. Decoding reads only the reference sub-object.
- **Visibility.** The predicate is explicitly owner OR `rp.grantee_id = viewer` (lines 61-63, 76-78, 92-94). A grantee-less grant or a third-party grant never confers visibility (C1).
- **Hidden identities stay hidden (C2).**
  - Hidden ids live only in the private `PipelineHit`/`PanelHit` case classes. `SourceReferences` carries only visible refs and counts.
  - The P0001 warn logs in `DataSourceService` and `WorkspaceTeardownRepository` carry the source id and SQLSTATE only.
  - The in-tx teardown re-check `SELECT 1`s and returns an identity-free reason.
- **Teardown.**
  - The authoritative check is `dependentConflicts`, on the privileged pool with an explicit `owner_id = caller AND tag = T`.
  - The exemption covers only caller-owned, T-tagged pipelines and dashboards.
  - It also runs on dryRun.
- **RLS proof.**
  - The spec creates `helio_migration_test ... NOSUPERUSER ... NOBYPASSRLS`.
  - It asserts `appRoleSeesPipeline(...) shouldBe false` as liveness.
  - Round 2 recorded mutations: M-RLS turned 15 tests red, and dropping the grantee predicate turned 6.2c red. The finder and spec are byte-identical since round 2 (the diff above), so those results still apply to this HEAD.
- **UI.**
  - `SourceDeleteConflictNotice.tsx` changed only in a comment since round 2, which verified it in light and dark in the running app. Its screenshots are under `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/skeptic-final2-*.png`.
  - The render path is unchanged, so I did not re-screenshot. This is the one place I rely on prior evidence, justified by the diff.

**Sweep for remaining text that contradicts shipped behaviour**
- Clean: `design.md` D3/D6, both spec deltas, the schema, the MCP `delete_data_source` description, and the finder, service, protocol and teardown docblocks.
- Three stale spots remain (see the CRs).

### Verdict: REFUTE

Behaviour, security and the proofs are sound. The block is narrow and of exactly the class round 2 refuted on: text in the branch still asserts behaviour the code does not have. The round-3 brief asked for this to be zero. One instance is a live code comment that is false for a reachable input.

### Change Requests

1. **`frontend/src/features/sources/state/sourcesSlice.ts:91-92` and `:97-98`.**
   - Both say that when the counts are absent (an older server), "the notice falls back to `message`".
   - That is false whenever the body names any pipeline or panel. `SourceDeleteConflictNotice.tsx:54-57` falls back only when `!hasNamed && !structured`.
   - An older HEL-989 body with a visible pipeline plus a hidden one renders "the items below" and drops the hidden mention.
   - Make the comments state the real rule: fallback only when there are no named refs and no counts. The component docblock at `:35-40` already words it correctly.
   - Alternatively, if dropping the hidden mention during a deploy-skew window is not acceptable, change the behaviour and add a test. A comment fix alone is sufficient.
2. **`openspec/changes/guard-source-delete-config-refs/tasks.md:42`.**
   - Checked task 5.2 reads "Notice: always shows reason (mixed visible+hidden)". The shipped notice never shows the reason; it composes copy and states the hidden counts.
   - This file is archived with the change, so a checked task asserting the refuted behaviour is a false completion record.
   - Reword it to match `design.md` D6 / the spec delta. For example: "Notice: composes copy from structured fields, states hidden counts, no raw ids; panel-only and hidden-only cases; …".
3. **`openspec/changes/guard-source-delete-config-refs/files-modified.md:16`.**
   - "always shows server reason" is likewise false.
   - Line 22 records the later change, but line 16 still reads as a current description of the file.
   - Update it, or mark it superseded inline.
4. **Re-grep before resubmitting:** `grep -rn -i "always shows\|falls back to \`message\`" frontend/src openspec/changes/guard-source-delete-config-refs/{tasks,files-modified,design}.md`.
   - Every remaining hit must be true of the code.
   - These are comment and doc edits only, so lint/format/typecheck suffice; the backend suite does not need to be re-run.

### Non-blocking notes

- The MCP description says the 409 "says how many references you cannot see". The counts are of resources (pipelines and panels), not reference edges. This is worth folding into HEL-1259's wording pass.
- I did not re-litigate the known follow-ups HEL-1258 ("Used by" counts roots only) and HEL-1259 (teardown and remediation wording).
- **No gate defect.** I accepted no mtime-ordering claim. Round 2's screenshots are checksum-identified.
- **Dev-DB residue: none.** I created no data this round (no live API or DB writes), and the mutation runs were not repeated.
