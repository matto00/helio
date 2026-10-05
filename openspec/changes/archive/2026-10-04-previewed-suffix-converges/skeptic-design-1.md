## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `eda4669e4b089d46bb4d9162f1a3d1ccf0ae3eaa` (planning artifacts untracked in the worktree).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/previewed-suffix-converges/hel-1154`.
- **Owner ruling is real, not relayed:** `.concertino/runs/HEL-1154/events.jsonl` has `escalation.answered` with
  `answer: "proceed-with-restated-scope"`, `answer_source: "human"`, `resolution_channel: "chat"`. The Linear ticket
  body still carries the original ACs. The restated ACs in ticket.md are the ruled scope.
- **Only writer of "(previewed)":** I grepped `frontend/src`, `helio-mcp/src`, `backend/src`, `e2e`, and `frontend/e2e`.
  The only code that writes the literal marker is `PatchSetReviewPage.tsx:246` (`patch: { title: \`${title} (previewed)\` }`).
  The other hits are prose uses of "previewed" or the `hel904-real-dump.sql` test fixture (data, not a writer). The premise claim holds.
- **Preview is read-only:** `PatchSetPreviewService.scala:27` says "No repository writes anywhere in this file". Confirmed.
- **Output name copied from panel title:** `V94__outputs_model.sql` inserts `panel_row.title` as `outputs.name` (around line 768). Confirmed.
- **F-002 is the existing partial fix:** `c0fbb56a` touches `PatchSetReviewPage.tsx` and its test. The live
  `PREVIEWED_SUFFIX_RE = / \(previewed\)$/` is at line 216, and the existing test at line 481 asserts the single-strip
  `"Revenue (previewed) (previewed)" -> "Revenue (previewed)"`. The residual defect is real.
- **D1 regex behaviour, checked with node:** I ran old and new regexes over clean, 1x, 2x, 5x (the exact dev-DB
  title), mid-title, no-space, trailing-space, and bare-marker inputs. With the new `/(?: \(previewed\))+$/`, 2x and 5x go
  to one marker. Unlike the old regex, it converges. A mid-title `"A (previewed) B"` is untouched, which matches D1.
  The other edge inputs behave the same under both regexes. No nested quantifier, so there is no ReDoS risk.
- **D2 page-level probe is feasible:** `IS_DEV` comes in through `jest.config.cjs`'s moduleNameMapper
  (`^.*/config/env$` -> `src/test/envMock.ts`, `IS_DEV = false`). There is an established override precedent:
  `src/features/dashboards/ui/ProposalReviewPage.demoFixture.test.tsx` is a separate file with a local
  `jest.mock("../../../config/env", () => ({ API_BASE_URL: "", IS_DEV: true }))`. The demo path
  (`synthesizeDemoPatchSet` -> `dispatch(previewPatchSet(patchSet))`) reaches the already-mocked service
  `previewPatchSet`, so asserting its argument is a valid, observable probe. On unmodified code a 3x title yields 3x
  markers, which is a genuine RED.
- **AC coverage:** AC1 maps to task 2.1/D1. AC2 (red, green, mutation red) maps to tasks 1.1, 2.2 and C3. AC3 maps to
  task 1.2/D3. AC4 (frontend only, no data fix) maps to C1 and C2. Every AC has a task, and no task goes beyond the
  ACs.
- **Placeholders and contradictions:** there are no TODO/TBD markers. The proposal, design and tasks agree with each other. `skip_specs: true` is
  justified: this is a DEV-only fixture and no spec covers it. No API or schema delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

1. **Probe placement (D2):** prefer the existing precedent, a sibling `PatchSetReviewPage.demoFixture.test.tsx` with a
   file-local `config/env` mock (`IS_DEV: true`). Avoid a mutable shared mock or `isolateModules`. That keeps
   `PatchSetReviewPage.test.tsx`'s "nothing to review / never synthesizes" route-guard test unchanged under `IS_DEV=false`.
   The probe needs `fetchDashboards`, `fetchPanels` and `previewPatchSet` mocked in the new file.
2. **A comment becomes false:** `PatchSetReviewPage.tsx:222-224` says the demo-fixture path is "unreachable under Jest".
   Once the D2 probe exists, that is wrong. Update it together with the regex comment in task 2.1. Also update the F-002
   comments in the test file (lines 469-481) that describe the single-strip contract.
3. **Mutation definition:** for C3, the mutation should revert exactly to `/ \(previewed\)$/`, and the report should
   show the probe RED under it. Dropping the `+` from `(?: \(previewed\))+$` is equivalent.
4. **Probe strength:** for AC1's "any N", the D2 page probe covers one compounded N. The updated pure-function test
   (D3) can cheaply loop N = 0..5 to back the "any N" claim.
5. `workflow-state.md` says `TICKET_TYPE: feature` for what is a bug ticket. This is cosmetic.
