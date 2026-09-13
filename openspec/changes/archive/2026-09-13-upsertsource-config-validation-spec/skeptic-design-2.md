## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `272673afe1005e0eeea539ceb2c1c102f1aa7f88`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/upsertsource-config-validation-spec/HEL-1099`.
- **Round-1 CR1 (registration owner and ordering): FIXED, and the fix is real, not just words.**
  - `mcp__linear__get_issue HEL-1100 includeRelations=true` returns `relations.blockedBy: [HEL-1101]`,
    plus a description note that names HEL-1100 as the ticket that registers the kind and forbids
    flipping the pinned rejection before HEL-1101's cycle check exists.
  - design.md Decision 1 has a new "Ownership and ordering" section that names HEL-1100 and states
    the HEL-1101 blocker.
  - The `UpsertSourceConfig.scala` scaladoc (around lines 48-58) says the same thing.
  - Both the capability spec's "not yet creatable" requirement and the archived delta now carry a
    SHALL NOT: registration must not land before validation-time cycle detection exists. The two
    spec copies differ only in the header lines (`# ... Specification` and
    `ADDED Requirements`/`Requirements`), which is expected from an archive sync.
- **Round-1 CR2 (false "no step validates on write" claim): FIXED and accurate.**
  - `PipelineStep.scala:156` has `def validateRawConfig(raw) = strictDecodeProblem(raw)` as the
    `Companion` default.
  - It is called on write at `PipelineService.scala:1718` and `:2001`, `PipelineProposalService.scala:282`
    and `PatchSetApplyResolvers.scala:190`.
  - proposal.md now credits HEL-814's generic check and says the enum constraint is what's new.
  - I checked that the enum claim is true. `UpsertSourceConfig.decode` reads `mode` as a raw
    `String` (`StepCodecUtil.str`, line 162), so the generic strict decode would accept `"upsert"`.
    Only the new `modeError` (lines 227-231) rejects it. The proposal's wording describes the code
    correctly.
- **Non-blocking notes from round 1:**
  - tasks.md 3.1 now matches the spec: absent fields decode, and a present wrong-typed value fails.
  - design.md Risks has a new bullet saying an empty `dataSourceId` passes write-time validation
    and HEL-1100 must reject it at run time. Both notes are addressed.
- **Whole-design re-review against HEL-1099 and the code:**
  - The ticket's config (target as a new name or an existing id, mode `append|replace`) is covered
    by requirement 1.
  - Write-path strictness is covered by requirement 3 and `validateRawConfig`.
  - Read-path tolerance (the ticket's `rowToDomain` trap) is covered by requirement 2.
  - The ticket's openspec-spec AC is met by `openspec/specs/pipeline-upsertsource-config/spec.md`.
  - No scope drift: `git diff 0fd32ab4 --stat` shows one main file, one test, and openspec
    artifacts only. There are no route, migration or registry changes, so no API/schema contract
    delta is needed.
  - No TODO/TBD placeholders. The tasks line up with the design's decisions.

### Verdict: CONFIRM

### Non-blocking notes

- The `UpsertSourceConfig.scala` scaladoc (around line 39) still says "a legacy/malformed persisted
  row still reads". That is the same imprecision round 1 flagged in tasks.md: a present wrong-typed
  value does not read. Consider changing "malformed" to "absent-field" in a later touch.
- The change was still archived before the design gate ran (process note carried over from round 1).
