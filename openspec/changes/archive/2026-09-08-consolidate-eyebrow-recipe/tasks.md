# Tasks — HEL-732 Consolidate the `.eyebrow` recipe

This is a CSS consolidation with NO logic to unit-test. **The evidence IS computed-style
measurement.** A CSS diff is not evidence here, and a green unit suite proves nothing about it.

## 0. COUNTS ARE PREDICATES, NOT INTEGERS — derive them, do not inherit them

- [x] 0.1 Every population below is defined by a PREDICATE. **Evaluate each predicate against the
      tree yourself and report the count it yields.** Do NOT treat any integer in these artifacts as
      authoritative — they are the values on `9e995f69` and they decay on every edit.
      This lane has produced FIVE stale-count defects, including two contradictory lines in one file,
      and a `grep -c` that was wrong in three successive documents on HEL-1037. An integer in prose
      is a liability; a predicate stays true.
- [x] 0.2 The predicates, in evaluation order. A block belongs to the FIRST one it matches, so the
      populations are disjoint by construction and cannot double-count (they did once already):
      **P1 DEAD** — the block's selector has zero non-CSS references in `frontend/src`.
          → never converted; listed under task 5 as "selector has no consumer".
      **P2 SIZE-DIVERGENT** — declares a `font-size` the utility would not produce.
          → never converted; task 4 (flag, do not decide).
      **P3 UNREACHABLE** — its rendered state cannot be reached in the running app.
          → never converted; listed as "state not reachable to measure". Determined during execution,
            NOT from these artifacts. **RECORD WHAT YOU ATTEMPTED** — the route you tried and where
            it stopped — so "unreachable" is an auditable attempt rather than a bare assertion. P3 is
            effort-dependent, and misclassifying a block INTO it is conservative (unmeasured →
            unconverted → listed), so an honest failed attempt costs only converted-set size and can
            never cause a silent regression.
      **P4 VALUE-IDENTICAL** — declares **ALL FIVE** recipe properties, each with the value the
          utility applies (including an explicit `font-weight`).
      **P5 WEIGHT-INHERITING** — declares the other four with the utility's values but **declares NO
          `font-weight`**, inheriting it instead.
      **P6 OTHER** — matches none of the above.
          → never converted; listed under task 5 with what it declared and why it matched nothing.
          P6 exists so the partition is TOTAL BY CONSTRUCTION rather than merely lucky on this tree:
          it should be EMPTY on `9e995f69`, and a non-empty P6 means the predicates no longer cover
          the corpus — **stop and report it** rather than forcing a block into P1..P5.
      NOTE the boundary, because an earlier wording got it wrong and the error was invisible: P4 said
      only "declares the recipe's properties with the utility's values", which a P5 block satisfies
      LITERALLY — it declares four of them, each matching — so P4, evaluated first, SWALLOWED ALL OF
      P5 and emptied the population this ticket exists to protect. **The discriminator is the
      presence or absence of an explicit `font-weight` declaration, nothing else.**
      P4 and P5 are CANDIDATES ONLY: both still require per-block measurement (task 2.0), and either
      may fail it.
- [x] 0.3 Report, in the PR: the count each predicate yielded, and the FINAL CONVERTED COUNT. If the
      converted set is small, say so plainly — a smaller set that is provably safe is worth more
      than a larger one that is probably safe, and the value of this ticket is legible only if the
      number is stated rather than implied.
- [x] 0.4 A SCANNER IS A CLAIM. Two independent scans of this candidate set disagreed by one block
      during design (mine mis-parsed a comma-separated selector and reported a dead selector as
      live). If your enumeration disagrees with the design's stated values, do not assume either is
      right — reconcile them and report which was wrong and why.

## 1. Enumerate against the predicate — do not trust any count

- [x] 1.1 Re-derive the candidate set yourself with the stated predicate: a rule block (comments
      stripped, `theme.css` excluded) declaring N of the 5 recipe properties WITH THE RECIPE'S OWN
      VALUES — `font-family: var(--font-mono)`, `text-transform: uppercase`,
      `font-size: var(--eyebrow-size)`, `letter-spacing: var(--eyebrow-tracking)`,
      `font-weight: var(--eyebrow-weight)`.
      Expected on `9e995f69`: 23 files / 29 blocks with >=3; 12 with all 5; 17 with exactly 3. If
      your numbers differ, STOP and report — `main` may have moved.
- [x] 1.2 The ticket's "17 files" matches NO measure. It coincides with the 17 partial BLOCKS, which
      is a GUESS at what the original sweep counted. Label it as a guess wherever it appears; never
      state it as a finding.
- [x] 1.3 Classify every block using **§0's predicates P1..P6**, evaluated in order. Do NOT use
      design D1's table — it is marked SUPERSEDED there and is retained only to show what the
      integer framing got wrong.

## 2. P4 blocks — value-identical is NOT the same as safe

- [x] 2.0 "Provably safe from declared values" is FALSIFIED (design D1a). Adopting a utility CLASS
      is not neutral even when every value matches: 7 of the 29 blocks are descendant/compound
      selectors at specificity (0,1,1) vs `.eyebrow`'s (0,1,0), and cascade POSITION shifts
      (`theme.css` is a global import at `main.tsx:12`; component CSS arrives transitively at `:6`).
      The swap can change WHICH DECLARATION WINS with no value changing anywhere.
      **MEASURE EVERY BLOCK YOU CONVERT — per-population sampling is invalid**, because the delta is
      per-SELECTOR. If that makes the safe set smaller, it is smaller; do not stretch a sample.
- [x] 2.1 Convert **P4 blocks only**, and only after 2.0's per-block measurement shows computed
      style unchanged. Do NOT convert by the old integer framing ("the 12 full copies"): §0's
      predicates are evaluated FIRST, and a block matching P1/P2/P3 is excluded no matter how many
      recipe properties it declares. Two full 5-property copies are P1 DEAD
      (`.audit-event-table__th`, `.sources-page__section-title` — both confirmed by two independent
      scans) and must NOT be converted.
- [x] 2.2 Replace the declarations with the shared utility and add the `className`. Do NOT change
      `theme.css`, `.eyebrow`, or the `--eyebrow-*` tokens.
- [x] 2.3 Capture before/after computed `font-size` and `font-weight` for EVERY block converted —
      not a sample. See 2.0: sampling is invalid here because specificity and cascade position differ
      per selector, so one block's result says nothing about its neighbour's.

## 3. P5 blocks — the ones that would GAIN a font-weight. The actual ticket.

- [x] 3.0 This section governs **P5 blocks only** — those declaring the other four recipe properties
      with the utility's values but NO explicit `font-weight`. Derive the population from §0; do not
      read a count from here. (Historical note, since the error was invisible: an earlier framing
      put this population at 14 and double-counted. The `var(--text-xs)` block
      (`AgentMemoryList.css:82`, `.agent-memory-list-table__kind`) declares no `font-weight` EITHER,
      so it appeared in both this population and task 4's — the earlier split summed to 30 for 29
      blocks. It is counted once, in task 4, and is NOT measured here. 12 + 3 + 13 + 1 = 29.
- [x] 3.1 For EACH of the 13, read the COMPUTED `font-weight` in the running app BEFORE conversion
      and AFTER. Equal ⇒ no-op, convert. Different ⇒ a visual change: justify it in the PR or leave
      the block alone.
- [x] 3.2 DO NOT EYEBALL THIS. A change from computed 400 to 500 is exactly the magnitude that looks
      fine in isolation and wrong beside its neighbour — that is how HEL-451's `--weight-normal`
      fallback shipped at computed 600 with nobody noticing. The question is NUMERIC: equal or not.
- [x] 3.3 The inherited weight at these sites is carried by NO SOURCE TEXT ANYWHERE — it is the
      cascade's product. A CSS diff cannot see it and no unit test can. Measurement is the only
      instrument; do not substitute inspection.
- [x] 3.4 Record the before/after pair for each of the 13 in the PR body, including the ones you did
      NOT convert.
- [x] 3.5 METHOD — binding, and it must live HERE, not only in workflow-state (the executor works
      from tasks): read COMPUTED style in the RUNNING APP; take the reading in BOTH THEMES; and take
      the before/after pair from **THE SAME ELEMENT IN THE SAME STATE**, resolved by the block's OWN
      selector. A reading from a differently-scoped selector, or a light-theme render compared
      against a dark-theme one, produces a difference that is REAL AND IRRELEVANT. This lane has
      already had a citation point at the wrong selector once (HEL-469's `DataGrid.css:72` was
      `thead th`, not the cell).

## 3b. UNREACHABLE and DEAD blocks — do not convert, do not fake

- [x] 3b.1 DEAD SELECTORS: `.audit-event-table__th` and `.sources-page__section-title` have **ZERO
      non-CSS references** in `frontend/src` — nothing renders them. They sit in task 2's
      "pure refactor" set, where measuring every converted block is mandatory, so they are
      **unmeasurable and therefore unconvertible**. Leave both; list them under task 5 with the
      reason "selector has no consumer". Do NOT delete them either — dead-CSS removal is a separate
      concern with its own justification, and this ticket is a consolidation. Note the observation
      in the PR.
- [x] 3b.2 UNREACHABLE STATES: several blocks live on AI proposal / patch-set / assistant surfaces
      that may not be reachable in a normal dev session. **If you cannot reach the real rendered
      state, do NOT convert the block.** List it under task 5 with the reason
      "state not reachable to measure".
- [x] 3b.3 DO NOT BUILD A SYNTHETIC SCAFFOLD to make an unreachable block measurable. A scaffold
      supplies its OWN cascade, so the inherited `font-weight` it reports is not the one the real
      surface produces — it would fabricate the exact quantity being measured. An unmeasured block
      left alone is honest; a block converted on a fabricated reading is a silent regression.
- [x] 3b.4 If this shrinks the converted set, the converted set is smaller. Do not stretch a reading
      from one block to cover another — the specificity/cascade delta is per-SELECTOR (task 2.0).

## 4. The `var(--text-xs)` block — flag, do not decide

- [x] 4.1 Do NOT convert it. Do NOT quietly leave it. List it in the PR with its file and selector
      and the observation that its size genuinely differs from the utility.
- [x] 4.2 Also state whether it SHOULD be an eyebrow at all — a mono-uppercase label at a different
      size may be a deliberate variant, or drift predating the recipe. If the code does not make that
      obvious, RAISE IT AS AN OPEN QUESTION for the owner rather than deciding it.

## 5. Every unconverted block is listed

- [x] 5.1 Any block left alone — computed-style difference, task 4, or any other reason — appears in
      the PR body with FILE, SELECTOR and REASON. A sweep reporting only what it changed leaves the
      remainder invisible, and an unreviewable remainder is debt rather than a decision.

## 6. Rendered evidence

- [x] 6.1 Screenshots BEFORE and AFTER, BOTH themes, for at least one instance of EACH converted
      class. Weight and tracking read differently against different surface contrasts.
- [x] 6.2 Cover all three structural contexts present in the candidate set — table headers (`__th`),
      inline badges/kinds, and `dt` terms — since a container that sets its own weight affects each
      differently.
- [x] 6.3 Screenshots to `.concertino/runs/HEL-732/evidence/`, NEVER `openspec/**`, and never
      `git add -f` past `.gitignore`.
- [x] 6.4 CONTENT SELF-AUTHENTICATE before any observation: confirm the dev server serves THIS branch
      by checking for a string that exists only here (pick one from your own diff; verify it has 0
      occurrences on `origin/main` first). A port number proves only what you connected to, and the
      collision is symmetric.

## 7. Gates

- [x] 7.1 `npm run lint`, `npm run typecheck`, `npm run format:check`,
      `npm --prefix frontend test`. Do NOT cite root `npm test` — its root jest arm finds zero tests
      in a worktree and reports silence as a pass. State which gate exercised the change; for a CSS
      consolidation, expect the honest answer to be "none of them meaningfully" and rely on task 3/6
      evidence instead.
- [x] 7.2 `check:tokens` (HEL-1037, on `main` since `9e995f69`) must pass — it now governs every
      `var(--*)` this sweep touches, so a typo'd token fails at commit rather than rendering wrong.
      Note in the PR that the guard shipped two tickets ago is protecting this one.

## 8. Handoff

- [x] 8.1 Rebase on `main` before the PR and RE-RUN task 1.1's enumeration if anything moved — the
      candidate set is derived from the tree, not fixed.
- [x] 8.2 Update `files-modified.md`, run gates, COMMIT before yielding.
- [x] 8.2a PR body MUST state that the ticket's AC — "no component CSS file hand-declares the
      eyebrow recipe" — is **UNACHIEVABLE under the current standard**, because `DESIGN.md:276`
      explicitly permits copying, so every block is currently compliant. Full elimination requires
      the amendment filed as **HEL-1043** (verified open). Say this plainly rather than quietly
      under-delivering against the AC. Do NOT touch DESIGN.md, not even to add a note.
- [x] 8.3 PR body states: the PREDICATE and the counts it yields (not a bare number); the
      17-coincidence labelled a GUESS; the three populations and how each was handled; the
      before/after computed weights for all 13; every unconverted block with its reason; task 4's
      open question; and the `check:tokens` payoff.
      **Do not state any count you have not re-derived**, and prefer claims that stay true over
      claims that are precise.
