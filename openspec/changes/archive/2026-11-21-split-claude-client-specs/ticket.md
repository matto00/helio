# HEL-1803: Split ClaudeClient.scala and the oversized assistant specs (HEL-1637 tidy)

## Description

origin_kind: followup
origin_ticket: HEL-1637 (PR matto00/helio#1201, merged as 3b9f4c83d). The owner chose to file this.

`ClaudeClient.scala` (about 455 lines) and three assistant spec files were already over CONTRIBUTING.md's soft
file-size budget, and HEL-1637 made them larger. The lane recorded a suggested split in
`openspec/changes/archive/2026-11-20-assistant-failure-budget-loop/pr-notes.md`.

## Do

* Split them following that plan, or a better one if the code has moved.
* The split must not change behaviour (CONTRIBUTING.md refactor discipline). If a real bug turns up, file it separately.

## Acceptance criteria

- [ ] Every file touched is within the soft budget, or the PR says why not.
- [ ] `sbt testFull` passes with the same test count before and after the split.
