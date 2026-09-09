## Context

See proposal.md - Why. Measurements are in `ticket.md`; full evidence in
`/home/matt/Development/helio/.concertino/runs/HEL-444/evidence/premise-validation.md` (repo-root absolute — that path
is NOT visible from inside this worktree). Every token value is PARSED from `theme.css`, never
transcribed — a first pass using a hand-copied `--app-text-muted` produced wrong dark numbers and was discarded.

## Goals / Non-Goals

**Goals:**
- Provide the per-theme coverage guard AC1 asks for and nothing supplies.
- Do the running-app walk, the only criterion never done.
- Resolve whether the light-theme accent contrast is a defect, and report rather than unilaterally retune.

**Non-Goals:** see proposal.md. Above all: **do not manufacture conversions.** Three ACs are already satisfied.

## Decisions

**D1 - The guard checks PER-THEME coverage, and its header must say why it is not HEL-1037.** A token defined only in
`:root[data-theme="dark"]` resolves fine, so `scripts/check-tokens.mjs` passes it. The gap is "defined in BOTH theme
blocks". **This distinction goes in the guard's own header comment**, not only in this document — otherwise the next
reader closes it as duplicative. Zero live violations today, so the guard is pure protection: prove the RED arm is
reachable before it exists.

**D2 - The guard carries HEL-442's construction.** Exceptions pinned to exact file + declaration + count, never a
per-file or pattern allowance, and demonstrably able to EXPIRE — HEL-442's pin went RED on its first real cross-lane
collision and was deleted rather than loosened. Do NOT reintroduce HEL-1045's unfixed hole (whole-declaration matching
where a composite value can smuggle a literal past).

**D3 - The AC2 multiplier is restated by ENUMERATION, not collapsed.** AC4's proof is about ink selection only. The
accent-consuming relationships split into one analytically-covered group (`--app-accent-ink` on an `--app-accent`
fill, 35 uses — asserted once, citing `buildAccentTokens` (`theme/appearance.ts`, symbol not line — the old `305-326` is dead), `buildAccentTokens`) and three that are
accent-against-surface and
theme-dependent (`color: var(--app-accent)` 41 sites; borders/outlines 63 — **which at light 2.38-2.80 FAIL the 3:1
non-text threshold and are therefore a first-class finding, not a pass, r1 CR2**; `-surface`/`-dim`/`-mid` washes 61). The 8x
applies only to the second group, and is discharged by computing the accent x surface matrix analytically for all 8
presets x 2 themes. **Collapsing 8x to 1x would extend an ink proof onto pairings it does not reach.**

**D4 - Two presets are walked end-to-end, chosen adversarially.** **Purple** (#a855f7) — thinnest ink margin at 4.60.
**Yellow** (#eab308) — worst accent-on-surface, 1.63:1 on light `--app-surface-soft`, and the narrowest existing
margin in the app is already light muted on that same surface (4.87). Two adversarial presets beat eight arbitrary
ones; if the walk finds nothing on these, the remaining six are not where a defect hides.

**D5 (CORRECTED, design gate r1 CR1) - There is NO per-theme accent asymmetry; there is one accent in both themes,
and light gets the un-darkened value.** My original D5 read `theme.css`'s per-theme `--app-accent` defaults and
reported dark `#f97316` vs light `#ea580c`. **Those light values never render.** `ThemeProvider.tsx:89-92` calls
`applyAccentTokens` unconditionally on mount; `appearance.ts` writes via
`document.documentElement.style.setProperty`, i.e. **inline style on `<html>`, which outranks both
`:root[data-theme=...]` blocks.** `theme.css:161-162` states this in its own comment. Confirmed on the running app:
computed `--app-accent` is `#f97316` in both themes.

Corrected measurement — light `#f97316` against the five surfaces is **2.38 - 2.80**, which fails **3:1 as well as
4.5:1**; dark is 5.58 - 6.73 and clears both. Across all 8 presets in light, **four fail 3:1 outright** (Yellow
1.63-1.92, Green 1.93-2.28, Cyan 2.06-2.43, Orange 2.38-2.80), Pink straddles, and the SHIPPED DEFAULT is Orange.

**The lesson, recorded because this plan predicted it and then committed it anyway:** D6 below warns that the findings
that matter are the ones no source text carries. I then built this ticket's headline on a source read of a value the
runtime overrides. A token's *declared* value is not its *rendered* value wherever anything writes inline.

Retuning the accent remains OUT of scope — an 8-preset visual-identity decision belongs to the owner. **Owned by
HEL-1046** (filed), against which **AC2 is declared REPORTED-NOT-SATISFIED**: AC2 requires legibility across all 8
presets, and four fail 3:1 in light including the default, so it cannot honestly be ticked. Report with the
per-surface site list from task 4.2.

**D3a (design gate r3 note 4) - There is a SECOND ink-selection site, and it is NOT the same function.**
`resolvePanelTextColor` (`theme/appearance.ts`, symbol not line — the old `255-265` is dead) also picks readable text, but against an ARBITRARY surface (panel/dashboard appearance
colours), applies its own 4.5:1 check, and IS theme-aware via `themeAppearancePalette[theme]`. So D3's "ink selection
is analytically covered" applies cleanly to `buildAccentTokens` only. This second site takes a user-chosen surface as
input, so it cannot be discharged by a fixed table — the walk must exercise it with a custom panel/dashboard colour in
both themes, or record that it was not reached.

**D6 - What no source text carries.** This lane's three most valuable findings were invisible to grep: vendor CSS
(HEL-1032), a JS library default (HEL-1034), and an ABSENCE (HEL-1035). The analogue here is **a surface that renders
correctly in one theme and wrong in the other for a reason no declaration expresses** — an inherited colour, a
UA default, an opacity composite, or an image/gradient that assumes a dark backdrop. Only the running app shows these.
Also verify by COMPUTED STYLE, not by reading declarations: a surface can land wrong through cascade with nothing
wrong in source.

**D7 - HEL-866 is a hypothesis to TEST, not a conclusion to confirm.** Re-derived from source, not taken on relay:
light defines `--app-surface-raised: #ffffff` and `--app-surface-strong: #ffffff`, byte-identical; dark #232019 vs
#262320 (1.04:1). This IS a light/dark parity defect, so this ticket is the natural place to settle **whether its
reach extends past modals** — and **HEL-1044** (panel card hover conveying elevation by shadow alone) may be a
downstream symptom rather than an independent bug. Test both on the running app; REPORT into HEL-866. Fixing either
is out of scope.

**D8a (NEW, r1 CR4) - The `--app-accent-ink` per-theme defaults are inconsistent AND contradict their own comment.**
`theme.css` dark sets `--app-accent-ink: #16130f`, light sets `#ffffff` — but `#ffffff` measures only **2.80:1** on
the rendered `#f97316`, failing AA, while `#16130f` measures 6.61:1. Both are dead in steady state because
`buildAccentTokens` writes `#181511` (6.49:1) inline in BOTH themes — but they ARE what paints in any pre-mount frame
before `ThemeProvider`'s effect runs. `theme.css:161-162` asserts "Defaults below match DefaultAccentColor"; the light
default matches neither the dark default nor what `buildAccentTokens` computes for the default accent. Same class as
D8 below. **State PLAINLY whether that pre-mount frame is actually observable** (r3 note 4): if it is not, D8a is a
false-COMMENT defect rather than a rendering defect — still worth fixing, and **HEL-1046 scope item 3 already absorbs
it** ("`theme.css`'s dead per-theme defaults should be corrected or removed, and the comment made true"). Either way,
do not leave the comment asserting something false, and do not claim a rendering impact that cannot be observed.

**D8 - The `readableLightText` branch is dead in practice — route it.** All 8 presets select the DARK ink, so
`readableLightText` (#fdfcfa) in `buildAccentTokens` is currently unexercised. Dead-in-practice code in a contrast
path is where a future preset silently breaks. This is a finding, not a footnote: file it or record it explicitly.

## Gate-Chain Implications Checklist

This change adds a new script (`scripts/check-theme-parity.mjs`) and wires it into
`.husky/pre-commit` as `npm run check:tokens-parity` (+ `check:tokens-parity:selftest`), so per
CON-132 it is treated as a live-infrastructure change, not an ordinary edit.

**What does it execute?** A pure Node script that reads one file (`frontend/src/theme/theme.css`,
or an explicit path argument), brace-matches the two `:root[data-theme="dark"/"light"]` blocks out
of it, regex-extracts `--app-*` declarations from each, and diffs the two sets. It runs no
subprocess, spawns no child process, and performs no network I/O.

**What environment does it inherit, and from where?** Whatever environment the Husky hook /
`npm run` invocation supplies — the same `GIT_DIR`/`GIT_INDEX_FILE`/`GIT_WORK_TREE` shape any other
`.husky/pre-commit` line inherits in a linked worktree. The script itself reads no git-related
environment variable and never shells out to `git`; it resolves its own repo-relative default path
(`frontend/src/theme/theme.css`) purely from `import.meta.url`, the same pattern
`check-tokens.mjs` already uses.

**Does it write anything outside its own sandbox?** No. It only calls `readFileSync` on the target
theme.css path and writes to `stdout`/`stderr` via `console.log`/`console.error`. It never opens a
file for writing, never calls `git`, and has no `mktemp`/tmpdir use in the shipped script itself
(only its selftest uses `mkdtemp`, exactly like `check-tokens.selftest.mjs`, and only under
`os.tmpdir()`, never inside the tracked repo).

**Does it behave differently from a linked worktree than from a main checkout?** No observable
difference: the script never inspects `.git`, worktree layout, or any git state at all — its only
input is the theme.css file's own text, which is identical content whether read from a linked
worktree or a main checkout. The isolation-test run below (fixture built as a `git worktree add`
linked worktree, hook-shaped `GIT_DIR`/`GIT_INDEX_FILE` exported, `GIT_WORK_TREE` unset) confirms
the real repo's bareness/HEAD/worktree-list are byte-identical before and after.

**What happens on its first run?** It reads the current `frontend/src/theme/theme.css`, which
(per task 1.3/2.1's baseline) has zero dark-only/light-only `--app-*` tokens, so the first-ever
pre-commit run through this gate is a clean pass reporting "29 --app-* token(s) in the dark block,
29 in the light block, every one declared in both" — no migration step, no state to seed, nothing
that could be inconsistent on a fresh clone versus an existing one.

**Isolation-test evidence:** run before wiring the script into `.husky/pre-commit`, via
`scripts/concertino/test-gate-in-isolation.sh HEL-444 scripts/check-theme-parity.mjs
check:tokens-parity`. Verdict: `PASS scripts/check-theme-parity.mjs`. Full transcript persisted at
`.concertino/runs/HEL-444/evidence/.concertino/gate-chain-isolation-evidence/scripts__check-theme-parity.mjs.md`
(repo-root-absolute; not visible from inside this worktree, per the same worktree-invisibility note
skeptic-design-2/3 raised for the premise-validation evidence path). The transcript's before/after
snapshots of the real, surrounding repo's bareness/HEAD/worktree-list are byte-identical.

## Risks / Trade-offs

- [The diff is small] -> Expected, and honest: three ACs are already satisfied. The deliverable is the guard plus the
  walk's findings. Padding means changing correct code — the exact failure the cohesion mandate forbids.
- [48/80 accent pairings read as 48 defects] -> They are not. That is the raw accent-on-surface matrix; a saturated
  accent is inherently low-contrast on light surfaces. It becomes a defect only where the accent colours normal-size
  text. Stated in ticket.md and must not be reported as a defect count.
- [Two presets miss a defect the other six would show] -> Mitigated by choosing the two adversarially, and by
  computing the full 8-preset matrix analytically so nothing is unmeasured — only unwalked.
- [The guard duplicates HEL-1037] -> D1 requires the distinction in the guard's header.

## Planner Notes

Self-approved: `skip_specs: true`; D3's enumeration-based restatement of the 8x multiplier; D4's adversarial
two-preset choice. All grounded in the measured tables above.

---

## D9. Currency addendum — cold resume onto `f20ea8f6` (2026-09-09)

This plan was gate-confirmed against base `6800583e`. It has been rebased onto `f20ea8f6`, 12 commits later, and
three of those commits change what the plan measures. **Where this section conflicts with D1-D8 or with `tasks.md`,
this section wins.**

**D9.1 — the accent findings in D4/D5 and in tasks 4.2/5.3 are STALE and are now HYPOTHESES TO RE-TEST.**
`HEL-1046` (736a8cbb), `HEL-1050` (35d8e5e9) and `HEL-1048` (153f6714) shipped after the park. `theme.css` on
`f20ea8f6` now carries `--app-focus-ring-color` and `--app-accent-text`, both written inline at runtime by
`applyAccentTokens`. The parked walk's two rendered failures — the site-wide focus ring at 2.38-2.80 in light, and
the 14px accent-coloured "Create one" empty-state link — are precisely those tickets' subjects and are presumed
fixed. They MUST be re-measured on the running app. Carrying either forward as a live defect, or ticking
"AC2 REPORTED-NOT-SATISFIED against HEL-1046" without re-measuring, would ship a false finding.

The live question is narrower than the parked one: **does anything still RENDER the raw `--app-accent` where a
contrast threshold applies, now that the ring and the accent-text each have their own contrast-derived token?**
Answer per surface by computed style, never from a grep count (the parked lane already proved the 41 static sites
overwhelmingly do not render on the surfaces walked).

**D9.2 (REVISED, design round 4 CR1) — a JEST guard in `frontend/src/theme/`, NOT a `scripts/*.mjs`.**

Two separate questions. First, does HEL-866's guard subsume this? No — verified twice, independently.
`e2e/state-surface-contrast-guard.spec.ts` says in its own header that it "Walks the RUNNING app (not a static parse
of theme.css)"; it contains no `readFileSync` of `theme.css` and no `:root[data-theme=...]` parse. It measures
rendered contrast. AC1 asks a source-level definition-coverage question, and a dark-only token renders perfectly
well, so `stateContrast` is structurally blind to it — exactly as `check-tokens.mjs` is. Both comparators are
correctly ruled out.

Second, and this is what round 4 caught: ruling those two out does not imply a script. **The guard's sole input is
one file, `frontend/src/theme/theme.css`, and that file already has a large family of Jest guards that parse it with
`readFileSync` in `frontend/src/theme/`:** `elevationTokenGuard.css.test.ts`, `focusRingTokenGuard.css.test.ts`,
`accentTextSourceSyncGuard.css.test.ts`, `accentTextClosureGuard.css.test.ts`, `motionTokenGuard.css.test.ts`,
`tokenAuditSweep.css.test.ts`, `theme.css.test.ts`. **`elevationTokenGuard.css.test.ts` IS HEL-442** — the exact
ticket D2/task 2.3 cite as "the construction" — and HEL-442 chose Jest. `check-tokens.mjs` is a script because it
scans the whole repo's CSS; this guard does not.

**Decision: `frontend/src/theme/themeParityGuard.css.test.ts`, alongside its siblings.** This drops the new
`.husky/pre-commit` line, both npm `check:*` scripts, the separate `.selftest.mjs`, and the entire gate-chain
isolation ceremony — Jest already runs in pre-commit and in CI, so the guard is enforced with zero new wiring and
zero new gate-chain surface. The parked `check-theme-parity.mjs` draft is re-formed into that test, keeping its
verified internals (brace-depth block matching, comment stripping, declaration-position-anchored regex, exact-token
exceptions with a staleness check) and discarding its CLI shell. The test's header comment must distinguish it from
**three** neighbours, not two: `check-tokens.mjs` (resolves-anywhere), `state-surface-contrast-guard.spec.ts`
(rendered contrast), and `focusRingTokenGuard`/`accentTextSourceSyncGuard` (single-token invariants, not coverage).

**D9.3 — the parked guard draft is a STARTING POINT, not a deliverable.**
`.concertino/runs/HEL-444/evidence/parked-executor-work/` holds `check-theme-parity.mjs`, its selftest, a
`DESIGN.md.diff` and a `wiring.diff`. None of it was ever committed and **none of it was ever gate-reviewed** —
the parked lane says so itself. It was mutation-proved against `theme.css` as of `6800583e`. Re-verify it against
the current file, re-run its mutation proof, and hold it to HEL-442's construction: exceptions pinned to exact file
+ declaration + count, never a pattern allowance, and demonstrably able to EXPIRE. Note the new
`--app-accent-text` / `--app-selection-bg` / `--app-focus-ring-color` tokens are runtime-set and deliberately absent
from BOTH theme blocks — the guard must handle "declared in neither" as a non-violation without that becoming a
loophole that also swallows "declared in exactly one".

**D9.4 (REVISED, design round 4 CR2/CR4) — AC2's 8x multiplier, restated, and the TWO shipped defaults.**

Ink selection inside `buildAccentTokens` (cite by SYMBOL, never by line — the old `appearance.ts:305-326` pointed at
what is now `FOCUS_RING_SURFACES`; likewise D3a's second ink site is `resolvePanelTextColor`, not `:255-265`) is genuinely
theme-independent: it compares only the two fixed inks against the accent. Declining to walk it 8x is therefore not
scope-shaving.

**But D5's headline — "there is one accent in both themes" — is an artifact of the parked walk's browser profile,
not a property of the app.** Verified on the current tree: `frontend/src/theme/theme.ts:12` declares
`DefaultAccentColorByTheme = { dark: "#f97316", light: "#ea580c" }`, and `getInitialAccentColor(theme)` returns the
theme-specific default whenever `localStorage["helio-accent"]` is unset. `ThemeProvider.tsx` seeds `accentColor`
ONCE in a `useState` initializer at mount and never re-derives it on theme change (the effect re-*applies* the same
value). So a profile whose first mount is dark carries `#f97316` into light; a profile whose first mount is light
gets `#ea580c`. **The per-theme asymmetry is real and lives at `DefaultAccentColorByTheme` (`theme.ts`, symbol not line) — it was only invisible because the
walk reused a persisted value.** D5 is corrected here: the asymmetry is not confined to `theme.css`'s dead blocks.

Binding on the walk: **clear `localStorage["helio-accent"]` before each theme's walk**, and state per surface which
default is in force. Measuring a persisted artifact instead of the real initialization path is precisely the
declared-vs-rendered trap this plan has now committed twice.

**And the 8x now applies to the DERIVED tokens, not the raw accent.** Post-HEL-1048/HEL-1046, what paints text is
`--app-accent-text` (`deriveAccentTextColor(hex, theme)`) and what paints the ring is `--app-focus-ring-color` —
both derived per preset AND per theme. Task 3.1's raw `--app-accent` x surface matrix now measures a largely
decorative relationship. **Discharge the 8x against the derived tokens: 8 presets x 2 themes, computing the actual
derived values and asserting their thresholds.** That is 16 real computations, not one assertion. Keep the raw
matrix only as context, and do NOT report its sub-4.5 count as a defect count (task 3.3 still binds).

Walk every surface x both themes at each theme's own default, plus two presets end-to-end chosen adversarially from
the FRESH derived-token matrix. Purple/Yellow were selected against the pre-HEL-1048 path; re-derive rather than
inherit. Do NOT re-tune the accent — an 8-preset visual identity decision belongs to the owner.

**D9.5 — routing is unchanged and still binds.** HEL-866's blast-radius answer (54 files) is already reported.
`HEL-1058` (dedicated `--app-state-hover`/`--app-state-selected` tokens) and `HEL-1059` (the rendered guard cannot
see equal-luminance hue shifts) were filed out of HEL-866 and are the correct destination for anything in that
family found during the walk. Route, do not absorb.


**D9.6 — three corrections from design round 5 (non-blocking notes, folded in).**

**D9.6a — cite by SYMBOL, never by line.** Round 5 caught D9.4 asserting it had re-anchored the dead citations
"throughout design.md" when `design.md:32`, `design.md:66` and `tasks.md:21` still carried them. That claim was
false. All four sites now name symbols (`buildAccentTokens`, `resolvePanelTextColor`, `DefaultAccentColorByTheme`).
**This ticket has now been bitten three times by confidently-false documentation of its own base** — the retracted
per-theme accent asymmetry, the stale post-HEL-1046 accent figures, and this. Every citation in the deliverable and
in the PR body is a symbol name plus a file, never a line range.

**D9.6b — clearing `localStorage` is NECESSARY BUT NOT SUFFICIENT; a fresh RELOAD is required.** `ThemeProvider`
seeds the accent only in a mount-time `useState` initializer and re-persists it to `localStorage` on every apply.
So clearing storage from the console, or toggling the theme after clearing, both leave the already-seeded value in
React state and immediately re-persist it — reproducing the exact artifact CR4 identified. **To observe the light
default `#ea580c`, load the page fresh with the theme already light and no stored accent.** Task 8.8's "record which
default is in force per surface" is a backstop, not the mechanism.

**D9.6c — a green pre-commit is NOT evidence the new guard fired.** `ci.yml` records (HEL-846) that hook-level
`npm test` is vacuous in the linked worktrees where every delivery runs (HEL-768/HEL-880). CI enforcement is real
and merge-blocking, which is what D9.2's Jest decision actually rests on, and this is identical to the situation of
all seven sibling guards — so the choice stands unchanged. But the executor must run `npx jest` from `frontend/`
EXPLICITLY and paste the transcript (tasks 1.2 / 6.2 already require this); never cite a green commit as the guard's
proof.
