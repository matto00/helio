## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `d7e12a6f` (on top of `0e32bd79`). Every result below is from my OWN run;
the executor's pasted transcripts and its mutation claim were re-derived independently, not accepted.

### Scope of this cycle

`git diff 0e32bd79..HEAD` touches exactly three things: the `helioApi.ts` doc comment (CR1), the
two regexes + a comment in `scheduleTools.test.ts` (CR2), and planning artifacts
(`files-modified.md`, plus cycle 1's `evaluation-1.md` committed into the change dir). No production
behaviour changed, and `UPDATE_DASHBOARD_DESCRIPTION` itself is byte-identical to cycle 1 — so cycle
1's Phase 1 findings and the live `&`/schedule probe evidence remain valid and were not re-run.

### Phase 1: Spec Review — PASS

Unchanged from cycle 1 (all five acceptance criteria closed; AC4 closed by the stdio probe, correctly
scoped). Re-confirmed the one criterion this cycle could have regressed:

- **AC5 (no backend/frontend/migration changes)** — re-derived by enumerating the full
  `git diff main...HEAD --name-only`, not by trusting the claim. 19 files: 6 under `helio-mcp/src/`,
  13 under `openspec/changes/mcp-schedule-and-rename-tools/`. Files outside those two prefixes: **none**.
  Files matching `^backend/`, `^frontend/`, or `migration`: **0**.

### Phase 2: Code Review — PASS

**CR1 — false doc comment. VERIFIED FIXED.**
`helio-mcp/src/helioApi.ts` now reads "…`JSON.stringify(value, null, 2)` yields `undefined` (not a
string at all) for an actual `undefined` return". Re-measured the underlying fact myself:
`JSON.stringify(undefined, null, 2)` → value `undefined`, `typeof` → `"undefined"`, `is string?` →
`false`. The comment is now true. I also grepped the whole of `helio-mcp/src` and `design.md` for the
old claim (`string \`"undefined"\``): zero remaining occurrences, so the falsehood was not merely
moved.

**CR2 — dead guard. VERIFIED FIXED, by my own mutation, not the executor's transcript.**

I mutated `UPDATE_DASHBOARD_DESCRIPTION` in `scheduleTools.ts` to
`"Rename an existing dashboard (PATCH /api/dashboards/:id). Accepts \`appearance\` too. This tool does not accept \`appearance\` or \`layout\`; …"`
— deliberately keeping the legitimate "does not accept" clause intact, so the `toContain("does not
accept")` assertion still passes and ONLY the regex can produce the failure. Result:

```
● description contracts … › update_dashboard does not advertise appearance or layout as accepted fields
    expect(received).not.toMatch(expected)
    Expected pattern: not /(?<!not )accepts?\s+[`'"]?appearance/i
  at Object.<anonymous> (helio-mcp/src/tools/scheduleTools.test.ts:117:46)
Test Suites: 1 failed, 1 total
Tests: 1 failed, 14 passed, 15 total
```

RED, and red on line 117 — the regex line — which is the load-bearing proof. I then restored the file
and confirmed `git status --porcelain` is empty, so the revert is exact and nothing of my probe
remains in the tree.

Critically, I also confirmed the mutation **discriminates old from new**: cycle 1's regex
`/accepts?\s+appearance/i` tested against that identical mutated string returns `false` — it would
have stayed green. So this is a genuine repair of a dead guard, not a cosmetic rewrite.

**New-dead-spot audit of the negative lookbehind (the orchestrator's specific concern).** I did not
reason about this; I measured `/(?<!not )accepts?\s+[`'"]?appearance/i` against a battery of phrasings:

| Phrasing | Result | Verdict |
|---|---|---|
| the ACTUAL description, "does not accept \`appearance\`" | passes | correct — no false alarm |
| "Accepts \`appearance\` too." | TRIPS | correct (the cycle-1 dead spot, now caught) |
| "Accepts appearance too." | TRIPS | correct |
| "accepts 'appearance'" / "accepts \"appearance\"" | TRIPS | correct |
| "It also accepts appearance updates." | TRIPS | correct |
| "This tool cannot accept \`appearance\`." | passes | correct — `canNOT accept` is a non-advertisement, and the `not ` in "cannot " excludes it, which happens to be the right answer |
| "It will not accept appearance." | passes | correct |
| "It does not **currently** accept \`appearance\`." | TRIPS | **false positive**, not a dead spot |

The orchestrator asked specifically about wording sitting outside the `(?<!not )` window in either
direction. Measured: the "will not accept" direction is excluded **correctly** (it is a genuine
non-advertisement), and the "does not currently accept" direction trips the guard — i.e. the
lookbehind's one imperfection fails **loud**, not silent. A future author inserting that wording gets
a red test and must either reword or widen the regex; they are never handed a false green. That is the
acceptable failure direction, and it is not the defect class CR2 raised.

**Gates — all re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):**

- Dependency trees confirmed present on disk BEFORE any exit code was read: `node_modules` and
  `helio-mcp/node_modules` both exist. `git status --porcelain` empty (post-mutation-revert), so no
  stray local state is propping up any result.
- Collection proof first: `--listTests` enumerated **14 files by name** (non-empty), including
  `helio-mcp/src/tools/scheduleTools.test.ts`. Reconciles with the documented 13-suite baseline + 1 new.
- `npx jest helio-mcp --testPathIgnorePatterns "/node_modules/" "/openspec/" "/frontend/" "/e2e/" "/helio-mcp/dist/"`
  → **14 suites / 245 tests passed**, 0 failed.
- `npx tsc --noEmit` in `helio-mcp/` → **exit 0**, no output (trustworthy: `helio-mcp/node_modules` confirmed present first).
- `npm run lint` (`eslint . --max-warnings=0`) → exit 0, clean. `npm run format:check` → clean.
- `npm --prefix frontend run build` / `sbt test` not run: zero files under `frontend/**` or `backend/**` changed.

Everything else from cycle 1's Phase 2 stands unchanged and was not re-litigated: the four tool
descriptions still match `PipelineScheduleService.scala` claim-for-claim, 62 unique `registerTool`
names with no duplicates, wire types mirroring `jsonFormat10`/`jsonFormat4`, and correct
error-propagation at the handler boundary.

### Phase 3: UI Review — N/A

No trigger matched: no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`
(the spec deltas live under `openspec/changes/**`, which is not a trigger).

### Overall: PASS

Both cycle-1 change requests are genuinely closed, each verified by independent measurement rather
than by reading the diff or trusting the executor's transcript.

### Non-blocking Suggestions

(Carried from cycle 1, still not blocking, plus one new observation.)

- `GET_PIPELINE_SCHEDULE_DESCRIPTION` says "Returns the full schedule record:" then enumerates 8 of
  the 10 fields, omitting `id` and `pipelineId`. Either drop "full" or list all ten.
- Note in the PR description that `write.ts` (1241 lines) and `helioApi.ts` (1083 lines) remain past
  CONTRIBUTING's ~400-line split threshold — that note is what the standard asks of an author adding
  to such a file.
- The CR2 regex still cannot catch non-`accept` phrasings ("Supports \`appearance\`", "Accepts: appearance",
  "Accepts an appearance object", "appearance is accepted") — measured. That is inherent to any
  regex-over-prose guard and was outside CR2's scope; the guard now covers the realistic
  affirmative forms, which is what mattered. Worth remembering rather than acting on.
