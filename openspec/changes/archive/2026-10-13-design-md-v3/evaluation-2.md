## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `982c87935615021f05ed1678ade88217a1bd08ef`.
Base: `2c1ab0326fe6c171152bc59ff2918f433558296f`, resolved fresh with `resolve-review-base.sh`.
Cycle-2 delta over `6cbf218b6`: `DESIGN.md`, `pr-notes.md`, `tasks.md`, `openspec/specs/pwa-installability/spec.md` and `evaluation-1.md`. `git diff 6cbf218b6 HEAD --name-only -- frontend` is empty, so no frontend file changed.

### Phase 1: Spec Review — PASS

Each cycle-1 change request, checked against the tree:

1. **CR1, HEL-441 D7 nesting (DESIGN.md:403-407): FIXED.** The rule now reads "animate in once (a fade plus a 4–10px rise). A backdrop fade paired with its panel's rise … counts as ONE entrance". It is a single bullet. `grep -n -B1 "^\s*[-+*] [0-9]" DESIGN.md` returns no hits.
2. **CR2, loop-token contradiction (DESIGN.md:398-401): FIXED.** The rule now reads "do not add loop-duration tokens ahead of that need. (Transition durations are the §10 scale.)", which no longer conflicts with §10.
3. **Suggestion, pwa-installability: RESOLVED by reverting.** `git diff --quiet 2c1ab0326 HEAD -- openspec/specs` succeeds, so the main specs are byte-identical to base. The MODIFIED delta carries the `#0f0e0d` update, the same way error-state-pattern and page-shell-primitives already do.

   This leaves one pre-archive hit: `openspec/specs/pwa-installability/spec.md:25` still says `#121110`. The design-language-v3 scenario "No stale copy … in openspec/specs" therefore holds only after archive. That is the normal OpenSpec lifecycle, and `pr-notes.md` documents it. The delta's requirement header matches the main spec's header exactly, so archive will apply it cleanly.

Re-checked from cycle 1, and still true:
- `--motion-*` tokens: all 8 named in DESIGN.md are declared in theme.css (my own command).
- Tag counts are 40 `[mechanical]` and 31 `[judgment]`, up from 22 and 12 in v2.
- `comm -23` of the v2 and v3 HEL-id sets is empty, so no HEL-id was lost.
- The only `#121110` hits in frontend, e2e, docs and DESIGN.md are the labelled dated line DESIGN.md:1169 and the pre-archive spec line above.
- §0–§8 numbering and the hit-expander clauses are unchanged by this delta.
- CONSTRAINTS C1–C6 are honored. No test file changed in cycle 2.

The tasks.md 3.4 annotation says onboarding/first-run and a populated dashboard were not captured. Evaluation-1 covered both against the running app: a populated dashboard in both themes, plus a discriminating `--font-heading` switch probe across every heading role.

### Phase 2: Code Review — PASS

Fresh gates in WORKTREE_PATH:
- `npm run lint`: clean.
- `npm run format:check`: all files formatted.
- `npm run typecheck`: clean.
- `HELIO_JEST_MAX_WORKERS=3 nice -n 19 npm test`: 590/590 suites, 7063/7063 tests.
- `check:openspec`: clean.
- `check:spec-structure`: 0 issues.
- `openspec validate design-md-v3 --type change`: valid.
- I did not re-run `npm --prefix frontend run build`, because `frontend/**` is byte-identical to the tree that built successfully in cycle 1 (exit 0).

Issues: none.

### Phase 3: UI Review — PASS (carried from cycle 1)

No runtime-affecting file changed in cycle 2. The frontend diff is empty, and the only spec change is a text revert. The cycle-1 running-app results therefore apply unchanged to this commit:
- Dark canvas is `rgb(15, 14, 13)`; light is unchanged.
- Every heading role computes Schibsted Grotesk and switches on `--font-heading`.
- The populated dashboard, `/pipelines` at desktop and 390×844, and `/login` render cleanly in both themes.
- There are no console errors beyond the expected pre-login 401.

### Overall: PASS

### Non-blocking Suggestions
- DESIGN.md A.2: the v2 rung table still appears twice, once in the verbatim block and once in the labelled dated block.
- DESIGN.md A.5: "see `Skeleton`'s own explicit override below" still dangles.

Both are cosmetic and carried from cycle 1.
