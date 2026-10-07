## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `d125b654141ac79d96a8fd0f9cb5e74b834c7c0c` (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Premise reproduced:** importing the gate's pure `classifyTopLevelDirs(["e2e-evidence","test-results","e2e"])`
  returns `unclassified: ["e2e-evidence"]`, so a present `e2e-evidence/` is COVERAGE DRIFT on the current tree.
  `e2e/support/evidencePath.ts:18` writes to `<root>/e2e-evidence/<ticket>`. `.husky/pre-commit:23-24` runs both the
  gate and its self-test.
- **Design's claims about the tree hold:**
  - `IGNORED_TOP_LEVEL` sits at `scripts/check-no-credential-in-agent-surface.mjs:762-769` and has six names.
  - `.gitignore:103` is `/e2e-evidence/`.
  - The header table's line numbers are stale: it says coverage/playwright-report/test-results are on lines
    17/18/19, but they are actually on 23/24/25.
  - The header says "UNANCHORED" only, so the anchored `/e2e-evidence/` is outside its stated rule. The design's
    refresh is warranted.
- **AC3 audit premise:** I listed every root-level dir pattern in `.gitignore` (trailing `/`, no inner `/`, not
  dot-prefixed, no glob). The full set is the six existing names, `e2e-evidence`, and the two self-test probes
  `/hel956-selftest-drift-probe/` and `/helio-mcp-hel956-selftest-moved/`. "Only e2e-evidence is missing" is correct,
  and the design's `SELFTEST_PROBE_DIRS` allowlist names exactly those two probes. The reverse check (every
  `IGNORED_TOP_LEVEL` name appears in `.gitignore`) holds today, so it will not go red on day one.
- **The parser rule rejects the right lines:** `frontend/node_modules/`, `backend/target/`, `docs/demo/` and
  `.claude/worktrees/` all have an inner `/` or a dot, and `*.log` is a glob. None is wrongly required.
- **Mutation mechanism exists:** `runMutatedScript(find, replace, destPath)` (selftest `:273`) does exact-once
  replacement, so the "fails before fix" case cannot silently run the unmodified script. Task 1.2 covers gitignoring
  the new `scripts/.hel1369-*` path, following the precedent at `.gitignore:68,80,89-90`.
- **Spec delta:** the MODIFIED requirement carries the full existing text and all three scenarios from
  `openspec/specs/agent-surface-credential-gate/spec.md`, and adds two testable scenarios. No contract or API is
  affected.
- **AC coverage:**
  - AC1 is covered by task 1.1.
  - AC2 is covered by 2.1 (red log on main's copy) and by 2.2/2.3 (a permanent red/green self-test).
  - AC3 is covered by 2.4/2.6 plus Decision 4.
  - Scope drift is limited to the consistency check, which is a justified mechanical form of AC3.
- **Placeholders and contradictions:** I found no TODO/TBD. Proposal, design and tasks agree.

### Verdict: CONFIRM

### Non-blocking notes

- **Cleanup could delete real evidence (Decision 2).** The self-test removes a marker-owned `e2e-evidence/`, both at
  startup and in `finally`. If an e2e run writes screenshots into that dir while it is planted, or after a crashed
  self-test left it behind, the cleanup would delete real evidence. Safer: delete only the marker and placeholder
  file, then `rmdir` only if the dir is empty.
- **Mutation anchor.** After the fix the set's tail will change. Pick the mutation `find` string so it removes only
  the `"e2e-evidence",` line, for example by matching that line exactly. Assert the red stderr names `e2e-evidence`,
  not just `COVERAGE DRIFT`. A leftover probe dir could also produce that message.
- **Case order.** The real-gate-green case (2.2) needs the earlier probe cases' dirs already removed. Otherwise a
  leftover probe makes it red for the wrong reason. Run it after those removals, or assert the specific stderr.
