## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `26028b96d963a297d63da2c0fdadb9d0392f4da6`. The diff base, resolved live by `resolve-review-base.sh`, is `3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526`. The working tree is clean apart from the untracked `evaluation-2.md`.

Scratch logs are in the session scratchpad with the `hel1345-final-` prefix.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/rootid-step-create-placement/HEL-1345`.

**AC1 / AC2: backend placement.**
- `PipelineService.resolveRootTrunkAnchor` (PipelineService.scala, companion object) walks THAT root's trunk: the lowest-`position` root-level step of the root, then each step's first `position == 0` child. It returns:
  - no position: trunk-last;
  - 0: `None`;
  - `0<k<=len`: `trunk(k-1)`;
  - anything else: a 422 naming the trunk length.
- The `(None, Some(rootIdRaw))` arm now calls `spliceInsertReportingInternal` with `Some(anchor)` and `explicitRootId = None`. Only when there is no anchor does it keep `explicitRootId = Some(rootId)`, so V98's XOR holds.
- `PipelineStepRootIdPlacementRoutesSpec` (new, extends `HelioRouteTest`, C7) reads every outcome back through `GET /pipelines/:id/steps`. It covers:
  - tail append;
  - position 2, position 0, and position == length;
  - 4 and -1 return 422 with nothing persisted;
  - an empty root;
  - multi-root, with and without position, with the other root asserted untouched;
  - a root whose only root-level step has position 1;
  - the lane pre-check.
- **Independent mutation runs.** I extracted HEAD with `git archive` into the scratchpad, so the worktree was never touched.
  - Restoring the old head-splice call (`None, explicitRootId = Some(rootId)`) gives `Tests: succeeded 13, failed 8` across the placement and reparent specs. Six placement cases and both new reparent-guard cases go red (`hel1345-final-be-mut-place.log`).
  - Disabling only the lane pre-check's rootId branch (`if false`) gives `succeeded 9, failed 1`, and only the lane test is red (`hel1345-final-be-mut-lane.log`).
  - Both reproduce the executor's claims. The executor's own red log against the unfixed service (`hel1345-red1.log`, `succeeded 1, failed 9`) is present and matches `probe-evidence.md`.
- **Full suite, fresh:** `nice -n 19 sbt testFull` gave `Total number of tests run: 6051`, `Tests: succeeded 6051, failed 0`, `EXIT=0` (`hel1345-final-testfull.log`). `sbt --client shutdown` was run as a separate call.

**AC3: read-only production check.**
- The committed `ac3-query.sql` is byte-identical (`diff` returned nothing) to the text the executor ran (`hel1345-ac3-query.sql`).
- It is a single SELECT: a recursive walk down each `position = 0` trunk from the parentless heads. It flags edges where the child was created before its parent and `child.updated_at = parent.created_at`, which is the same-transaction reparent fingerprint, windowed from 2026-09-05.
- It reports `head_run_len`, strong and weak counts, and `root_count`, and the header discloses its false positives.
- Validation log (`hel1345-ac3.log`):
  - the legitimate trunk returns 0 rows;
  - root A->B plus two unfixed rootId appends returns `trunk_len 4 | head_run_len 2 | strong 2 | weak 2`.
- I hand-traced that fixture (N2->N1->A->B: N1 and A satisfy the fingerprint, B does not) and it gives exactly 2.
- Accepted per the owner ruling (C9). No agent touched production. I did not access production.

**AC4: docs match behaviour.**
- The `CreatePipelineStepRequest` scaladoc covers both `position` readings, the head/splice/append semantics, "tails included", the 422 naming the trunk length, and that other roots are untouched.
- The rootId-arm in-code comment says the same.
- The JSON Schema `description` and `rootId.description` say the same.
- The MCP `add_pipeline_step` text ("rootId with no position appends at THAT root's trunk tail (guarded only if the trunk-last step already has children)") matches the reparent-guard cases, which are green and also red under the mutation above.
- `grep` finds no helio-mcp test asserting the old text. `helio-mcp` typecheck exits 0, and root jest on helio-mcp passes 375/375.

**AC5: editor resync.**
- `applyCreatedStep` (pure) and `insertAnchor` are new. Both immediate create branches and the draft swap now apply the response delta instead of a wholesale `syncStepsFromServer`. A removed temp is recorded via `markTempRemoved`.
- RTL red-first, reproduced independently on an extracted snapshot: with the base `usePipelineStepCreation.ts`, `usePipelineDetailPage.ts` and `pipelineService.ts` restored, `createPlacement` gives `9 failed, 3 passed` (`hel1345-final-fe-red-base.log`).
- Mutation "hook ignores `reparentedStepIds`" gives `7 failed`: (a), (b) x2, (c), (d) x2 and (h) (`hel1345-final-fe-mut1.log`). Both runs match the executor's claims.
- Worktree, `src/features/pipelines`: `83 suites, 1098 tests passed` (`hel1345-final-fe-pipelines.log`).
- Gates: typecheck, lint and format:check all exit 0.

**C1 (HEL-1294/HEL-1321 unchanged).**
- `markCreating(tempStep.id, true)` before the create and `markCreating(.., false)` in `finally` are unchanged at both call sites. The only change is that the post-create GET no longer exists, so the window ends when the create resolves.
- Mutation `markCreating(true)` immediately followed by `false` turns 3 of the 4 `creatingStep` tests red (`hel1345-final-fe-mut-c1.log`).
- The draft's `renderKey` is `temp?.renderKey ?? tempId`, the same as the old `s.renderKey ?? s.id`.
- The immediate path sets no `renderKey`, so the card is keyed by the persisted id exactly as the wholesale replace did.

**Existing-test edits.** `git diff --name-status` shows modified (non-added) tests only in the following files, all planned in design D5/D6/D10:
- `PipelineStepReparentRoutesSpec.scala` (own commit `e72576763`, D10);
- `PipelineDetailPage.creatingStep.test.tsx`, `PipelineDetailPage.test.tsx` and the `draftCreate` ~:400 retarget (D5);
- `draftCreate` item-1 (own commit `85a90496d`, D6).

No `ci.yml`, `playwright.config.ts`, `.gitignore` or `helio-mcp/package*.json` changes (C2).

**E2E seam.**
- Servers: `readlink /proc/<pid>/cwd` showed `.../HEL-1345/frontend` (6777) and `.../HEL-1345/backend` (9684), and `assert-phase.sh servers` printed PASS.
- The backend JVM started at 13:45:14. The only later backend commit (`26028b96d`) is an import plus an annotation rename, so it is behaviourally identical.
- `DEV_PORT=6777 BACKEND_PORT=9684 nice -n 19 npx playwright test e2e/hel1345-rootid-step-placement.spec.ts --workers=1` gave `1 passed` (`hel1345-final-e2e.log`).
- The executor's red log (`hel1345-e2e-red.log`) shows `Select fields` first after reload against the head-splicing backend.

**UI / design judgment.**
- I ran my own headless Chromium context with `isolateLivePage` semantics (`about:blank` before seeding) at 1440x900, with a throwaway user.
- Flow: seed Limit and Sort, insert Cast in the Limit|Sort gap, append Select fields, open Cast, then reload in dark.
- Rendered order before and after reload: `Limit rows, Cast type, Sort rows, Select fields`. The steps API agrees, with this parent chain:
  - limit (rootId set);
  - cast -> limit;
  - sort -> cast;
  - select -> sort.
- In the screenshots (scratchpad `hel1345-final-shots/01..04`), light and dark look the same. The Cast card expands normally after its create. Nothing changed visually: the change is placement-only, with no new UI surface, so there is no token or component divergence to judge.
- Two console 404s appeared. They are consistent with the expected no-schedule `GET` (no schedule set); none relate to this change.
- `persist-evidence.sh` refuses paths outside a git worktree, so the screenshots were not persisted. The CONFIRM does not rest on them; it rests on the self-authenticating API parent chain quoted above.

**Residue (C8).** All created rows are listed below, and the post-cleanup query below found no residue.

| What | Id | How it was removed |
| --- | --- | --- |
| e2e user | `475a5fa5-1667-4ed9-b56b-bda187b22fae` | deleted by exact id (`DELETE 2`, together with the UI-check user) |
| e2e pipeline | `f8aa70ab-6384-4444-ba86-193a600bd55a` | deleted by the spec's `afterAll`; verified absent |
| e2e source | `7ef76ec2-b60e-438d-93a5-1ec75a93fdc8` | deleted by the spec's `afterAll`; verified absent |
| UI-check user | `816df838-fea5-4735-8e32-423414a5e533` | deleted by exact id (`DELETE 2`, together with the e2e user) |
| UI-check pipeline | `dac9970b-94c0-438c-803d-2cc106ad09a2` | deleted via the API (204) |
| UI-check source | `b6611edd-488a-4fcf-b1bc-9c2225db6392` | deleted via the API (204) |

### Verdict: CONFIRM

### Non-blocking notes

1. **`usePipelineStepCreation.applyCreated` reads `pendingParentRef` outside the `setSteps` updater, and the write happens inside it.**
   - If a later-committed create's response is dispatched while the component already has a pending update, React defers that updater to render instead of computing it eagerly.
   - If the earlier create's response then arrives before that render, it reads no claim. The created step keeps its stale response parent, and the claim entry is never consumed.
   - The window is narrow: reverse-order responses for two creates at the same slot, plus a pending render between two network tasks. It is display-only and heals on the next full sync, the same class the design already accepts in Risks.
   - Worth a follow-up, for example consuming the claim inside the updater with an idempotent read, or a test that holds a pending render.
2. **Two `PipelineDetailPage.test.tsx` create mocks return `reparentedStepIds: []` for a mid-trunk insert** where the real server would report the following step. The tests are about the fingerprint and preview refresh, not placement, so this is harmless, but it is not server-realistic.
3. **The design's own Risks list carries several follow-ups that are "noted, not filed":**
   - the orphan step after a user-removed in-flight create;
   - shape-instantiate stale parent;
   - `(None, None)` lane pre-check with explicit position;
   - the "exactly one of parentStepId/rootId" spec sentence.

   The orchestrator should file them at delivery if wanted.

### Gate-defect check (CON-160)

No evidence here relies on mtime or directory ordering. Every claim rests on fresh command output, `diff`, or an API parent chain.
