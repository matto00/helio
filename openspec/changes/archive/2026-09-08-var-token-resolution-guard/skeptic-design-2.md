## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Fresh cold agent. Every number below is my own measurement in this worktree at `3a0c0fe8`
(`git log --oneline -1` confirms base; `git status --porcelain` shows only the untracked change dir).
I did not inherit round 1's figures.

### What I verified (with evidence)

**1. The premise re-measured (110 CSS files under `frontend/src`, comments stripped
`/\/\*[\s\S]*?\*\//g` → spaces preserving newlines):**
- declaration-anchored definitions: **83**; `theme.css` alone: **81**; the two outside are
  `--toast-exit-duration`, `--toast-intent-color` ✓ (D3 confirmed)
- unique `var(--*)` references after stripping: **88**
- unresolved: **8** — exactly `--radius-sm --text-small --space-sm` plus the five overrides ✓

**2. D3a's declaration rule is CORRECT AND COMPLETE on this base.** I attacked it directly:
- `(?:^|[{;])\s*(--x)\s*:` → 83. Line-start-anchored ALONE → also 83, identical sets
  (`inBraceSemiNotLineStart` = empty). The rule neither admits a selector fragment nor drops a real
  declaration.
- Same-line `}`-preceded declarations (the CSS-nesting / minified hazard): **zero** occurrences.
- Uppercase custom-property names anywhere (definitions or references): **zero** — so a
  lowercase-only char class is safe here (but see NB-3).
- `var(` followed by whitespace/newline before the name: **zero**.
- CSS files outside `frontend/src` under `frontend/`: **none**.
- Declarations after a stripped comment resolve fine, since stripping leaves spaces and the anchor
  is `[{;]\s*`.
Conclusion: no fifth red-on-`main` cause found from the extraction rule.

**3. CR1's numbers — BOTH round 1 and the design are right, under different preconditions.**
Naive `(--[a-z0-9-]+)\s*:` **after** comment-stripping → **99** definitions, 16 extras (round 1's
figure). **Without** stripping → **100**, 17 extras, the 17th being `--error`. I traced `--error`:
`features/assistant/ui/ToolCallIndicator.css:81`, inside a comment ("deliberately distinct from
`--error`: the loop stopped…"). It is **not a BEM modifier selector**, so D3a's/1.2a's sentence "the
extra 17 are BEM MODIFIER SELECTORS" is factually wrong for one of its 17. See NB-1.
The load-bearing number (**83**) is correct in both artifacts. `--text` genuinely is admitted by the
naive matcher (`PanelContent.css:75` `.panel-content--text::-webkit-scrollbar`) — the fail-open
argument is real, not rhetorical.

**4. Round-1 CR3 is genuinely resolved, not merely acknowledged.** D2 now says PORT-with-provenance
and forbids the shared-module extraction; task 1.2 says the same. No residual "do not write a third
implementation" imperative that the executor cannot satisfy. design.md and tasks.md agree here.

**5. Round-1 CR2's precedent claim re-verified rather than trusted.**
`scripts/check-no-credential-in-agent-surface.selftest.mjs` does plant in-repo, `finally`-guarded
AND idempotently cleaned at startup (lines 56, 62, 87, 128–135, 222–265). The design's
"take the startup-cleanup half, reject the planting half" is accurately grounded.

**6. Defect fixes are derivable by reading the declaration** (task 3.2's rule is satisfiable):
`PipelineDetailPage.css:524,543` `border-radius: var(--radius-sm)` → `--app-radius-sm`
(`theme.css:59`); `:538` `font-size: var(--text-small)` → `--text-sm` (`:25`).
`AddSourceModal.css:111` `margin: var(--space-sm) 0 0` has **no 1:1 named target** — the scale is
numeric (`--space-1..10`) — so the executor must justify a choice. See NB-4.

**7. Non-goal "no `var()` in TS/TSX" is empirically harmless today.** I resolved every `var(--*)` in
`frontend/src/**/*.{ts,tsx}` against the 83: the only unresolved hits are four regex-pattern strings
inside `theme/tokenAuditSweep.css.test.ts` (`--space-N`, `--space`, `--text-`, `--weight-`). No real
fail-open is being left behind by that non-goal.

### Verdict: REFUTE

The premise, the declaration rule, the CR2/CR3 resolutions and the allowlist are sound — better than
round 1's. But CR1's fix introduced a new contradiction between §1 and §4 of tasks.md that makes the
selftest unimplementable as written **and** would make the decoy assertion vacuous. That is the same
design/tasks-disagreement class this lane has now hit three times, and it lands on the one mechanism
the ticket calls its deliverable.

### Change Requests

1. **Task 1.3a's cardinality assertion collides with tasks 4.3a/4.2a and makes the whole selftest
   vacuous or impossible.** 1.3a lives under "## 1. The guard", and the spec requirement "Only
   declarations count as definitions" says *the check* SHALL assert the SIZE of its definition set.
   4.3a then gives the guard a scan-root seam so the selftest can point it at a `mkdtemp` fixture.
   Run those together: over a temp fixture the definition count is not 83, so the guard exits
   non-zero **for the cardinality reason, on every selftest case**. Consequences, both fatal:
   - Every "must FAIL" case (4.1 undefined ref, 4.2's non-allowlisted token, **4.2a's decoy**) passes
     on an exit code the fixture's own size produced. The decoy would then prove nothing — precisely
     the "green-only assertion" failure 4.2a was written to prevent, re-entering by the back door.
   - Every "must PASS" case (4.2's comment-does-not-trip, 4.2's allowlisted token) can never go
     green, so 4.2 is unimplementable.
   Required: state explicitly that the cardinality assertion applies **only to the default scan
   root** (or lives outside the code path the selftest drives), AND require every selftest case to
   assert on the **specific token named in the guard's output** (`--decoy`, `--nope`, …), never on
   the exit code alone. Put that in design.md D3a and in tasks 1.3a/4.2a so they agree.

2. **Re-site the exactness assertion; as specified it is a cross-lane maintenance trap, and it is
   baked into a durable spec requirement.** A hardcoded "definitions == 83" inside a guard wired into
   `.husky/pre-commit` (task 5.1) makes the **next unrelated ticket that adds a legitimate token**
   red at commit time, with a message about a number. Concurrent lanes are moving frontend files
   right now — tasks.md 7.1 says so itself. A contributor who bumps 83→84 to get their commit through
   is the inverse of protection, and nothing in the design prevents that.
   There is a mechanism that detects over-permissiveness *and* does not rot: assert the extracted
   definition set **exactly equals a known list over a controlled fixture** in the selftest — e.g. a
   fixture containing `--real: 1px;` plus `.a__b--decoy:hover {}` plus
   `.x--other::before {}`, asserting `definitions === ["--real"]`. That is cardinality *and*
   membership, fails loudly on exactly the 1.2a defect, and is unaffected by token growth on `main`.
   Precedent for baseline-in-guard exists (`check-node-root-encoding.mjs:49
   KNOWN_ROOT_QUALIFIED_LINES`), but it is a membership baseline of *accepted exceptions*, not a
   count that every legitimate addition invalidates.
   Required: either adopt the fixture-based exact-set assertion as the primary mechanism, or keep the
   live count **and** state in D3a (a) where it lives, (b) that its failure message tells the reader
   how to update it and why, and (c) why breaking unrelated lanes' pre-commit is an accepted cost.
   Either way, soften the spec requirement from "SHALL assert the SIZE of its definition set" to a
   mechanism-neutral obligation ("an assertion that an over-permissive definition matcher would
   fail"), so an archived spec does not pin one implementation whose cost you have not accepted.
   The `#### Scenario: An over-permissive definition matcher is detected` wording must move with it.

### Non-blocking notes

- **NB-1.** D3a and task 1.2a: "yields 100 … the extra 17 are BEM MODIFIER SELECTORS" and the list
  containing `--error` are correct **only without comment-stripping**; `--error` comes from a comment
  at `features/assistant/ui/ToolCallIndicator.css:81`, not a selector. After stripping it is 99/16.
  Fix the sentence to say which precondition each number is under; otherwise the next reader who
  re-measures gets a mismatch and distrusts the rest.
- **NB-2.** 4.3a's seam already has exact precedent worth naming:
  `scripts/check-dependabot-groups.mjs:392` (`process.argv[2] ?? repoRoot`) plus exported pure
  functions and the `import.meta.url === process.argv[1]` main guard at `:421`. It gives you both
  options at once and costs no new shape.
- **NB-3.** The extraction rule is safe with a lowercase-only char class **today** (zero uppercase
  custom properties on this base), but `[a-zA-Z0-9_-]` costs nothing and removes a silent truncation
  risk if someone ever writes `--panelBg:`.
- **NB-4.** `--space-sm` (`AddSourceModal.css:111`, `margin: var(--space-sm) 0 0` on a hint under a
  `--text-sm` label) has no name-equivalent token; the scale is numeric. Task 3.2 already demands a
  justified choice — worth pre-naming the candidates (`--space-1` / `--space-2`) so the executor does
  not treat "nearest name" as available.
- **NB-5.** `--mobile-panel-height` has a **second** setter,
  `features/panels/ui/grid/MobilePanelStackSkeleton.tsx:34`. Round 1 raised this and D4/task 2.1
  still name only `MobilePanelStack.tsx:104`. Naming both makes the entry survive removal of either —
  which is the entire point of D4's setter-not-sighting rule.
- **NB-6.** `frontend/src/theme/tokenAuditSweep.css.test.ts` (HEL-439) is a sibling token guard the
  design still does not mention. No overlap in what it checks; one sentence saves the next reader the
  rediscovery.
