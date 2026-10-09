## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 96f2ae97571cfa4449cd3ed1c5e01a4b23759180 (worktree clean apart from the untracked change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/fix-proposal-analyze-schema-description/HEL-1281`.

### What I verified (with evidence)

Every pinned claim and expected output was checked against the live tree. Where an output depends on the edit, I checked
it against a simulated post-edit copy in my scratchpad, not the worktree.

- **Premise.** `pipeline-analyze-response.schema.json` `$defs.AnalyzeStep` has `type: string` and `config: object`, with
  required `[id, position, type, config, inputSchema, outputSchema]` (python dump). The proposal schema's
  `AnalyzeProposalStep` differs only in `type.minLength: 1` and explicit `config.additionalProperties: true`. Confirmed.
- **Stale text locations.** `grep -n -i stale` finds lines 5, 28 and 101. Line 28 is the unrelated HEL-1235 `warnings`
  text ("the stored inferred schema can be stale"). `git grep` for the stale sentences finds only this schema file.
  Confirmed.
- **D2 OLD/NEW blocks.** I extracted the 4 ```text blocks from design.md. A-OLD and B-OLD each occur exactly once in the
  file. Neither contains a `"`. A-NEW and B-NEW contain no "stale" and are absent before the edit. After replacement the
  file still parses with `json.loads`.
- **Task 1.3.** On the simulated file, `grep -ci stale` gives `1` (it is `3` now). Matches.
- **Task 1.4.** The `op/string|predates|deliberate divergence` count is `0` (`2` now), and the `HEL-1281` count is `2`.
  Matches.
- **Task 2.2.** A line diff of the original against the simulated file shows exactly 4 changed lines (2 removed, 2 added).
  That gives the stat line `1 file changed, 2 insertions(+), 2 deletions(-)`. Matches.
- **Task 2.3.** In the worktree, `npm run check:schemas` exits 0 with `(122 checked across 54 protocol files)`. I also ran
  it on a `git archive` copy with the simulated schema swapped in: still exits 0 with the identical count. Matches.
- **Task 2.4.** `npx --no-install prettier --version` gives 3.8.1, found by walking up to an ancestor node_modules,
  because the worktree root has no node_modules. `--check` passes on both the current file and the simulated file, using
  the worktree's `prettier.config.cjs`. Matches.
- **D1, harness facts.** `JsonSchemaValidation.compile` = `JsonSchemaFactory.getInstance(V202012).getSchema(readTree(file))`
  with no URI mapping (file read). There are exactly 11 distinct `JsonSchemaValidation.compile("...")` targets and no
  other `JsonSchemaFactory` use in `backend/src`. None of those 11 contains a non-`#` `$ref`. Cross-file refs do exist
  elsewhere under `schemas/` (authoring/*, dashboard-layout-patch), but none of those files is harness-compiled.
  `getent hosts helio.local` gives rc=2.
- **D1, empirical probe.** I ran networknt json-schema-validator 1.0.87 (the `build.sbt:268` version) via `java P.java`
  with the cached jars. I replaced `AnalyzeProposalStep` with a relative ref
  (`pipeline-analyze-response.schema.json#/$defs/AnalyzeStep`) and, separately, with an absolute `https://helio.local/...`
  ref. Both throw `JsonSchemaException: java.net.UnknownHostException: helio.local`. The "unresolvable by the harness"
  claim is confirmed, not just asserted.
- **Declining the `$ref` (AC 2 is "consider").** Sound:
  - A `$ref` would break the existing contract test 3.11 (`PipelineAnalyzeProposalRoutesSpec.scala:667-681`), unless the
    harness gains URI mapping. That would be infrastructure scope better owned by a ticket that de-duplicates all copied
    defs.
  - The rationale is written into the contract file itself.
- **Consumers.** No Scala, TS or helio-mcp code embeds the description text. The only non-archive references to the file
  are the schema itself and test 3.11.
- **Scope.** Line 101 is the same defect in the same file, so including it is justified. ACs 1–3 are covered by tasks
  1.1–1.2, D1, and 2.3. No contract or spec delta is needed for annotation-only text.

### Verdict: CONFIRM

### Non-blocking notes
- design.md cites `DataSourceRoutesSpec.scala lines 200-202`, but the comment is at lines 201-203
  (`backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala`, "unresolvable host" on line 202).
  This is an off-by-one and does not affect execution.
- premise-validation.md says "13 harness-compiled schemas"; design.md's 11 is the correct live count.
- D1 does not mention that a `$ref` would also silently drop the proposal def's `type.minLength: 1`. That is one more
  reason to decline, not a defect.
- Task 2.4's `npx prettier` resolves through an ancestor `node_modules` (the main checkout's). It works today, but it is
  environment-dependent.
