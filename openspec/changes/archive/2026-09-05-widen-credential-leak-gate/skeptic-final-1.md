## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth.** `git diff main...HEAD --stat` — 16 files, the substantive ones being
`scripts/check-no-credential-in-agent-surface.mjs` (+595/-123 region),
`scripts/check-no-credential-in-agent-surface.selftest.mjs` (+152), `.gitignore` (+6),
`helio-mcp/e2e/connector-authoring.ts` (+6/-2). Read the full post-change script and
self-test, not the reports' description of them.

**AC1 — scans `helio-mcp/**`.** MET. `SURFACES` carries an `mcp` entry rooted at
`helio-mcp`, `include: "allNonBinary"`, pruning `node_modules`/`dist`. Run in the
worktree: `OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)`.

**AC6 — before/after counts.** VERIFIED INDEPENDENTLY, not taken from the report.
Ran the *main-checkout* copy of the script: `OK (16 files scanned: 13 assistant-surface,
3 fixture, 0 violations)`. Worktree: `82 = 13 + 3 + 66`. The ticket's 16 -> 82 with the
13/3/66 split is exactly reproduced.

**AC2 — scan-root set documented in-script.** MET. The header comment enumerates all
three surfaces with their include rule and checks, and the `SURFACES` table matches it
line for line.

**AC3 — a zero-file surface fails loudly.** MET *for the zero-**file** case*. `main()`
builds `surfaceFiles` from a single loop over `SURFACES` and the vacuity filter iterates
`SURFACES` directly, so the specific defect fixed in f17e9781 (a hand-keyed
`surfaceCounts` literal yielding `undefined`) is genuinely gone — there is no second
count structure. See CR1/CR2 below for the surviving siblings.

**AC4 — self-test proves the new coverage.** Self-test run: 18/18 `ok`, exit 0. I did
not accept those greens; I **mutation-proved every load-bearing case** by editing the
script, re-running the self-test, and restoring:
| mutation | self-test result |
|---|---|
| drop `secretLiteral` from `mcp` checks | RED — 2 failures (mcp secret-literal case) |
| drop `bcrypt`/`email` from `mcp` checks | RED — 2 failures (mcp email case) |
| `vacuousSurfaces = []` | RED — the VACUOUS-SURFACE-message assertion (proving that
case asserts the vacuity path, not merely the drift-caused non-zero exit) |
| `computeDriftErrors` returns `[]` | RED — 2 failures (drift case) |
| `BCRYPT_HASH_REGEX` -> never-match | RED — 2 failures (fixture bcrypt case) |
No case was found that cannot go red. The self-test is not evidence-shaped non-evidence.

**Iron Laws.** `verification-before-completion`: satisfied — every claim above is from a
command I ran in this worktree. `systematic-debugging`: this is a gate-widening, and the
root cause (surface table not driving collection) is probe-recorded and closed with a
red-provable case.

**No UI changes** — tooling-only; no servers started, no Playwright, no migration, per
the stated constraints. Worktree left clean (`git diff --stat` empty; only the
pre-existing untracked `evaluation-2.md`).

---

### Attacking the gate: can it still print OK while examining less than it claims?

Yes — two reproduced siblings of the fixed defect. Both were reproduced twice and both
are asymmetric with behavior the script *already* implements for the `include` field
(`collectFiles` **throws** on an unknown include rule; nothing validates `checks`).

**Sibling A — an unknown/typo'd check name is silently a no-op.**
Mutated only the string `"secretLiteral"` -> `"secretLiterals"` in the `mcp` entry
(`bcrypt`/`email` left intact), planted a real-shaped credential
`helio-mcp/.hole-probe.ts` containing `helio_pat_` + 64 chars, ran the gate:

```
check-no-credential-in-agent-surface: OK (83 files scanned: 13 assistant-surface, 3 fixture, 67 mcp, 0 violations)
exit=0
```

The gate reports 67 mcp files "scanned" and green **over a planted production-shaped
PAT**. `runChecksForSurface` dispatches with `surface.checks.includes(...)`; a name that
matches no branch simply does nothing. Reproduced a second time identically. This is the
ticket's own failure mode restored by a one-character edit.

**Sibling B — a duplicate `id` silently drops a whole surface's file set.**
`surfaceFiles` is a `Map` keyed by the hand-written `id` string — the same id-keyed
lookup shape as the defect f17e9781 removed. Adding a second entry with `id: "fixture"`:

```
check-no-credential-in-agent-surface: OK (105 files scanned: 13 assistant-surface, 13 fixture, 13 fixture, 66 mcp, 0 violations)
exit=0
```

The real `fixture` surface's 3 files were never scanned (overwritten in the Map), yet the
breakdown prints a plausible-looking `13 fixture` twice and exits 0. Neither the vacuity
check nor the drift guard notices.

**Sibling C — `checks: []`.** Same probe as A with `checks: []`: `OK (83 files ... 67
mcp ...)`, exit 0, planted credential undetected. A surface can contribute to the
headline count while running zero checks.

Neither design.md, tasks.md, nor the spec delta mentions unknown-check-name validation,
duplicate ids, or empty `checks` — this is an unconsidered gap, not a documented
deferral. Each fix is a few lines in `main()`, adjacent to code that already exists.

### Verdict: REFUTE

The widening and the vacuity/drift guards are real, correct, and mutation-proven — the
substance of the change is sound. But this ticket's stated purpose is to close the
*class* "green over code never examined", and the class is still open along the `checks`
axis and the id-keying axis. Shipping as-is leaves a one-character-typo path back to
exactly the HEL-886 condition.

### Change Requests

1. **Validate `checks` names against a known set, and reject an empty `checks`**
   (`scripts/check-no-credential-in-agent-surface.mjs`, `SURFACES` consumption in
   `main()`/`runChecksForSurface`, ~line 470 / ~line 620). Mirror what `collectFiles`
   already does for `include`: define the known check names in one place and throw (or
   push a hard error) for any `SURFACES` entry whose `checks` contains an unrecognized
   name or is empty. Evidence it is needed: mutating `"secretLiteral"` -> `"secretLiterals"`
   with a planted `helio_pat_`+64-char literal under `helio-mcp/` yields
   `OK (83 files scanned: ... 67 mcp, 0 violations)`, exit 0.

2. **Stop keying the per-surface file lists by the hand-written `id`**
   (`main()`, the `surfaceFiles` `Map`, ~lines 626–645). Key by array index or attach the
   file list to the surface object (e.g. `SURFACES.map((s) => ({ surface: s, files: ... }))`),
   or add an explicit duplicate-`id` assertion. Evidence: a second entry with
   `id: "fixture"` makes the real fixture surface's 3 files vanish from the scan while the
   gate prints `OK (105 files scanned: 13 assistant-surface, 13 fixture, 13 fixture, 66 mcp)`,
   exit 0. The header comment's claim that "there is no second, hand-keyed place that
   repeats an id string" is not quite true while the Map key is that string.

3. **Add one self-test case (or a note in the header) for whichever guard CR1/CR2 land
   as**, so this class is red-provable rather than only argued — consistent with how the
   vacuity and drift guards were each given a red case in
   `check-no-credential-in-agent-surface.selftest.mjs`. A structural assertion running at
   the top of `main()` can be exercised by the existing subprocess harness the same way.

### Non-blocking notes

- `helio-mcp/e2e/connector-authoring.ts:109` prepends `"not-a-real-password "` to an e2e
  throwaway registration password purely to satisfy `NAMED_SECRET_LITERAL_REGEX`. It is
  harmless and follows the documented synthetic-marker convention, but it is a (mild)
  instance of production/test code being edited to appease the gate — worth keeping an eye
  on if the named-secret rule is later widened.
- The drift guard classifies directories only; top-level files and dot-directories are
  never classified. This is documented honestly in the header, so it is a stated limit
  rather than a hidden gap — no action requested.
