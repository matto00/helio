## Evaluation Report — Cycle 2 (evaluation-2.md)

This is the delivery-time re-check after merging origin/main. HEAD reviewed:
`da8a412d0724019782c0a15d4ce37c3560f30595`. That is the merge of `5e2172d6c` (archive) and `fd7090bf6` (origin/main,
HEL-1740 + HEL-1755). The review base was resolved live as `fd7090bf6bc10a091c99d8090a440093ced74475`. Evaluator logs are
in `.concertino/scratch/HEL-1734/eval2/`.

### Gates (fresh, run by the evaluator at da8a412d0)

The merge was committed with `git commit -n`, so I ran EVERY `.husky/pre-commit` step myself.

| Gate | Result |
|---|---|
| `npm run lint`, `format:check`, frontend `typecheck`, `check:schemas`, `check:scala-quality` | all EXIT 0 |
| The other 25 pre-commit checks (repo-integrity, e2e-types, helio-mcp-types, spec-structure, openspec + selftest, ci-complete-needs, dependabot, cloud-run-cpu, temp-dir hygiene, e2e evidence paths, e2e user cleanup, no-credential-leak, eslint-ts-rules, tokens, ...) | all EXIT 0 |
| `npm test` (jest, 3 workers) | 579 root tests + 9722 frontend tests (798 suites), EXIT 0 |
| `sbt -J-Xmx3g testFull` (nice 19) | 715 suites, 9788 succeeded, 0 failed, 0 aborted, **5 canceled**, hel1468-guard failed=0, EXIT 0 |
| `e2e/hel1734-draft-roots.spec.ts` on a freshly created `helio_hel1734` (Flyway to V141) | 11/11 passed |

The 5 canceled tests already exist on main, and none of them belongs to this change. They are opt-in measurement or
heap tests that cancel themselves without their env flag: 3 x "reports p50/p95 before vs. after (report-only;
HELIO_MEASURE=1)", "stay at or under 192 MB ... real and dry" (`DraftPreviewHeapSpec`), and "add no more than 500 ms
(median of 20) to the rows service path". My cycle-1 run on base `aeeb68675`, an ancestor of origin/main, canceled the
same 5 tests.

The e2e process exited 1 after all tests passed. The global teardown `userCleanup` targets the shared dev DB, not the
lane DB ("0 of 11 ... nothing deleted"). This is the same environmental artifact as cycle 1.

After the run I stopped the servers with `stop-servers.sh` and dropped `helio_hel1734`.

### Merge review — clean
- `git diff --cc da8a412d0` is empty, so there is no evil-merge content.
- `DraftDiff.scala` at the merge is exactly origin/main's HEL-1740 insight reads check plus HEL-1734's root pass. The
  `kept` map built from `survivorIds` makes an insight that reads an Output on a root the draft removes answer 400. The
  restore path skips the check, as HEL-1740 intends.
- `draft-save-request.schema.json` carries both the `insight` kind and `rootClientId`.
- The 2 new `DraftSaveRootsApiSpec` cases run and pass.
- An unchanged stored insight whose reads dangle after a root removal is allowed. That is HEL-1740's documented
  tolerance rule ("an id left dangling by a later Output deletion does not block unrelated edits"), not a regression.

### Phase 1: Spec Review — FAIL
- The archive is sane: tracked files are proposal, design, tasks, ticket, delta specs, evaluation-1, skeptic reports
  and evidence; `workflow-state.md` is git-excluded. Every ADDED requirement is present once in `openspec/specs/`.
- **The synced main spec now contradicts itself.** The `pipeline-draft-mode-ui` delta used only `## ADDED Requirements`,
  so the HEL-1631 text that blocks root add and remove survived the sync:
  - `openspec/specs/pipeline-draft-mode-ui/spec.md:9` (Requirement "Step edits form a client-only draft"): "While a
    draft exists, root add and remove SHALL be disabled with the reason "Save or discard your draft first"."
  - `openspec/specs/pipeline-draft-mode-ui/spec.md:19-21` (Scenario "Structural action blocked during a draft"): "add
    source and remove source are disabled and state "Save or discard your draft first"".
  - These contradict the new `:260` Requirement "Add and remove source are draft actions" and the shipped behaviour,
    which I verified in cycle 1 and again in this e2e run. The checklist item "Planning artifacts reflect the final
    implemented behavior" fails.
- A lesser inconsistency in the same family: `openspec/specs/pipeline-draft-save/spec.md:10-11` ("Atomic declarative
  draft save") still lists the body as `{baseFingerprint, steps[], outputs[], runAfterSave?, confirmCascade?}`, without
  `roots?`.

### Phase 2: Code Review — PASS
No code issues. The merge resolution is correct and the gates are green.

### Phase 3: UI Review — PASS
No UI file changed since cycle 1 except through origin/main. The 11 e2e tests pass on a fresh lane DB at the merge
head.

### Overall: FAIL

### Change Requests
1. `openspec/specs/pipeline-draft-mode-ui/spec.md:9`: replace the sentence "While a draft exists, root add and remove
   SHALL be disabled with the reason "Save or discard your draft first"." with one saying that adding and removing a
   source also change only the draft (see "Add and remove source are draft actions"), and that removing the last
   remaining source stays unavailable.
2. `openspec/specs/pipeline-draft-mode-ui/spec.md:19-21`: in Scenario "Structural action blocked during a draft", move
   "add source and remove source" from the disabled list to the enabled list.
3. Mirror both edits in the archived delta so the archive and the main spec agree. In
   `openspec/changes/archive/2026-11-17-draft-add-remove-roots/specs/pipeline-draft-mode-ui/spec.md`, add a
   `## MODIFIED Requirements` block carrying the full revised "Step edits form a client-only draft" requirement.
4. `openspec/specs/pipeline-draft-save/spec.md:10-11`: add `roots?` to the body shape in "Atomic declarative draft save"
   (and mirror it in the archived delta as MODIFIED).
5. Re-run `npm run check:openspec` and `npm run check:spec-structure`, and commit WITH the pre-commit hook (no `-n`).

These are artifact-only edits: no code, no gate other than the openspec and spec-structure checks needs re-running.

### Non-blocking Suggestions
- The cycle-1 suggestions still stand: split notes for `DraftDiff.scala` and `pipelineDraft.ts` in the PR body, the
  unused `rows` parameter in `DraftSaveJournal.rootDefsOf`, an e2e test for replace-only-source plus a step on it, and
  test names in the e2e mutation logs.
