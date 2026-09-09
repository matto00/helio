## Skeptic Report — design gate (round 9, skeptic-design-9.md)

Artifacts at `d7e09974`. Narrow scope: the six fixes and the cross-references they touch.

### What I verified (with evidence)

- **Fix 1 — translation-table scope. LANDED and correct.** `design.md:327-332` now states the scope by the
  determining fact (before/after `f84e7e88`) as well as by number. Boundary spot-checked two ways:
  `git log --diff-filter=A` shows `skeptic-design-6.md` added *in* `f84e7e88` (written before the renumber)
  and `skeptic-design-7.md` added in `d7904290` (after). Content agrees: `-6.md:50` uses "D12" for the
  hand-rolled inline tints and `-6.md:41` uses "D11" for the dark-baseline figures — old numbering;
  `-7.md:72` reads "**D12** dead per-theme defaults. There is no D13" — current numbering. Its other
  `D11`/`D12`/`D13` hits (`:73-77`, `:88`, `:97`, `:109`) are quotations of the then-stale `tasks.md`, not
  its own numbering. A report added later falls after `f84e7e88` and is correctly excluded.
- **Fix 3 — light-figures gap. LANDED.** `tasks.md:26-29` adds task 2.0a owning both themes; `tasks.md:30`
  gates 2.0 on "the dark values from 2.0a"; `design.md:114-118` says "both rows, not only the dark one" and
  names 2.0a. See Change Request 2 for the one downstream pointer that did not move with it.
- **Fix 4 — D14. LANDED, provenance verified against code, not narrative.** `theme.css:343` is
  `:root { --app-focus-ring-color: #db6513; }`, described at `theme.css:338-341` as "used as the static
  pre-hydration fallback"; `ThemeProvider.tsx:89-91` runs `applyAccentTokens(accentColor)` inside a
  `useEffect`. So HEL-1046 did ship exactly this for exactly this reason. Numbering is correct: D13 appears
  only at `design.md:19`, `:232`, `:344`, `:346`, all retired/tombstone context, never as a live decision.
  The D12 interaction resolves: D12 is about the *per-theme* `--app-accent`/`--app-accent-ink` blocks
  (never render); D14 is a single `:root` value meant to be superseded (renders until the effect runs).
- **Fix 5 — rules. LANDED.** `design.md:5` "Five rules" over five numbered items; `design.md:22` "**Rule 5**"
  resolves to the measured-figures rule at `:24`. Every rule reference in both files checked mechanically
  (`grep -n "[Rr]ule [0-9]"`): `design.md:232`, `:324`, `:346` cite rule 3 (D-number freeze) — correct;
  `tasks.md:4` cites "`design.md` rule 3" for D-number freezing — correct.
- **Fix 6 — LANDED.** `tasks.md:52-54` now cites D14 instead of stating the requirement unowned.
- **D-reference resolution, both files, mechanically enumerated** (`grep -on 'D1[0-4]\|D[1-9]\b'`): 27 refs in
  `tasks.md`, 74 in `design.md`. Every one resolves to the decision it means under the frozen numbering; no
  D13 in `tasks.md`; D14 present in both. The one wrong pointer found is Change Request 1.
- **Rule 5 checked exhaustively, not sampled.** Extracted every numeral from both files
  (`grep -oE '\b[0-9]+(\.[0-9]+)?%?\b'`) and inspected every value occurring more than once: 22, 20, 10, 26,
  11, 14, 23, 30, 15, 34, 35, 38. All are either file line numbers, ticket ids, the 4.5 constant, D3's two
  tables (one owning section), or in-section label reuse the rule explicitly permits (`design.md:31`,
  `:154-161`, `:179-181`). No violation. No measured figure is restated across the two files — `tasks.md`
  contains no contrast or adjustment figure at all (its numerals are task ids, ticket ids, ports 6480/9387,
  HTTP 200/403, and the 14px/3:1 stipulated parameters, none of which are measurements).
- Task 1.1's script path exists:
  `/home/matt/Development/helio/.concertino/runs/HEL-1048/evidence/skeptic3-accent-text-closure.py`.

### Verdict: REFUTE

### Change Requests

1. **Fix 2 did not land. D9 still cites task 1.2 and is still circular.** The commit message of `d7e09974`
   claims "D9 now names the script directly", but `git diff d7904290 d7e09974 -- design.md` contains no
   change to D9, and the D9 paragraph is byte-identical to its pre-fix text.
   - `design.md:209-211` (**stale**): "**One hop is not enough.** The inventory and the guard corpus are both
     built from the transitive closure named in `tasks.md` task 1.2, which returns **9 properties / 53
     declarations** and independently rediscovers every class in this document without being told about any
     of them."
   - `tasks.md:16-18` (current): "1.2 Classify every declaration the closure returns into the five background
     classes the site-inventory section of `design.md` enumerates."
   - `tasks.md:10-11` (current): "1.1 **Build the inventory from the transitive closure named in D9** … Run
     `/home/matt/Development/helio/.concertino/runs/HEL-1048/evidence/skeptic3-accent-text-closure.py`."
   Task 1.2 is classification, not the closure; the closure is task 1.1, and 1.1 points back at D9 while D9
   points at a task — the circularity the fix was meant to break is intact.

2. **D5 points at D3 for a light figure D3 explicitly refuses to state.** Fix 3 made D3's tables non-final
   for *both* rows; D5's deferral was not updated with it.
   - `design.md:142-144` (**stale**): "**This is a producibility example, not a minimum.** Orange's actual
     light adjustment is set by the complete scored set, and D3 gives it — the whole thesis of this document
     is that the scored set determines the number…"
   - `design.md:114-116` (current): "**The final figures for both themes are re-derived from the complete set
     at implementation time** rather than stated here… `tasks.md` task 2.0a owns the re-derivation."
   D3 does not give Orange's actual light adjustment; task 2.0a does. This is precisely the class this round
   was asked to close — a downstream decision still sending a reader to `design.md`'s non-final tables for a
   light figure.

### Non-blocking notes

- `design.md:130` reads "Figures come from D3's re-derivation, not from this paragraph." D3 no longer performs
  the re-derivation (task 2.0a does). Not blocking, because the same paragraph at `:126-127` already directs
  the reader to "take the dark values from task 2.0a's re-derivation", so no reader is misrouted — but the
  phrase "D3's re-derivation" is a leftover of the pre-2.0a ownership.
