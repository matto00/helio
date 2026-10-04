## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `4ada48c0e9282eafe993fb70a2b444d6669ea246`. Base `260943222894a97e2d65447ff9b00a7e7f57df89` was resolved live with `resolve-review-base.sh` (exit 0). The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=bug/guard-source-delete-config-refs/HEL-1252`. The working tree is clean apart from the untracked `evaluation-3.md` and `evaluation-4.md`.

### What I verified (with evidence)

**Gates (fresh, run by me)**
- `nice -n 19 sbt testFull` (backend/): `Tests: succeeded 5590, failed 0`, EXIT=0. Both `DataSourceReferenceGuardNonSuperuserSpec` and `V100ZeroRootGuardNonSuperuserSpec` ran in it. I then ran `sbt --client shutdown`.
- Frontend:
  - Jest on `src/features/sources` and `src/features/toasts`: 34 suites, 302 passed.
  - `npm run typecheck` is clean.
  - `eslint --max-warnings=0 src/features/sources` exits 0.
  - `prettier --check` is clean.
- helio-mcp:
  - Root jest `helio-mcp/src/tools/datasetTools`: 12 passed.
  - `check:helio-mcp-types` is clean.

**AC1: reference inventory, re-derived independently**
- I grepped the migrations for `data_source_id` / `source_id`:
  - V4 and V22 are dropped tables or columns.
  - V36, V37 and V39 are RLS/ACL.
  - V41 and V94 are the DataType era.
  - V98 is `pipeline_roots`.
  - V106 is the source's own `dataset_rows`.
  - V107 and V110 add no source column.
- Of the domain step codecs, only `JoinStep`, `LookupStep`, `UnionStep` (via `SecondaryInput`) and `UpsertSourceConfig` (via `UpsertTarget`) carry a source id. Among panels, only `FormPanel` does.
- R1–R4 in `DataSourceReferenceRepository.scala` therefore cover every persisted reference kind.

**AC2: live 409 against the running backend**
- Fixtures: two CSV sources, plus a visible join pipeline and a visible form panel on my own dashboard. Separately, a HIDDEN lookup pipeline and a HIDDEN form panel, both owned by `verify@example.com`.
- `DELETE` on the referenced source returned 409. The body had `pipelines:[{…references:["join"]}]`, one visible panel, `hiddenPipelineCount:1` and `hiddenPanelCount:1`.
- The reason is a capitalised sentence. Its remediation is tailored to the kinds present.
- Grepping for the hidden ids and names found 0 hits.
- The root-referenced source returned `references:["root"]` and `hiddenPipelineCount:1`, with only the pipeline-editor remediation.

**AC3: live teardown dry run**
- I tagged the referenced source and ran a dry-run teardown.
- Result: `blocked:true`, with a sentence-form reason that names the visible dependents and counts the hidden ones. The hidden ids/names had 0 hits in both the body and `.concertino-backend.log`.
- I restored the tag to NULL afterwards.

**AC4: the RLS proof is genuine and can fail. I re-ran mutations myself, in a scratch `git archive` export of HEAD; the worktree was never touched.**
- The spec's app pool is `helio_migration_test NOSUPERUSER NOBYPASSRLS`, alongside a separate `SET ROLE helio_privileged` pool. Liveness `appRoleSeesPipeline(...) shouldBe false` is asserted in 6.3a–c.
- **Mutation M-RLS:** I changed the finder's `ctx.withSystemContext(` to `ctx.withUserContext(viewerId)(`, i.e. made the guard RLS-dependent.
  - Result: **15 tests red** (`Tests: succeeded 11, failed 15`), covering 6.3a/b/d/e/f, 6.4c/g and 6.2a for all six kinds, plus 6.2b and 6.2c.
  - 6.4d, the superuser pool, stays green, as expected. This proves the non-superuser harness detects exactly the defect class a BYPASSRLS dev/CI connection would mask.
- **Mutation M6a (C1):** I dropped `AND rp.grantee_id = $viewer::uuid` from the step-reference visibility predicate (line 78).
  - Result: **6.2c red** (`succeeded 25, failed 1`).
- **Restored control:** `succeeded 26, failed 0`.
- The pre-fix reds per scenario are recorded in probe-notes.md 1.2. I accept those as recorded output, consistent with my M-RLS result.

**C1 and C2**
- C1: the pipeline and dashboard predicates are explicit owner-or-named-grantee checks, and a grantee-less grant never confers visibility (code, plus the M6a mutation above).
- C2: hidden identities exist only in the `private` `PipelineHit` and `PanelHit`.
  - Both P0001 `log.warn`s log only the source id and SQLSTATE. The suite's own log lines confirm this (`race-path P0001 for source <src> (SQLSTATE P0001)`).
  - The in-tx re-check selects `1` and has an identity-free reason.
- Teardown's exemption requires owner == caller AND tag == T. The in-tx check's block set is a subset of the pre-check's, so it introduces no false positive.

**AC5: UI, judged in the running app**
- Server cwds: `/proc/558045/cwd` → `…/HEL-1252/backend` and `/proc/558254/cwd` → `…/HEL-1252/frontend`. Both started at 02:07 PDT, after the last code commit `2f5ce83e` (01:52 PDT). `4ada48c0` touched only design.md and spec.md.
- Path: Sources sidebar → actions → Delete → Confirm.
- Rendered text: `"SKF2-1252 Regions" was not deleted: it is still referenced by the items below, and a pipeline you cannot access, and a form panel you cannot access. Remove each reference first.` This is followed by one link per visible reference with its kind.
- No UUIDs, no duplicate listing, and no overflow (scrollWidth == width == 215).
- The CSS is unchanged from main and uses tokens only. Dark and light both read well.
- The only console error is the expected 409 resource line.
- Screenshots were saved directly into the durable evidence directory (no relocation, no mtime dependence). sha256:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/skeptic-final2-notice-dark.png` (91f2ab06…5809dc)
  - `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/skeptic-final2-notice-light.png` (16d4ef0e…a32c)
  - `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/skeptic-final2-page-dark.png` (9678375b…5d37baab)
  - `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/skeptic-final2-page-light.png` (f0de07c7…bbaab0d5)
- MCP: the `delete_data_source` description lists every kind and its remediation tool, and the new jest test pins this.

**Round-1 CRs.** Both are resolved in behaviour: structured counts, a composed UI copy, and tailored sentence-form reasons. However, the round-1 change left four places that still describe the OLD contract (see below).

### Verdict: REFUTE

Behaviour, security and the RLS proofs are sound and ship-ready. What blocks is that the cycle-3 change (`2f5ce83e`) moved the contract without updating the places that assert it. This is the exact pattern CONTRIBUTING forbids ("When a value moves, update every place that asserts it in the same change — grep for the old value"; a restating comment "silently stops being true").

Two of these are actively harmful:
- The component docblock argues for the very behaviour round 1 refuted. A maintainer who trusts it would reintroduce the raw-reason/UUID regression.
- The schema, which CLAUDE.md names as the contract's source of truth, contradicts itself: it defines the hidden-count fields while saying hidden references contribute only to `reason`.

### Change Requests

1. **`frontend/src/features/sources/ui/SourceDeleteConflictNotice.tsx:35-39`, the docblock.**
   - It says "The server's own reason is ALWAYS shown too: it is the only place references the caller cannot see are counted". That is false at HEAD: the notice renders `composeCopy(...)` and never shows `reason`/`message` unless the body has no structured fields.
   - Rewrite it to state the real contract:
     - the copy is composed from `pipelines`/`panels`/`hiddenPipelineCount`/`hiddenPanelCount`;
     - no raw ids are rendered;
     - `message` is used only for an older server body with no structured fields;
     - why: the server text carries ids meant for API/MCP consumers.
2. **`frontend/src/features/sources/state/sourcesSlice.ts:88-92`, the `SourceDeleteConflict` docblock.**
   - "hidden references are counted in `message` only" is false. They are carried as `hiddenPipelineCount`/`hiddenPanelCount`, which this same interface declares and `parseDeleteConflict` reads.
   - Correct it.
3. **`schemas/sources/data-source-delete-conflict-response.schema.json:5`, the top-level `description`.**
   - "any hidden reference … contributes only an unnamed count to `reason`" contradicts the `hiddenPipelineCount`/`hiddenPanelCount` properties the same schema defines.
   - State that hidden references appear only as the integer counts in those fields (and as an unnamed count in `reason`), never as an identity.
4. **`backend/src/main/scala/com/helio/services/sources/DataSourceDeleteError.scala:21-24`, the `DataSourceDeleteConflict` docblock.**
   - "those contribute only an unnamed count inside `reason`" has the same staleness, given the `hiddenPipelineCount`/`hiddenPanelCount` fields declared a few lines below.
   - Correct it.
5. **Re-grep before resubmitting.**
   - Run `grep -rn "ALWAYS shown\|counted in \`message\`\|unnamed count inside\|unnamed count to \`reason\`" frontend/src backend/src schemas helio-mcp/src` and expect 0 stale hits.
   - These are comment/description-only edits: re-run lint, format and typecheck. Re-running the backend suite is unnecessary unless code changes.

### Non-blocking notes

- **Notice copy.** With both hidden kinds present it reads "the items below, and a pipeline you cannot access, and a form panel you cannot access". A serial list ("the items below, a pipeline you cannot access, and a form panel you cannot access") would read better. This is optional.
- **Remediation wording.** The server's "detach it in the pipeline editor" is imprecise for a SOLE root, which cannot be detached; the pipeline must be deleted. Teardown's "Tag those into the batch" is inaccurate for foreign or hidden resources. Both are API-facing text and do not block.
- **Follow-up ticket recommended.** The Sources table's "Used by" column (and sidebar) counts roots only. Live, "SKF2-1252 Regions" showed **"Unused"** while its delete was refused for four references (page screenshots above). This branch makes that contradiction newly reachable: before, a join-only or form-only source was deletable. It is out of this ticket's ACs, but it should be filed against the same finder.
- **No gate defect.** No report I relied on discloses unsound evidence mtimes. My screenshots are checksum-identified and were written straight to the durable directory.
- **Dev-DB residue: none remains.**
  - I created sources `9f03830b-5d2c-4271-87ab-599488b1b743` and `74db48d4-ff80-43d8-82d8-7634ab35af92` via the API.
  - I inserted pipelines `5f2e1252-0000-4000-8000-000000000001` and `…0004`, with their roots `…0002`/`…0005` and steps `…0003`/`…0006`. I also inserted dashboards `…0007`/`…0009` and panels `…0008`/`…0010`. Of these, `…0004`, `…0009` and `…0010` were owned by `verify@example.com`.
  - I temporarily tagged source `9f03830b…` and then restored its tag to NULL.
  - Deletion was by exact id: panels, then dashboards, then pipelines (roots and steps cascade) via SQL, then both sources via API (204, 204). A verification count returned 0 for every one.
  - The mutation runs happened in a scratchpad export, not in the worktree. The worktree HEAD and status are unchanged.
