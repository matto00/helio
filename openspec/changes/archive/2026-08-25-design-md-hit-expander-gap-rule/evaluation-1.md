## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit evaluated: `7329d0d6`. Documentation-only change (`DESIGN.md` + openspec change
bookkeeping). All numeric/factual claims independently re-verified by reading
`openspec/changes/archive/2026-08-21-anchor-mobile-command-bar/{design.md,evaluation-1.md,tasks.md}`
directly (not trusted from planning artifacts or the skeptic's table).

### Phase 1: Spec Review — PASS

Ticket ACs checked against the actual `DESIGN.md` sentence added (Control-metrics
section, before the `**[mechanical]** No other control heights.` sentinel):

- **AC1 (per-side extension + minimum-gap rule)** — present: "The expander extends
  `(44 - controlSize) / 2` per side (8px for a 28px control), so a cluster of
  expander-based controls needs a gap of at least twice that (16px for 28px
  controls)...". Matches archived `design.md:118-123` exactly (8px per side, 16px
  minimum gap, `var(--space-2)`→`var(--space-4)` fix).
- **AC2 (computed size insufficient; elementFromPoint bisection named)** — present:
  "Neither `getComputedStyle(el, "::after").width` nor sampling neighbouring painted
  boxes for overlap can detect this — the failure is region-vs-region, not
  box-vs-box — so verification must bisect each control's real hit extent with
  `elementFromPoint`." Matches archived `design.md:120,128-129` and the ticket's own
  wording of the constraint.
- **AC3 (sub-44px abutting reading + epsilon + anti-widen-gap warning)** — present:
  "A correctly tiled, abutting hit region legitimately bisects to just under 44px
  (~43.75px at a 0.25px sampling step), so the assertion threshold needs an epsilon
  (`>= 44 - samplingStep`, never a literal `>= 44`); the gap must never be widened
  past the tiling point to force the number over 44 — the threshold takes the
  epsilon, not the gap." Matches archived `tasks.md:78` (task 7.11) verbatim in
  substance, and `evaluation-1.md:177`'s 43.75 reading.
- **AC4 (consistent wording, 44px literal remains sanctioned)** — the existing
  sentence describing the `::after` mechanism and its `44px` literal is untouched;
  the new prose is appended to the same paragraph, same voice, no contradiction.

Numeric spot-checks against the archive, done directly by me (not the skeptic's
table):
- 35.75px real extent at 8px gap vs. 44px computed `::after` — archived
  `design.md:122` ("round 4 measured the icon buttons at a real horizontal extent of
  **35.75px** with the gap left at 8px, while their `::after` still computed a full
  44px"). Matches DESIGN.md's new prose exactly.
- 16px minimum gap / 8px gap broken, 16px fixed — archived `design.md:118-124`
  ("`.app-command-bar__right`... gaps its controls by `var(--space-2)` (8px)... The
  gap therefore becomes `var(--space-4)` (16px)"). Matches.
- Painted-box sampling reports zero violations — archived `design.md:120` ("not a
  neighbour's painted box, which they never reach") and `design.md:128` ("a check
  that samples neighbouring painted boxes cannot see it"). DESIGN.md's new prose
  states the same substance ("sampling neighbouring painted boxes for overlap can[not]
  detect this"). Confirmed. (Note: DESIGN.md does not repeat the exact "0 violations"
  figure verbatim, but the *substantive claim* — that painted-box sampling cannot
  see the defect — is accurate and matches the archive; no fabricated number found.)
- ~43.75px epsilon reading at 0.25px step — archived `tasks.md:78` (task 7.11: "abutting
  regions read ~43.75 at a 0.25px step"). Matches exactly.
- Anti-widen-gap warning — archived `tasks.md:78` ("NEVER widen the gap past
  `var(--space-4)` to push the number over 44 — that breaks the exact tiling; the
  threshold takes the epsilon, not the gap"). DESIGN.md's wording ("the gap must
  never be widened past the tiling point to force the number over 44 — the threshold
  takes the epsilon, not the gap") is a faithful paraphrase. Confirmed.
- **Placement above `**[mechanical]**` tag** — confirmed by direct read of
  `DESIGN.md:190-224` (Bash output above): the new prose sits between "...which
  would grow the box." and "**[mechanical]** No other control heights." — i.e. above
  the mechanical tag, not folded into it. This matches the skeptic's non-blocking
  note in `skeptic-design-1.md` and the concern is correctly resolved in the
  implementation.
- **elementFromPoint / getComputedStyle insufficiency claim accuracy** — cross-checked
  against archived `evaluation-1.md` (Phase 1, AC4 discussion): "every control's
  **real** hit extent by `elementFromPoint` bisection at a 0.25px step is >= 43.75px",
  and the archived `design.md:108-116` explains why `getComputedStyle` alone is
  insufficient (measures the padding-box inset behavior, not the real tap region
  when regions overlap). DESIGN.md's claim is accurate and correctly scoped.

- No AC silently reinterpreted; no scope creep — `git show --stat 7329d0d6` touches
  only `DESIGN.md` (16 lines, +15/-1) plus the openspec change-bookkeeping files for
  this change (`design-md-hit-expander-gap-rule/*`). No other file touched.
- No regressions — documentation-only, no code paths affected.
- No API contracts affected (not applicable to this change).
- Planning artifacts (`design.md`, `tasks.md`, `skeptic-design-1.md`) accurately
  reflect the final `DESIGN.md` text; the skeptic's one non-blocking mis-citation note
  (attribution of a quote to the wrong archived line) is planning-only prose, does not
  appear in the shipped `DESIGN.md` text, and does not affect Phase 1.

### Phase 2: Code Review — PASS

No `frontend/**` or `backend/**` files changed (`git diff --name-only main...HEAD`
touches only `DESIGN.md` and `openspec/changes/design-md-hit-expander-gap-rule/**`),
so the frontend/backend gate matrix is not triggered by the stated file-glob rules.
Ran the general-purpose format gate anyway as a sanity check, fresh, in `WORKTREE_PATH`:

| Gate | Result |
| --- | --- |
| `npm run format:check` | PASS — "All matched files use Prettier code style!" |
| `npm run check:openspec` | Ran fresh: single informational line ("change ... complete but in flight (absent from origin/main, last activity 0d ago)"), not an error — `openspec/ is clean`. This is the standard in-flight-change notice, not a hygiene failure. |

**Pre-commit hook check** — `.husky/pre-commit` runs `check:repo-integrity`, `lint`,
`typecheck`, `format:check`, `check:schemas`, `check:spec-structure`,
`check:openspec`, `check:openspec:selftest`, `check:scala-quality`, `test`, in that
order, with `set -e`. The commit message for `7329d0d6` contains no `git commit -n`
bypass disclosure (compare to the archived HEL-772 commit chain's explicit HEL-657
false-positive disclosure) and no such disclosure was found in `files-modified.md`
or planning artifacts, so the hooks are inferred to have run and passed uneventfully
on the actual commit — consistent with a documentation-only diff that trips no lint,
type, schema, or test surface. No evidence of a bypass.

- **CONTRIBUTING.md compliance** — not applicable (no code touched); no inline-FQN,
  no dead code, no file-size-budget concern (DESIGN.md's net change is +15 lines).
- **DESIGN.md mechanical-rule compliance** — the new prose introduces no hardcoded
  color/spacing/type literal that CONTRIBUTING/DESIGN's mechanical token rules would
  flag; it is prose describing an existing, already-sanctioned `44px` literal and a
  formula, not new CSS.
- **DRY / readable / modular** — single coherent paragraph extension, no duplication
  of the existing sentence, consistent voice and terminology with the surrounding
  Control-metrics section.
- **No dead code / no over-engineering** — n/a, no code.
- **Tests** — n/a, no code paths introduced; the spec delta
  (`specs/design-doc-hit-expander-guidance/spec.md`) declares scenarios checkable by
  reading `DESIGN.md`, appropriate for a documentation-content capability (consistent
  with the skeptic's assessment).

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` files changed (only `DESIGN.md`, a top-level file, and this
change's own `openspec/changes/.../specs/` delta, which is not `openspec/specs/**`).
No UI-affecting files changed; Phase 3 does not trigger.

### Overall: PASS

### Non-blocking Suggestions

- None beyond the skeptic's already-recorded, already-resolved non-blocking notes
  (mis-citation in `design.md`'s Context section — planning-only, does not affect the
  shipped `DESIGN.md` text; `[mechanical]`-tag placement — verified correctly resolved
  in the implementation, see above).
