## Evaluation Report — Cycle 3 (evaluation-3.md)

HEAD reviewed: `a0ff7f0ea045079044db0cc16d4da70371f7f01e`. The base, resolved live, is
`fd7090bf6bc10a091c99d8090a440093ced74475`.

`git diff da8a412d0 a0ff7f0ea --stat` touches 5 files, all of them OpenSpec markdown:
- the two synced specs;
- the two archived deltas;
- evaluation-2.md.

It touches no code, schema or test. The full code and e2e evidence from cycle 2 therefore still applies to this head:
sbt testFull 9788/0 failed, jest green, the e2e spec 11/11, and all 30 pre-commit checks.

### Gates the diff warrants (re-run fresh at a0ff7f0ea)

| Gate | Result |
|---|---|
| `npm run check:openspec` | EXIT 0 |
| `npm run check:openspec:selftest` | EXIT 0 |
| `npm run check:spec-structure` | EXIT 0 |
| `npm run format:check` | EXIT 0 |

### Phase 1: Spec Review — PASS

Cycle-2 CR1, `pipeline-draft-mode-ui/spec.md:9`. The blocking sentence is replaced with "While a draft exists, adding
and removing a source (a root) SHALL change only the draft too (see "Add and remove source are draft actions")". That
matches the shipped behaviour I verified in cycles 1 and 2.

Cycle-2 CR2, lines 19-21. The scenario is renamed "Structural actions stay available during a draft" and now lists add
source and "remove source (except the last remaining source)" as enabled. That matches the code: `canRemove={multiRoot}`
over the draft roots.

Cycle-2 CR3/CR4, the archived deltas. Both now carry a `## MODIFIED Requirements` block with the FULL requirement:
- the "Step edits form a client-only draft" text plus its 3 scenarios;
- the "Atomic declarative draft save" text plus its 3 scenarios.

I extracted each block and compared it with the synced spec. Each is byte-identical, ignoring blank lines.

Cycle-2 CR4, the save body. `pipeline-draft-save/spec.md:10-13` now lists `roots?` and root add/remove in the atomic
transaction.

I swept every spec under `openspec/specs/` for any other statement that blocks or disables source or root add/remove
during a draft. The search covered "Save or discard", "disabled ... draft", HEL-1631, add source, remove source and
root add, across `pipeline-root-editor-ui`, `pipeline-editor-page`, `pipeline-detail-mobile-layout`,
`pipeline-detail-spine-layout` and `pipeline-multi-root`. None remains. The one remaining "Save or discard your draft
first" (line 147) concerns not-yet-created AI steps and is correct.

### Phase 2: Code Review — PASS
No code changed since cycle 2.

### Phase 3: UI Review — PASS
No UI file changed since cycle 2. The cycle-2 e2e at da8a412d0 (11/11) still holds for this tree.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `pipeline-draft-mode-ui/spec.md:9` still says "A draft exists exactly when the draft differs from the saved pipeline
  (its steps or its Outputs)". A draft can now differ only in its roots: for example, edit a step, add a source, then
  revert the edit, and `pruneOverlay` keeps the root op. The same paragraph says the kept draft is stored "together with
  the saved steps and Outputs it was made against". Consider "(its steps, its Outputs or its roots)" in a follow-up
  touch of this spec. This does not contradict the shipped behaviour as worded elsewhere: the added sentence and the
  "Add and remove source are draft actions" requirement cover it.
- The cycle-1 suggestions still stand. The PR body should carry split notes for `DraftDiff.scala` and `pipelineDraft.ts`.
  `DraftSaveJournal.rootDefsOf` has an unused `rows` parameter. An e2e case for replacing the only source and then adding
  a step on it is still missing.
