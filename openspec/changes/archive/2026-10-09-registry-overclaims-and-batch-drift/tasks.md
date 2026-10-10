## Standing Constraints

- [C1] Scala changes are comment / test-name only: in the four Scala files (`PipelineStep.scala`,
  `PipelineService.scala`, `PanelConfigCodec.scala`, `PanelSpec.scala`) every changed line is a scaladoc line, except
  the single PanelSpec test-name string line (E8). Proven by task 5.2.
- [C2] Every claim in new comment text is backed by design.md "Claim → proof" (P1–P22); each command and its real
  output is pasted into `files-modified.md`. If an output differs from the stated expectation, STOP and report it as a
  finding — never edit the comment to match on your own.
- [C3] Apply design.md D4's edits E1–E11 verbatim. Do not reword, reflow or "improve" them; do not touch any line
  outside an OLD block / named insertion point. Do not run scalafmt.
- [C4] Safety: never print/cat/source/echo `backend/.env` or any secret; never pkill/pgrep/killall; no
  `--no-verify` / `HUSKY=0`; no writes under `~` except inside the worktree; `git -C <worktree>` or absolute paths;
  Bash timeout 600000 on every long command; sbt always with `-J-Xmx3g`; run `free -g` before committing and wait
  (do not commit) if "available" is under ~15 GB. Scratch files only under the worktree, prefixed `hel1412-`, and
  deleted by exact path.

Worktree root (absolute; shell variables do not persist between Bash calls, so repeat the path):
`/home/matt/Development/helio/.claude/worktrees/task/correct-registry-overclaims-drift/HEL-1412`
Below, `WT` means that path. Every command runs as `cd WT && <command>` in ONE Bash call.

## 1. Red-first on the untouched base (BEFORE any edit)

- [x] 1.1 R1: `cd WT && sed -i 's/"output", "form"\]/"output"]/' schemas/panels/create-panels-batch-request.schema.json && grep -n '"enum"' schemas/panels/create-panels-batch-request.schema.json && node scripts/check-schema-drift.mjs; echo "exit=$?"; git checkout -- schemas/panels/create-panels-batch-request.schema.json`
  Expected: the grep shows the enum without "form"; the script prints its sync lines and `exit=0` (the gap). Paste output.
- [x] 1.2 R1b: `cd WT && perl -pi -e 's/^(\s*)case "form"(\s*)=> Right\(Form\)$/$&\n$1case "fake"$2=> Right(Form)/' backend/src/main/scala/com/helio/domain/model/model.scala && grep -n 'case "fake"' backend/src/main/scala/com/helio/domain/model/model.scala && node scripts/check-schema-drift.mjs > hel1412-r1b.txt 2>&1; echo "exit=$?"; grep -c 'create-panels-batch-request' hel1412-r1b.txt; cat hel1412-r1b.txt; git checkout -- backend/src/main/scala/com/helio/domain/model/model.scala; rm -f hel1412-r1b.txt`
  Expected: exactly one `case "fake"` line; `exit=1`; the grep count prints `0` (the batch enum is not observed even
  though other surfaces report `missing: fake`). Paste output.
- [x] 1.3 `cd WT && git status --short` — expected: only the untracked `openspec/changes/registry-overclaims-and-batch-drift/` (both mutations restored).

## 2. Edits (design.md D4, verbatim)

- [x] 2.1 `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala`: E1, E2, E3, E4, E5 (Edit tool, OLD → NEW).
- [x] 2.2 `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`: E6.
- [x] 2.3 `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala`: E7.
- [x] 2.4 `backend/src/test/scala/com/helio/domain/model/PanelSpec.scala`: E8.
- [x] 2.5 Create `scripts/lib/panelKindEnumCoverage.mjs` with E9's content exactly.
- [x] 2.6 `scripts/check-schema-drift.mjs`: E10a, E10b (replace the whole `const panelTypeSurfaces = [ ... ];` array
  literal — the four `getEnumAt` entries — with E10b's NEW block), E10c (insert after the parity loop's closing `}`
  that follows `else panelTypeChecked += 1;`), E10d.
- [x] 2.7 `scripts/check-schema-drift.selftest.mjs`: E11a, E11b.
- [x] 2.8 `cd WT && npx prettier --write scripts/check-schema-drift.mjs scripts/lib/panelKindEnumCoverage.mjs scripts/check-schema-drift.selftest.mjs && git diff --stat`
  (prettier may only re-wrap whitespace; if it changes anything beyond line wrapping in E9–E11, report it).

## 3. Green + red after the change

- [x] 3.1 `cd WT && node scripts/check-schema-drift.mjs; echo "exit=$?"` — expected `exit=0`, `panel-type enums in sync
  ... (9 surfaces checked)` and `panel-kind enum coverage: 5 schema enums detected, each checked or exempted`.
- [x] 3.2 `cd WT && npm run check:schemas:selftest; echo "exit=$?"` — expected every case `ok` (including the five new
  HEL-1412 cases) and `exit=0`.
- [x] 3.3 R2: same command as 1.1 (drop "form", run, restore). Expected `exit=1` and output containing
  `create-panels-batch-request.schema.json` and `missing: form`. Paste output.
- [x] 3.4 R3: same command as 1.2 but the `grep -c` must now print ≥ `1`, and the output shows the
  create-panels-batch-request surface with `missing: fake`. Restore (the command does). Paste output.
- [x] 3.5 R4: `cd WT && printf '{"enum": ["text", "output"]}\n' > schemas/panels/hel1412-mutant.json && node scripts/check-schema-drift.mjs; echo "exit=$?"; rm -f schemas/panels/hel1412-mutant.json`
  Expected `exit=1` and an error naming `schemas/panels/hel1412-mutant.json#enum`. Paste output.
- [x] 3.6 `cd WT && git status --short` — expected: the eight intended paths (4 Scala, 3 scripts incl. the new lib
  file, the change dir) and nothing else (no mutant file, no model.scala, no schema change).

## 4. Claim proofs

- [x] 4.1 Run every command P1–P22 in design.md "Claim → proof" from WT; paste each command and its actual output into
  `files-modified.md` under `## Claim proofs`. (P21 after the edit: expected no output.) Mismatch → STOP and report (C2).
- [x] 4.2 Old overclaims gone. Positive control on base, then the new tree:
  `cd WT && git show HEAD:backend/src/main/scala/com/helio/domain/model/PipelineStep.scala | grep -c -i -E 'only requires updating|single source of truth —|11th kind|13th step kind|round-trip through the|no edits in the codec'`
  (expected `6`) then
  `cd WT && grep -n -i -E 'only requires updating|single source of truth —|11th kind|13th step kind|round-trip through the|no edits in the codec' backend/src/main/scala/com/helio/domain/model/PipelineStep.scala; echo "exit=$?"` (expected no lines, `exit=1`);
  `cd WT && grep -n -i 'single source of truth' backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala backend/src/test/scala/com/helio/domain/model/PanelSpec.scala backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala; echo "exit=$?"` (expected no lines, `exit=1`).
  If the positive-control count is not 6, paste the matching lines and report rather than proceed.
- [x] 4.3 Re-derive command named in E5 runs: `cd WT && git grep -c -l -i datebucket -- backend/src/main frontend/src helio-mcp/src ':!*.test.*' | wc -l` (expected ≥ 30).

## 5. Compile / test / validate

- [x] 5.1 `cd WT/backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.PanelSpec com.helio.domain.model.PipelineStepSpec"`
  (timeout 600000). Expected: compiles; both specs all passed, 0 failed; the renamed test name appears in the output.
- [x] 5.2 Comment-only proof for C1:
  `cd WT && git diff -U0 -- backend/src/main/scala/com/helio/domain/model/PipelineStep.scala backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala | grep -E '^[-+]' | grep -v -E '^(\+\+\+|---)' | grep -v -E '^[-+][[:space:]]*(\*|/\*\*)'`
  Expected: no output. And `cd WT && git diff -U0 -- backend/src/test/scala/com/helio/domain/model/PanelSpec.scala`
  shows exactly one `-`/`+` pair (the test name).
- [x] 5.3 `cd WT && openspec validate registry-overclaims-and-batch-drift --type change` exits 0.

## 6. Commit

- [x] 6.1 Write `openspec/changes/registry-overclaims-and-batch-drift/files-modified.md`: list every modified/created
  path (one per line under `## Files`), then `## Red-first evidence` (1.1, 1.2, 3.3, 3.4, 3.5 commands + outputs),
  `## Claim proofs` (4.1–4.3), `## Gates` (3.1, 3.2, 5.1 tail, 5.2, 5.3).
- [x] 6.2 `free -g` (C4). Stage by explicit path only (never `git add -A`): the 4 Scala files, the 3 script files, and
  `openspec/changes/registry-overclaims-and-batch-drift/`. Commit (hooks must run; timeout 600000) with message:

  ```
  HEL-1412 Correct registry single-source-of-truth overclaims; drift-check every schema panel-kind enum

  Rewrite PipelineStep.scala's registry scaladoc (header, Companion, Registry,
  PipelineStepKind, All) and PipelineService's header to name the hand-enumerated
  layers with a re-derive command; correct PanelConfigCodec's header; rename
  PanelSpec's registry test to what it asserts. check:schemas now parity-checks
  create-panels-batch-request.schema.json's kind enum and fails on any schemas/
  panel-kind enum that is neither checked nor explicitly exempted (HEL-1149).

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  If a hook fails, fix the cause (never bypass) and commit again; report what failed.
- [x] 6.3 `cd WT && git log --oneline -1 && git status --short` — expected the new commit and a clean tree.
